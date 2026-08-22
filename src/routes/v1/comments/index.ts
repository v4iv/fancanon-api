import { Hono } from 'hono'
import { eq, and, sql } from 'drizzle-orm'
import { describeRoute, resolver, validator } from 'hono-openapi'

import { AppContext } from '@/types'
import { withDatabase } from '@/lib/db'
import { activity, chapter, comment, commentLike, notification, story } from '@/lib/db/schema'
import { requestParamSchema, actionResponseSchema } from './schema'

const app = new Hono<AppContext>()

// TODO: switch to soft delete (e.g. a `deletedAt` timestamp + blank out
// `content`) instead of a hard DELETE. Hard delete cascades through
// comment.parentId onto the entire reply subtree (see note below), which
// also means storyCommentCount only ever decrements by 1 regardless of how
// many descendant replies got swept away — soft delete would sidestep both
// issues by leaving replies and counts untouched.
app.delete(
  '/:commentId',
  describeRoute({
    description: 'Delete a comment.',
    responses: {
      200: {
        description: 'Successful response',
        content: {
          'application/json': { schema: resolver(actionResponseSchema) },
        },
      },
    },
  }),
  validator('param', requestParamSchema),
  withDatabase,
  async (c) => {
    const { commentId } = c.req.valid('param')

    const user = c.get('user')

    if (!user) {
      return c.json({ success: false }, { status: 401 })
    }

    const userId = user.id
    const db = c.get('db')

    try {
      const result = await db.transaction(async (tx) => {
        const [deleted] = await tx
          .delete(comment)
          .where(and(eq(comment.id, commentId), eq(comment.authorId, userId)))
          .returning({ parentId: comment.parentId, chapterId: comment.chapterId })

        if (!deleted) return null

        const [chapterRow] = await tx
          .select({ storyId: chapter.storyId })
          .from(chapter)
          .where(eq(chapter.id, deleted.chapterId))

        if (chapterRow) {
          await tx
            .update(story)
            .set({ commentCount: sql`GREATEST(${story.commentCount} - 1, 0)` })
            .where(eq(story.id, chapterRow.storyId))
        }

        if (deleted.parentId) {
          await tx
            .update(comment)
            .set({ replyCount: sql`GREATEST(${comment.replyCount} - 1, 0)` })
            .where(eq(comment.id, deleted.parentId))
        }

        return deleted
      })

      if (result) {
        return c.json({ success: true }, { status: 200 })
      }

      const [existing] = await db
        .select({ id: comment.id })
        .from(comment)
        .where(eq(comment.id, commentId))

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
  '/:commentId/like',
  describeRoute({
    description: 'Like a comment.',
    responses: {
      200: {
        description: 'Successful response',
        content: {
          'application/json': { schema: resolver(actionResponseSchema) },
        },
      },
    },
  }),
  validator('param', requestParamSchema),
  withDatabase,
  async (c) => {
    const { commentId } = c.req.valid('param')

    const user = c.get('user')

    if (!user) {
      return c.json({ success: false }, { status: 401 })
    }

    const userId = user.id
    const db = c.get('db')

    try {
      await db.transaction(async (tx) => {
        const [inserted] = await tx
          .insert(commentLike)
          .values({ userId, commentId })
          .onConflictDoNothing()
          .returning({ commentId: commentLike.commentId })

        // Already liked — no-op, don't double-count or spam another activity/notification.
        if (!inserted) return

        const [updatedComment] = await tx
          .update(comment)
          .set({ likeCount: sql`${comment.likeCount} + 1` })
          .where(eq(comment.id, commentId))
          .returning({ authorId: comment.authorId })

        // commentId didn't reference a real comment — roll back the like insert.
        if (!updatedComment) {
          tx.rollback()
        }

        const [createdActivity] = await tx
          .insert(activity)
          .values({ actorId: userId, verb: 'COMMENT_LIKED', commentId })
          .returning({ id: activity.id })

        if (updatedComment.authorId !== userId) {
          await tx.insert(notification).values({
            ownerId: updatedComment.authorId,
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
  '/:commentId/like',
  describeRoute({
    description: 'Unlike a liked comment.',
    responses: {
      200: {
        description: 'Successful response',
        content: {
          'application/json': { schema: resolver(actionResponseSchema) },
        },
      },
    },
  }),
  validator('param', requestParamSchema),
  withDatabase,
  async (c) => {
    const { commentId } = c.req.valid('param')

    const user = c.get('user')

    if (!user) {
      return c.json({ success: false }, { status: 401 })
    }

    const userId = user.id
    const db = c.get('db')

    try {
      await db.transaction(async (tx) => {
        const [deleted] = await tx
          .delete(commentLike)
          .where(and(eq(commentLike.userId, userId), eq(commentLike.commentId, commentId)))
          .returning({ commentId: commentLike.commentId })

        // Wasn't liked in the first place — no-op.
        if (!deleted) return

        const [updatedComment] = await tx
          .update(comment)
          .set({ likeCount: sql`GREATEST(${comment.likeCount} - 1, 0)` })
          .where(eq(comment.id, commentId))
          .returning({ id: comment.id })

        if (!updatedComment) {
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
              eq(activity.verb, 'COMMENT_LIKED'),
              eq(activity.commentId, commentId),
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

export { app as comments }
