import { Hono } from 'hono'
import { sValidator as validator } from '@hono/standard-validator'
// import * as v from 'valibot'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
// import { describeRoute, resolver, validator } from 'hono-openapi'
import { captureException } from '@sentry/hono/cloudflare'

import { AppContext } from '@/types'
import { withDatabase } from '@/lib/db'
import { storyWithForUser } from '@/lib/helpers/story-helper'
import {
  user as userTable,
  bookmark,
  chapter,
  comment,
  follow,
  like,
  readLater,
  story,
  activity,
  notification,
} from '@/lib/db/schema'
import {
  requestParamSchema,
  requestQuerySchema,
  // responseSchema,
  // commentResponseSchema,
} from './schema'

const app = new Hono<AppContext>()

app.get(
  '/likes',
  // describeRoute({
  //   description: 'Fetch a paginated list of liked stories of the authenticated user.',
  //   responses: {
  //     200: {
  //       description: 'Successful response',
  //       content: {
  //         'application/json': { schema: resolver(responseSchema) },
  //       },
  //     },
  //   },
  // }),
  validator('query', requestQuerySchema),
  withDatabase,
  async (c) => {
    const { page, limit } = c.req.valid('query')

    const user = c.get('user')

    if (!user) {
      return c.json({ success: false }, { status: 401 })
    }

    const userId = user.id
    const db = c.get('db')

    const offset = (page - 1) * limit

    try {
      const [likedRows, [{ count: totalCount }]] = await Promise.all([
        db.query.like.findMany({
          where: eq(like.userId, userId),
          orderBy: desc(like.createdAt),
          limit,
          offset,
          with: {
            story: {
              with: storyWithForUser(userId),
            },
          },
        }),
        db
          .select({ count: sql<number>`count(*)`.mapWith(Number) })
          .from(like)
          .where(eq(like.userId, userId)),
      ])

      const likes = likedRows.map((row) => ({
        ...row.story,
        latestLikedAt: row.createdAt,
      }))

      const hasMore = page * limit < totalCount
      const totalPages = Math.ceil(totalCount / limit)
      const nextPage = hasMore ? page + 1 : null

      return c.json(
        {
          success: true,
          stories: likes,
          totalCount,
          currentPage: page,
          next: nextPage,
          totalPages,
          hasMore,
        },
        { status: 200 },
      )
    } catch (err) {
      captureException(err)
      return c.json({ success: false }, { status: 500 })
    }
  },
)

app.get(
  '/read-later',
  // describeRoute({
  //   description: 'Fetch a paginated list of read later stories of the authenticated user.',
  //   responses: {
  //     200: {
  //       description: 'Successful response',
  //       content: {
  //         'application/json': { schema: resolver(responseSchema) },
  //       },
  //     },
  //   },
  // }),
  validator('query', requestQuerySchema),
  withDatabase,
  async (c) => {
    const { page, limit } = c.req.valid('query')

    const user = c.get('user')

    if (!user) {
      return c.json({ success: false }, { status: 401 })
    }

    const userId = user.id
    const db = c.get('db')

    const offset = (page - 1) * limit

    try {
      const [readLaterRows, [{ count: totalCount }]] = await Promise.all([
        db.query.readLater.findMany({
          where: eq(readLater.userId, userId),
          orderBy: desc(readLater.createdAt),
          limit,
          offset,
          with: {
            story: {
              with: storyWithForUser(userId),
            },
          },
        }),
        db
          .select({ count: sql<number>`count(*)`.mapWith(Number) })
          .from(readLater)
          .where(eq(readLater.userId, userId)),
      ])

      const readLaters = readLaterRows.map((row) => ({
        ...row.story,
        latestReadLaterAt: row.createdAt,
      }))

      const hasMore = page * limit < totalCount
      const totalPages = Math.ceil(totalCount / limit)
      const nextPage = hasMore ? page + 1 : null

      return c.json(
        {
          success: true,
          stories: readLaters,
          totalCount,
          currentPage: page,
          next: nextPage,
          totalPages,
          hasMore,
        },
        { status: 200 },
      )
    } catch (err) {
      captureException(err)
      return c.json({ success: false }, { status: 500 })
    }
  },
)

app.get(
  '/comments',
  // describeRoute({
  //   description: 'Fetch a paginated list of comments of the authenticated user.',
  //   responses: {
  //     200: {
  //       description: 'Successful response',
  //       content: {
  //         'application/json': { schema: resolver(commentResponseSchema) },
  //       },
  //     },
  //   },
  // }),
  validator('query', requestQuerySchema),
  withDatabase,
  async (c) => {
    const { page, limit } = c.req.valid('query')

    const user = c.get('user')

    if (!user) {
      return c.json({ success: false }, { status: 401 })
    }

    const userId = user.id
    const db = c.get('db')

    const offset = (page - 1) * limit

    try {
      const [comments, [{ count: totalCount }]] = await Promise.all([
        db.query.comment.findMany({
          where: eq(comment.authorId, userId),
          orderBy: desc(comment.createdAt),
          limit,
          offset,
          with: {
            parent: {
              columns: {},
              with: {
                author: { columns: { id: true, username: true, image: true } },
              },
            },
            chapter: {
              columns: { title: true, chapterIndex: true },
              with: {
                story: { columns: { id: true, title: true } },
              },
            },
          },
        }),
        db
          .select({ count: sql<number>`count(*)`.mapWith(Number) })
          .from(comment)
          .where(eq(comment.authorId, userId)),
      ])

      const hasMore = page * limit < totalCount
      const totalPages = Math.ceil(totalCount / limit)
      const nextPage = hasMore ? page + 1 : null

      return c.json(
        {
          success: true,
          comments,
          totalCount,
          currentPage: page,
          next: nextPage,
          totalPages,
          hasMore,
        },
        { status: 200 },
      )
    } catch (err) {
      captureException(err)
      return c.json({ success: false }, { status: 500 })
    }
  },
)

app.get(
  '/bookmarks',
  // describeRoute({
  //   description: 'Fetch a paginated list of bookmarks of the authenticated user.',
  //   responses: {
  //     200: {
  //       description: 'Successful response',
  //       content: {
  //         'application/json': { schema: resolver(v.any()) },
  //       },
  //     },
  //   },
  // }),
  validator('query', requestQuerySchema),
  withDatabase,
  async (c) => {
    const { page, limit } = c.req.valid('query')

    const user = c.get('user')

    if (!user) {
      return c.json({ success: false }, { status: 401 })
    }

    const userId = user.id
    const db = c.get('db')

    const offset = (page - 1) * limit

    try {
      // dedup at the DB level — one row per distinct bookmarked
      // story, ranked by the most recent bookmark within that story.
      // Pagination happens here, on stories, not on raw bookmark rows.
      const rankedStoryIds = await db
        .select({
          storyId: chapter.storyId,
          latestBookmarkAt: sql<Date>`max(${bookmark.createdAt})`.as('latest_bookmark_at'),
        })
        .from(bookmark)
        .innerJoin(chapter, eq(chapter.id, bookmark.chapterId))
        .where(eq(bookmark.userId, userId))
        .groupBy(chapter.storyId)
        .orderBy(desc(sql`max(${bookmark.createdAt})`))
        .limit(limit)
        .offset(offset)

      if (rankedStoryIds.length === 0) {
        return c.json({ success: true, bookmarks: [], count: 0 }, { status: 200 })
      }

      const storyIds = rankedStoryIds.map((r) => r.storyId)
      const latestBookmarkMap = new Map(rankedStoryIds.map((r) => [r.storyId, r.latestBookmarkAt]))

      // hydrate story + author for just this page's stories.
      const stories = await db.query.story.findMany({
        where: inArray(story.id, storyIds),
        columns: { id: true, title: true, description: true, createdAt: true, updatedAt: true },
        with: {
          author: { columns: { username: true } },
        },
      })

      // fetch every bookmarked chapter belonging to these stories,
      // for this user — this is the per-story chapter list.
      const bookmarkedChapters = await db
        .select({
          storyId: chapter.storyId,
          chapterId: chapter.id,
          title: chapter.title,
          chapterIndex: chapter.chapterIndex,
        })
        .from(bookmark)
        .innerJoin(chapter, eq(chapter.id, bookmark.chapterId))
        .where(and(eq(bookmark.userId, userId), inArray(chapter.storyId, storyIds)))

      const chaptersByStory = new Map<
        string,
        { id: string; title: string; chapterIndex: number | null }[]
      >()
      for (const c of bookmarkedChapters) {
        if (!chaptersByStory.has(c.storyId)) chaptersByStory.set(c.storyId, [])
        chaptersByStory
          .get(c.storyId)!
          .push({ id: c.chapterId, title: c.title, chapterIndex: c.chapterIndex })
      }

      const storyById = new Map(stories.map((s) => [s.id, s]))

      // assemble in the same order rankedStoryIds already sorted by
      // (most recently bookmarked story first) — no re-sorting needed.
      const paginatedStories = storyIds
        .map((id) => {
          const s = storyById.get(id)
          if (!s) return null
          return {
            id: s.id,
            title: s.title,
            author: { username: s.author.username },
            description: s.description,
            createdAt: s.createdAt,
            updatedAt: s.updatedAt,
            latestBookmarkAt: latestBookmarkMap.get(id)!,
            chapters: chaptersByStory.get(id) ?? [],
          }
        })
        .filter((s) => s !== null)

      // total distinct bookmarked-story count, for hasMore/pagination.
      const [{ count: totalCount }] = await db
        .select({ count: sql<number>`count(distinct ${chapter.storyId})`.mapWith(Number) })
        .from(bookmark)
        .innerJoin(chapter, eq(chapter.id, bookmark.chapterId))
        .where(eq(bookmark.userId, userId))

      const hasMore = page * limit < totalCount
      const totalPages = Math.ceil(totalCount / limit)
      const nextPage = hasMore ? page + 1 : null

      return c.json(
        {
          success: true,
          bookmarks: paginatedStories,
          totalCount,
          currentPage: page,
          next: nextPage,
          totalPages,
          hasMore,
        },
        { status: 200 },
      )
    } catch (err) {
      captureException(err)
      return c.json({ success: false }, { status: 500 })
    }
  },
)

app.get(
  '/:username/follow',
  // describeRoute({
  //   description: 'Follow a user',
  //   responses: {
  //     200: {
  //       description: 'Successful response',
  //       content: {
  //         'application/json': { schema: resolver(v.object({ success: v.boolean() })) },
  //       },
  //     },
  //   },
  // }),
  validator('param', requestParamSchema),
  withDatabase,
  async (c) => {
    const { username } = c.req.valid('param')

    const user = c.get('user')

    if (!user) {
      return c.json({ success: false }, { status: 401 })
    }

    const userId = user.id
    const db = c.get('db')

    const targetUser = await db.query.user.findFirst({
      where: eq(userTable.username, username),
      columns: { id: true },
    })

    if (!targetUser) {
      return c.json({ success: false }, { status: 404 })
    }

    if (targetUser.id === userId) {
      return c.json({ success: false }, { status: 400 })
    }

    try {
      await db.transaction(async (tx) => {
        const [createdFollow] = await tx
          .insert(follow)
          .values({ followerId: userId, followeeId: targetUser.id })
          .onConflictDoNothing()
          .returning()

        // Already following — no-op, don't spam another activity/notification.
        if (!createdFollow) return null

        const [createdActivity] = await tx
          .insert(activity)
          .values({ actorId: userId, verb: 'USER_FOLLOWED', targetUserId: targetUser.id })
          .returning({ id: activity.id })

        await tx.insert(notification).values({
          ownerId: targetUser.id,
          activityId: createdActivity.id,
        })

        return createdFollow
      })

      return c.json({ success: true }, { status: 200 })
    } catch (err) {
      captureException(err)
      return c.json({ success: false }, { status: 500 })
    }
  },
)

app.delete(
  '/:username/follow',
  // describeRoute({
  //   description: 'Unfollow a user',
  //   responses: {
  //     200: {
  //       description: 'Successful response',
  //       content: {
  //         'application/json': { schema: resolver(v.object({ success: v.boolean() })) },
  //       },
  //     },
  //   },
  // }),
  validator('param', requestParamSchema),
  withDatabase,
  async (c) => {
    const { username } = c.req.valid('param')

    const user = c.get('user')

    if (!user) {
      return c.json({ success: false }, { status: 401 })
    }

    const userId = user.id
    const db = c.get('db')

    const targetUser = await db.query.user.findFirst({
      where: eq(userTable.username, username),
      columns: { id: true },
    })

    if (!targetUser) {
      return c.json({ success: false }, { status: 404 })
    }

    try {
      await db.transaction(async (tx) => {
        const [removed] = await tx
          .delete(follow)
          .where(and(eq(follow.followerId, userId), eq(follow.followeeId, targetUser.id)))
          .returning()

        // Wasn't following in the first place — no-op.
        if (!removed) return null

        // Deleting the activity cascades to notification/feedItem rows
        // referencing it (both declared onDelete: 'cascade'), so this
        // single delete cleans up the fan-out too.
        await tx
          .delete(activity)
          .where(
            and(
              eq(activity.actorId, userId),
              eq(activity.verb, 'USER_FOLLOWED'),
              eq(activity.targetUserId, targetUser.id),
            ),
          )

        return removed
      })

      return c.json({ success: true }, { status: 200 })
    } catch (err) {
      captureException(err)
      return c.json({ success: false }, { status: 500 })
    }
  },
)

app.get(
  '/:username/stories',
  // describeRoute({
  //   description: 'Fetch a paginated list of stories written by the authenticated user.',
  //   responses: {
  //     200: {
  //       description: 'Successful response',
  //       content: {
  //         'application/json': { schema: resolver(responseSchema) },
  //       },
  //     },
  //   },
  // }),
  validator('param', requestParamSchema),
  validator('query', requestQuerySchema),
  withDatabase,
  async (c) => {
    const { page, limit } = c.req.valid('query')
    const { username } = c.req.valid('param')

    const user = c.get('user')
    const userId = user?.id ?? ''
    const db = c.get('db')

    const offset = (page - 1) * limit

    const targetUser = await db.query.user.findFirst({
      where: eq(userTable.username, username),
      columns: { id: true },
    })

    if (!targetUser) {
      return c.json({ success: false }, { status: 404 })
    }

    try {
      const [stories, [{ count: totalCount }]] = await Promise.all([
        db.query.story.findMany({
          where: eq(story.authorId, targetUser.id),
          orderBy: desc(story.createdAt),
          limit,
          offset,
          with: storyWithForUser(userId),
        }),
        db
          .select({ count: sql<number>`count(*)`.mapWith(Number) })
          .from(story)
          .where(eq(story.authorId, targetUser.id)),
      ])

      const totalPages = Math.ceil(totalCount / limit)
      const hasMore = page < totalPages
      const nextPage = hasMore ? page + 1 : null

      return c.json(
        {
          success: true,
          stories,
          totalCount,
          currentPage: page,
          next: nextPage,
          totalPages,
          hasMore,
        },
        { status: 200 },
      )
    } catch (err) {
      captureException(err)
      return c.json({ success: false }, { status: 500 })
    }
  },
)

app.get(
  '/:username',
  // describeRoute({
  //   description: 'Fetch user details by the username param.',
  //   responses: {
  //     200: {
  //       description: 'Successful response',
  //       content: {
  //         'application/json': { schema: resolver(v.any()) },
  //       },
  //     },
  //   },
  // }),
  validator('param', requestParamSchema),
  withDatabase,
  async (c) => {
    const { username } = c.req.valid('param')

    const user = c.get('user')
    const userId = user?.id ?? ''
    const db = c.get('db')

    const targetUser = await db.query.user.findFirst({
      where: eq(userTable.username, username),
      with: {
        // "followers" here = follow rows where this user is the followee,
        // filtered to just the current session user's row (if any) to
        // answer "does the viewer follow this profile?"
        followers: {
          where: eq(follow.followerId, userId),
          columns: { followerId: true, followeeId: true },
        },
      },
    })

    if (!targetUser) {
      return c.json({ success: false }, { status: 404 })
    }

    try {
      const [{ storyCount, followingCount, followersCount }] = await db
        .select({
          storyCount:
            sql<number>`(select count(*) from ${story} where ${story.authorId} = ${targetUser.id})`.mapWith(
              Number,
            ),
          followingCount:
            sql<number>`(select count(*) from ${follow} where ${follow.followerId} = ${targetUser.id})`.mapWith(
              Number,
            ),
          followersCount:
            sql<number>`(select count(*) from ${follow} where ${follow.followeeId} = ${targetUser.id})`.mapWith(
              Number,
            ),
        })
        .from(sql`(select 1) as _dummy`)

      return c.json(
        { success: true, user: targetUser, storyCount, followingCount, followersCount },
        { status: 200 },
      )
    } catch (err) {
      captureException(err)
      return c.json({ success: false }, { status: 500 })
    }
  },
)

export { app as user }
