import { Hono } from 'hono'
import { and, asc, desc, eq, ilike, ne, or, sql } from 'drizzle-orm'
import { describeRoute, resolver, validator } from 'hono-openapi'

import { AppContext } from '@/types'
import { withDatabase } from '@/lib/db'
import { fandom, story } from '@/lib/db/schema'
import {
  requestParamSchema,
  requestQuerySchema,
  responseSchema,
  searchRequestQuerySchema,
  searchResponseSchema,
} from './schema'
import {
  buildStoryFilterSql,
  getRankedStories,
  hydrateRankedStories,
} from '@/lib/helpers/feed-helper'
import { storyWithForUser } from '@/lib/helpers/story-helper'

const app = new Hono<AppContext>()

app.get(
  '/search',
  describeRoute({
    description: 'Search fandoms API.',
    responses: {
      200: {
        description: 'Successful response',
        content: {
          'application/json': { schema: resolver(searchResponseSchema) },
        },
      },
    },
  }),
  validator('query', searchRequestQuerySchema),
  withDatabase,
  async (c) => {
    const { q: query, limit } = c.req.valid('query')

    const db = c.get('db')

    try {
      const pattern = `%${query}%`

      const fandoms = await db
        .select({ id: fandom.id, slug: fandom.slug, name: fandom.name })
        .from(fandom)
        .where(
          and(
            ne(fandom.name, 'Original Content'),
            or(
              ilike(fandom.name, pattern),
              ilike(fandom.slug, pattern),
              ilike(fandom.description, pattern),
            ),
          ),
        )
        .limit(limit)

      const results = fandoms.map((f) => ({ label: f.name, value: f.id }))

      return c.json({ results, success: true }, { status: 200 })
    } catch (err) {
      console.error(err)
      return c.json({ success: false }, { status: 500 })
    }
  },
)

app.get(
  '/:slug',
  describeRoute({
    description: 'Fetch stories from fandom slug path param.',
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
  validator('param', requestParamSchema),
  withDatabase,
  async (c) => {
    const { page, limit, completion, languages, ratings, sort } = c.req.valid('query')
    const { slug } = c.req.valid('param')

    const user = c.get('user')
    const userId = user?.id ?? ''
    const db = c.get('db')

    const offset = (page - 1) * limit

    const fandomRow = await db.query.fandom.findFirst({
      where: eq(fandom.slug, slug),
      columns: { id: true },
    })

    if (!fandomRow) {
      return c.json({ success: false }, { status: 404 })
    }

    const fandomExists = sql`EXISTS (
		SELECT 1 FROM story_fandom sf
		WHERE sf.story_id = ${story.id} AND sf.fandom_id = ${fandomRow.id}
    )`

    const filterWhere = buildStoryFilterSql({ languages, contentRating: ratings, completion })
    const combinedWhere = filterWhere ? and(fandomExists, filterWhere) : fandomExists

    try {
      let sortedStories

      if (sort === 'hot') {
        const hotRows = await getRankedStories({ db, extraWhere: combinedWhere, limit, offset })
        sortedStories = await hydrateRankedStories(
          db,
          hotRows.map((r) => r.id),
          Object.fromEntries(hotRows.map((r) => [r.id, r.score])),
          userId,
        )
      } else {
        sortedStories = await db.query.story.findMany({
          where: combinedWhere,
          orderBy: sort === 'old' ? asc(story.createdAt) : desc(story.createdAt),
          limit,
          offset,
          with: storyWithForUser(userId),
        })
      }

      const [{ count: totalCount }] = await db
        .select({ count: sql<number>`count(*)`.mapWith(Number) })
        .from(story)
        .where(combinedWhere)

      const totalPages = Math.ceil(totalCount / limit)
      const hasMore = page < totalPages
      const nextPage = hasMore ? page + 1 : null

      return c.json(
        {
          success: true,
          stories: sortedStories,
          totalCount,
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

export { app as fandoms }
