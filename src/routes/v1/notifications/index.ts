import { Hono } from 'hono'
import * as v from 'valibot'
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { describeRoute, resolver, validator } from 'hono-openapi'

import { AppContext } from '@/types'
import { withDatabase } from '@/lib/db'
import { notification } from '@/lib/db/schema'
import {
  indicatorResponseSchema,
  requestQuerySchema,
  requestSchema,
  responseSchema,
} from './schema'

const app = new Hono<AppContext>()

app.get(
  '/',
  describeRoute({
    description: 'Fetch paginated list of notifications of the authenticated user.',
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
      const [notifications, counts] = await Promise.all([
        db.query.notification.findMany({
          where: eq(notification.ownerId, userId),
          orderBy: desc(notification.createdAt),
          limit,
          offset,
          with: {
            activity: {
              columns: { id: true, verb: true, createdAt: true },
              with: {
                actor: { columns: { id: true, username: true } },
                story: { columns: { id: true, title: true } },
                chapter: { columns: { id: true, title: true, chapterIndex: true, storyId: true } },
                comment: {
                  columns: { id: true, content: true, parentId: true, chapterId: true },
                  with: {
                    chapter: { columns: { storyId: true } },
                  },
                },
                targetUser: { columns: { id: true, username: true } },
              },
            },
          },
        }),

        db
          .select({
            total: sql<number>`count(*)`.mapWith(Number),
            unseen: sql<number>`count(*) filter (where ${isNull(notification.seenAt)})`.mapWith(
              Number,
            ),
          })
          .from(notification)
          .where(eq(notification.ownerId, userId)),
      ])

      const { total: totalCount, unseen: unseenCount } = counts[0]
      const totalPages = Math.ceil(totalCount / limit)
      const hasMore = page < totalPages
      const next = hasMore ? page + 1 : null

      return c.json(
        {
          success: true,
          notifications,
          unseenCount,
          totalCount,
          currentPage: page,
          next,
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

app.post(
  '/',
  describeRoute({
    description: 'Mark notifications as seen',
    responses: {
      200: {
        description: 'Successful response',
        content: {
          'application/json': { schema: resolver(v.object({ success: v.boolean() })) },
        },
      },
    },
  }),
  validator('json', requestSchema),
  withDatabase,
  async (c) => {
    const { notificationIds } = c.req.valid('json')

    const user = c.get('user')

    if (!user) {
      return c.json({ success: false }, { status: 401 })
    }

    if (notificationIds.length === 0) {
      return c.json({ success: true }, { status: 200 })
    }

    const userId = user.id
    const db = c.get('db')

    try {
      await db
        .update(notification)
        .set({ seenAt: new Date() })
        .where(
          and(
            inArray(notification.id, notificationIds),
            eq(notification.ownerId, userId),
            isNull(notification.seenAt),
          ),
        )

      return c.json({ success: true }, { status: 200 })
    } catch (err) {
      console.error(err)
      return c.json({ success: false }, { status: 500 })
    }
  },
)

app.get(
  '/indicator',
  describeRoute({
    description: 'Get the notification indicator with unseen notifications count.',
    responses: {
      200: {
        description: 'Successful response',
        content: {
          'application/json': { schema: resolver(indicatorResponseSchema) },
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
      const [{ count: unseenCount }] = await db
        .select({ count: sql<number>`count(*)`.mapWith(Number) })
        .from(notification)
        .where(and(eq(notification.ownerId, userId), isNull(notification.seenAt)))

      return c.json({ success: true, unseenCount }, { status: 200 })
    } catch (err) {
      console.error(err)
      return c.json({ success: false }, { status: 500 })
    }
  },
)

export { app as notifications }
