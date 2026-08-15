import { Hono } from 'hono'
import { eq, and, sql, isNull, asc } from 'drizzle-orm'
import { describeRoute, resolver, validator } from 'hono-openapi'

import { AppContext, CommentType } from '@/lib/types.d'
import { withDatabase } from '@/lib/db'
import { bookmark, chapter, comment, commentLike, story } from '@/lib/db/schema'
import {
  requestParamSchema,
  actionResponseSchema,
  requestQuerySchema,
  commentsResponseSchema,
} from './schema'

const app = new Hono<AppContext>()

app.delete(
  '/:chapterId',
  describeRoute({
    description: 'Delete a chapter.',
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
    const { chapterId } = c.req.valid('param')

    const user = c.get('user')

    if (!user) {
      return c.json({ success: false }, { status: 401 })
    }

    const userId = user.id
    const db = c.get('db')

    try {
      const result = await db.transaction(async (tx) => {
        const [deleted] = await tx
          .delete(chapter)
          .where(and(eq(chapter.id, chapterId), eq(chapter.authorId, userId)))
          .returning({ storyId: chapter.storyId })

        if (!deleted) return null

        await tx
          .update(story)
          .set({ chapterCount: sql`GREATEST(${story.chapterCount} - 1, 0)` })
          .where(eq(story.id, deleted.storyId))

        return deleted
      })

      if (result) {
        return c.json({ success: true }, { status: 200 })
      }

      // Delete matched nothing — figure out why, for an accurate error response.
      const [existing] = await db
        .select({ id: chapter.id })
        .from(chapter)
        .where(eq(chapter.id, chapterId))

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
  '/:chapterId/bookmark',
  describeRoute({
    description: 'Add bookmark to a chapter.',
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
    const { chapterId } = c.req.valid('param')

    const user = c.get('user')

    if (!user) {
      return c.json({ success: false }, { status: 401 })
    }

    const userId = user.id
    const db = c.get('db')

    try {
      const [created] = await db
        .insert(bookmark)
        .values({ userId, chapterId })
        .onConflictDoNothing()
        .returning()

      // Already bookmarked — fetch and return the existing row instead of erroring.
      if (!created) {
        const [existing] = await db
          .select()
          .from(bookmark)
          .where(and(eq(bookmark.userId, userId), eq(bookmark.chapterId, chapterId)))
        return c.json({ success: true, bookmark: existing }, { status: 200 })
      }

      return c.json({ success: true })
    } catch (err) {
      console.error(err)
      return c.json({ success: false }, { status: 500 })
    }
  },
)

app.delete(
  '/:chapterId/bookmark',
  describeRoute({
    description: 'Remove bookmark from a chapter.',
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
    const { chapterId } = c.req.valid('param')

    const user = c.get('user')

    if (!user) {
      return c.json({ success: false }, { status: 401 })
    }

    const userId = user.id
    const db = c.get('db')

    try {
      await db
        .delete(bookmark)
        .where(and(eq(bookmark.userId, userId), eq(bookmark.chapterId, chapterId)))
        .returning()

      return c.json({ success: true })
    } catch (err) {
      console.error(err)
      return c.json({ success: false }, { status: 500 })
    }
  },
)

app.get(
  '/:chapterId/comments',
  describeRoute({
    description: 'Get a paginated list of all comments of a chapter.',
    responses: {
      200: {
        description: 'Successful response',
        content: {
          'application/json': { schema: resolver(commentsResponseSchema) },
        },
      },
    },
  }),
  validator('query', requestQuerySchema),
  validator('param', requestParamSchema),
  withDatabase,
  async (c) => {
    const { chapterId } = c.req.valid('param')
    const { page, limit } = c.req.valid('query')
    const offset = (page - 1) * limit

    const user = c.get('user')
    const userId = user?.id ?? ''
    const db = c.get('db')

    try {
      // Step 1: paginate ONLY top-level comments — bounded by `limit`, not
      // by total comments on the chapter.
      const topLevel = await db.query.comment.findMany({
        where: and(eq(comment.chapterId, chapterId), isNull(comment.parentId)),
        orderBy: asc(comment.createdAt),
        limit,
        offset,
        with: {
          author: true,
          likes: {
            where: eq(commentLike.userId, userId),
            columns: { userId: true, commentId: true },
          },
        },
      })

      if (topLevel.length === 0) {
        const [{ count: totalCount }] = await db
          .select({ count: sql<number>`count(*)`.mapWith(Number) })
          .from(comment)
          .where(and(eq(comment.chapterId, chapterId), isNull(comment.parentId)))

        return c.json({
          success: true,
          comments: [],
          totalCount,
          totalPages: Math.max(1, Math.ceil(totalCount / limit)),
          nextPage: null,
          hasMore: false,
        })
      }

      // Step 2: fetch every descendant of just these top-level comments.
      // Still bounded work — proportional to reply activity under THIS
      // page's comments, not the whole chapter's history.
      const topLevelIds = topLevel.map((c) => c.id)

      const replyIds = (
        await db.execute<{ id: string }>(
          sql`
        WITH RECURSIVE reply_tree AS (
          SELECT id, parent_id, 1 AS depth
          FROM ${comment}
          WHERE parent_id IN ${topLevelIds}
          UNION ALL
          SELECT c.id, c.parent_id, rt.depth + 1
          FROM ${comment} c
          JOIN reply_tree rt ON c.parent_id = rt.id
        )
        SELECT id FROM reply_tree
        `,
        )
      ).map((r: any) => r.id)

      const replies =
        replyIds.length > 0
          ? await db.query.comment.findMany({
              where: sql`${comment.id} IN ${replyIds}`,
              orderBy: asc(comment.createdAt),
              with: {
                author: { columns: { id: true, name: true, image: true, username: true } },
                likes: {
                  where: eq(commentLike.userId, userId),
                  columns: { userId: true, commentId: true },
                },
              },
            })
          : []

      const allComments = [...topLevel, ...replies]

      function buildTree(
        comments: Array<Partial<CommentType>>,
        parentId: string | null = null,
        depth = 0,
      ): Array<Partial<Omit<CommentType, 'replies'>>> {
        return comments
          .filter((c) => c.parentId === parentId)
          .map((c) => ({ ...c, depth, replies: buildTree(comments, c.id, depth + 1) }))
      }

      const commentTree = buildTree(allComments)

      const [{ count: totalCount }] = await db
        .select({ count: sql<number>`count(*)`.mapWith(Number) })
        .from(comment)
        .where(and(eq(comment.chapterId, chapterId), isNull(comment.parentId)))

      const totalPages = Math.ceil(totalCount / limit)
      const hasMore = page < totalPages

      return c.json({
        success: true,
        comments: commentTree,
        totalCount,
        totalPages,
        hasMore,
        nextPage: hasMore ? page + 1 : null,
      })
    } catch (err) {
      console.error(err)
      return c.json({ success: false }, { status: 500 })
    }
  },
)

export { app as chapters }
