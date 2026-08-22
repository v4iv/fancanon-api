import { Hono } from 'hono'
import { desc, eq } from 'drizzle-orm'
import { describeRoute, resolver } from 'hono-openapi'

import { AppContext } from '@/types'
import { withDatabase } from '@/lib/db'
import { statsResponseSchema, storiesResponseSchema } from './schema'
import { getAuthorStats } from '@/lib/helpers/stats-helper'
import { story } from '@/lib/db/schema'

const app = new Hono<AppContext>()

app.get(
  '/stats',
  describeRoute({
    description: 'Fetch Author Stats',
    responses: {
      200: {
        description: 'Successful response',
        content: {
          'application/json': { schema: resolver(statsResponseSchema) },
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
      const stats = await getAuthorStats(db, userId)

      return c.json({ success: true, stats }, { status: 200 })
    } catch (err) {
      console.error(err)
      return c.json({ success: false }, { status: 500 })
    }
  },
)

app.get(
  '/stories',
  describeRoute({
    description: 'Fetch All Stories',
    responses: {
      200: {
        description: 'Successful response',
        content: {
          'application/json': { schema: resolver(storiesResponseSchema) },
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
      const stories = await db
        .select()
        .from(story)
        .where(eq(story.authorId, userId))
        .orderBy(desc(story.createdAt))

      return c.json({ success: true, stories }, { status: 200 })
    } catch (err) {
      console.error(err)

      return c.json({ success: false }, { status: 500 })
    }
  },
)

export { app as dashboard }
