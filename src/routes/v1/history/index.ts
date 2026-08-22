import { Hono } from 'hono'
import * as v from 'valibot'
import { and, desc, eq, sql } from 'drizzle-orm'
import { describeRoute, resolver, validator } from 'hono-openapi'

import { AppContext } from '@/types'
import { withDatabase } from '@/lib/db'
import { history } from '@/lib/db/schema'
import { requestParamSchema, requestQuerySchema, responseSchema } from './schema'

const app = new Hono<AppContext>()

app.get(
  '/',
  describeRoute({
    description: "Fetch a paginated list of user's history.",
    responses: {
      200: {
        description: 'Successful response',
        content: {
          'application/json': { schema: resolver(responseSchema) },
        },
      },
    },
  }),
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
      const items = await db.query.history.findMany({
        where: eq(history.userId, userId),
        orderBy: desc(history.lastViewedAt),
        limit,
        offset,
        with: {
          chapter: {
            columns: { id: true, title: true, chapterIndex: true },
          },
          story: {
            columns: { id: true, title: true },
            with: {
              author: { columns: { id: true, username: true } },
            },
          },
        },
      })

      const [{ count: totalCount }] = await db
        .select({ count: sql<number>`count(*)`.mapWith(Number) })
        .from(history)
        .where(eq(history.userId, userId))

      const totalPages = Math.max(1, Math.ceil(totalCount / limit))
      const hasMore = page < totalPages
      const nextPage = hasMore ? page + 1 : null

      return c.json(
        {
          success: true,
          history: items,
          currentPage: page,
          next: nextPage,
          totalPages,
          hasMore,
        },
        { status: 200 },
      )
    } catch (err) {
      console.error(err)
      return c.json({ success: false }, { status: 500 })
    }
  },
)

app.delete(
  '/',
  describeRoute({
    description: 'Clear all history of a user.',
    responses: {
      200: {
        description: 'Successful response',
        content: {
          'application/json': { schema: resolver(v.object({ success: v.boolean() })) },
        },
      },
    },
  }),
  withDatabase,
  async (c) => {
    const user = c.get('user')

    if (!user) {
      return c.json({ success: false }, { status: 401 })
    }

    const userId = user.id
    const db = c.get('db')

    try {
      await db.delete(history).where(eq(history.userId, userId))

      return c.json({ success: true }, { status: 200 })
    } catch (err) {
      console.error(err)
      return c.json({ success: false }, { status: 500 })
    }
  },
)

app.delete(
  '/:chapterId',
  describeRoute({
    description: "Delete a single item from a user's history",
    responses: {
      200: {
        description: 'Successful response',
        content: {
          'application/json': { schema: resolver(v.object({ success: v.boolean() })) },
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
      const [deleted] = await db
        .delete(history)
        .where(and(eq(history.userId, userId), eq(history.chapterId, chapterId)))
        .returning({ chapterId: history.chapterId })

      if (!deleted) {
        return c.json({ success: false }, { status: 404 })
      }

      return c.json({ success: true }, { status: 200 })
    } catch (err) {
      console.error(err)
      return c.json({ success: false }, { status: 500 })
    }
  },
)

export { app as history }
