import { Hono } from 'hono'
import { and, asc, eq, sql } from 'drizzle-orm'
import { describeRoute, resolver, validator } from 'hono-openapi'

import { AppContext } from '@/lib/types.d'
import { withDatabase } from '@/lib/db'
import { storyWithForUser } from '@/lib/helpers/story-helper'
import { activity, bookmark, chapter, like, notification, readLater, story } from '@/lib/db/schema'
import {
  chaptersResponseSchema,
  storyActionResponseSchema,
  storyParamSchema,
  storyResponseSchema,
} from './schema'

const app = new Hono<AppContext>()

app.get(
  '/:storyId',
  describeRoute({
    description: 'Fetches the story',
    responses: {
      200: {
        description: 'Successful response',
        content: {
          'application/json': { schema: resolver(storyResponseSchema) },
        },
      },
    },
  }),
  validator('param', storyParamSchema),
  withDatabase,
  async (c) => {
    const { storyId } = c.req.valid('param')
    const user = c.get('user')
    const userId = user?.id ?? ''
    const db = c.get('db')

    const storyRow = await db.query.story.findFirst({
      where: eq(story.id, storyId),
      with: storyWithForUser(userId),
    })

    if (!storyRow) {
      return c.json({ success: false }, { status: 404 })
    }

    return c.json({ success: true, story: storyRow }, { status: 200 })
  },
)

app.delete(
  '/:storyId',
  describeRoute({
    description: 'Deletes the story',
    responses: {
      200: {
        description: 'Successful response',
        content: {
          'application/json': { schema: resolver(storyActionResponseSchema) },
        },
      },
    },
  }),
  validator('param', storyParamSchema),
  withDatabase,
  async (c) => {
    const { storyId } = c.req.valid('param')
    const user = c.get('user')
    const userId = user?.id ?? ''
    const db = c.get('db')

    try {
      const [deleted] = await db
        .delete(story)
        .where(and(eq(story.id, storyId), eq(story.authorId, userId)))
        .returning({ id: story.id })

      if (deleted) {
        return c.json({ success: true }, { status: 200 })
      }

      // Delete matched nothing — figure out why, for an accurate error response.
      const [existing] = await db.select({ id: story.id }).from(story).where(eq(story.id, storyId))

      if (!existing) {
        return c.json({ success: false }, { status: 404 })
      }

      return c.json({ success: false }, { status: 403 })
    } catch (err) {
      console.error(err)
      return c.json({ success: false }, { status: 500 })
    }
  },
)

app.get(
  '/:storyId/like',
  describeRoute({
    description:
      'Likes a story for the authenticated user within an atomic transaction. Updates story like count, records user activity, and dispatches a notification to the author.',
    responses: {
      200: {
        description: 'Successful response',
        content: {
          'application/json': { schema: resolver(storyActionResponseSchema) },
        },
      },
    },
  }),
  validator('param', storyParamSchema),
  withDatabase,
  async (c) => {
    const { storyId } = c.req.valid('param')

    const user = c.get('user')
    if (!user) {
      return c.json({ success: false }, { status: 401 })
    }

    const userId = user?.id ?? ''
    const db = c.get('db')

    try {
      await db.transaction(async (tx) => {
        const [inserted] = await tx
          .insert(like)
          .values({ userId, storyId })
          .onConflictDoNothing()
          .returning({ storyId: like.storyId })

        // Already liked — no-op, don't double-count or spam another activity/notification.
        if (!inserted) return

        const [updated] = await tx
          .update(story)
          .set({ likeCount: sql`${story.likeCount} + 1` })
          .where(eq(story.id, storyId))
          .returning({ authorId: story.authorId })

        // storyId didn't reference a real story — roll back the like insert.
        if (!updated) {
          tx.rollback()
        }

        const [createdActivity] = await tx
          .insert(activity)
          .values({ actorId: userId, verb: 'STORY_LIKED', storyId })
          .returning({ id: activity.id })

        if (updated.authorId !== userId) {
          await tx.insert(notification).values({
            ownerId: updated.authorId,
            activityId: createdActivity.id,
          })
        }
      })

      return c.json({ success: true }, { status: 200 })
    } catch (err) {
      console.error(err)
      return c.json({ success: false }, { status: 500 })
    }
  },
)

app.delete(
  '/:storyId/like',
  describeRoute({
    description:
      "Removes a story like for the authenticated user within an atomic transaction. Decrements the story's like count and purges associated activity and notification entries.",
    responses: {
      200: {
        description: 'Successful response',
        content: {
          'application/json': { schema: resolver(storyActionResponseSchema) },
        },
      },
    },
  }),
  validator('param', storyParamSchema),
  withDatabase,
  async (c) => {
    const { storyId } = c.req.valid('param')

    const user = c.get('user')
    if (!user) {
      return c.json({ success: false }, { status: 401 })
    }

    const userId = user?.id ?? ''
    const db = c.get('db')

    try {
      await db.transaction(async (tx) => {
        const [deleted] = await tx
          .delete(like)
          .where(and(eq(like.userId, userId), eq(like.storyId, storyId)))
          .returning({ storyId: like.storyId })

        // Wasn't liked in the first place — no-op.
        if (!deleted) return

        const [updated] = await tx
          .update(story)
          .set({ likeCount: sql`GREATEST(${story.likeCount} - 1, 0)` })
          .where(eq(story.id, storyId))
          .returning({ id: story.id })

        if (!updated) {
          tx.rollback()
        }

        // Deleting the activity cascades to notification/feedItem rows
        // referencing it (both declared onDelete: 'cascade'), so this
        // single delete cleans up the fan-out too.
        await tx
          .delete(activity)
          .where(
            and(
              eq(activity.actorId, userId),
              eq(activity.verb, 'STORY_LIKED'),
              eq(activity.storyId, storyId),
            ),
          )
      })

      return c.json({ success: true }, { status: 200 })
    } catch (err) {
      console.error(err)
      return c.json({ success: false }, { status: 500 })
    }
  },
)

app.get(
  '/:storyId/read-later',
  describeRoute({
    description:
      "Saves a story to the authenticated user's read-later list within an atomic transaction and increments the story's read-later count.",
    responses: {
      200: {
        description: 'Successful response',
        content: {
          'application/json': { schema: resolver(storyActionResponseSchema) },
        },
      },
    },
  }),
  validator('param', storyParamSchema),
  withDatabase,
  async (c) => {
    const { storyId } = c.req.valid('param')

    const user = c.get('user')
    if (!user) {
      return c.json({ success: false }, { status: 401 })
    }

    const userId = user?.id ?? ''
    const db = c.get('db')

    try {
      await db.transaction(async (tx) => {
        const [inserted] = await tx
          .insert(readLater)
          .values({ userId, storyId })
          .onConflictDoNothing()
          .returning({ userId: readLater.userId })

        // Already added to read-later — don't double-increment the counter.
        if (!inserted) {
          const [existing] = await tx
            .select({ count: story.readLaterCount })
            .from(story)
            .where(eq(story.id, storyId))
          return existing?.count ?? 0
        }

        const [updated] = await tx
          .update(story)
          .set({ readLaterCount: sql`${story.readLaterCount} + 1` })
          .where(eq(story.id, storyId))
          .returning({ id: story.id })

        if (!updated) {
          // storyId didn't reference a real story — roll back the insert.
          tx.rollback()
        }
      })

      return c.json({ success: true }, { status: 200 })
    } catch (err) {
      console.error(err)
      return c.json({ success: false }, { status: 500 })
    }
  },
)

app.delete(
  '/:storyId/read-later',
  describeRoute({
    description:
      "Removes a story from the authenticated user's read-later list within an atomic transaction and decrements the story's read-later count.",
    responses: {
      200: {
        description: 'Successful response',
        content: {
          'application/json': { schema: resolver(storyActionResponseSchema) },
        },
      },
    },
  }),
  validator('param', storyParamSchema),
  withDatabase,
  async (c) => {
    const { storyId } = c.req.valid('param')

    const user = c.get('user')
    if (!user) {
      return c.json({ success: false }, { status: 401 })
    }

    const userId = user?.id ?? ''
    const db = c.get('db')

    try {
      await db.transaction(async (tx) => {
        const [deleted] = await tx
          .delete(readLater)
          .where(and(eq(readLater.userId, userId), eq(readLater.storyId, storyId)))
          .returning({ userId: readLater.userId })

        // Nothing was saved — don't decrement, just report the current count.
        if (!deleted) {
          const [existing] = await tx
            .select({ count: story.readLaterCount })
            .from(story)
            .where(eq(story.id, storyId))
          return existing?.count ?? 0
        }

        const [updated] = await tx
          .update(story)
          .set({ readLaterCount: sql`GREATEST(${story.readLaterCount} - 1, 0)` })
          .where(eq(story.id, storyId))
          .returning({ id: story.id })

        if (!updated) {
          // storyId didn't reference a real story — roll back the delete.
          tx.rollback()
        }
      })

      return c.json({ success: true }, { status: 200 })
    } catch (err) {
      console.error(err)
      return c.json({ success: false }, { status: 500 })
    }
  },
)

app.get(
  '/:storyId/chapters',
  describeRoute({
    description: 'Fetches all the chapters of the story',
    responses: {
      200: {
        description: 'Successful response',
        content: {
          'application/json': { schema: resolver(chaptersResponseSchema) },
        },
      },
    },
  }),
  validator('param', storyParamSchema),
  withDatabase,
  async (c) => {
    const { storyId } = c.req.valid('param')
    const user = c.get('user')
    const userId = user?.id ?? ''
    const db = c.get('db')

    try {
      const chapters = await db.query.chapter.findMany({
        where: eq(chapter.storyId, storyId),
        orderBy: asc(chapter.chapterIndex),
        columns: {
          storyId: true,
          authorId: true,
          id: true,
          chapterIndex: true,
          title: true,
          viewCount: true,
          createdAt: true,
          updatedAt: true,
        },
        with: {
          bookmarks: {
            where: eq(bookmark.userId, userId),
            columns: { userId: true, chapterId: true },
          },
        },
      })

      return c.json({ success: true, chapters }, { status: 200 })
    } catch (err) {
      console.error(err)

      return c.json({ success: false }, { status: 500 })
    }
  },
)

export { app as stories }
