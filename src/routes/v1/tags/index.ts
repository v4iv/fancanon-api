import { Hono } from 'hono'
import { and, asc, desc, eq, ilike, inArray, sql } from 'drizzle-orm'
import { describeRoute, resolver, validator } from 'hono-openapi'

import { AppContext } from '@/types'
import { withDatabase } from '@/lib/db'
import { story, tag, tagTypeEnum } from '@/lib/db/schema'
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
    description: 'Search tags API.',
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
    const { q: query, type, limit } = c.req.valid('query')

    const db = c.get('db')

    const types: (typeof tagTypeEnum.enumValues)[number][] =
      type === 'FREEFORM'
        ? ['FREEFORM', 'FANDOM_FREEFORM']
        : [type as (typeof tagTypeEnum.enumValues)[number]]

    try {
      const pattern = `%${query}%`

      const tags = await db
        .select({ name: tag.name, usageCount: tag.usageCount })
        .from(tag)
        .where(and(inArray(tag.type, types), ilike(tag.name, pattern)))
        .orderBy(desc(tag.usageCount), asc(tag.name))
        .limit(limit)

      return c.json(
        tags.map((t) => t.name),
        { status: 200 },
      )
    } catch (err) {
      console.error(err)
      return c.json({ success: false }, { status: 500 })
    }
  },
)

app.get(
  '/:slug',
  describeRoute({
    description: 'Fetch stories from tag slug path param.',
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

    const tagRow = await db.query.tag.findFirst({
      where: eq(tag.slug, slug),
      columns: { id: true },
    })

    if (!tagRow) {
      return c.json({ success: false }, { status: 404 })
    }

    const tagExists = sql`EXISTS (
		SELECT 1 FROM story_tag st
		WHERE st.story_id = ${story.id} AND st.tag_id = ${tagRow.id}
    )`

    const filterWhere = buildStoryFilterSql({ languages, contentRating: ratings, completion })
    const combinedWhere = filterWhere ? and(tagExists, filterWhere) : tagExists

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

export { app as tags }
