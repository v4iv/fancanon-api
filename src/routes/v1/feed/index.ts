import { Hono } from 'hono'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { describeRoute, resolver, validator } from 'hono-openapi'

import { AppContext } from '@/lib/types'
import { withDatabase } from '@/lib/db'
import { LIKES_WEIGHT, READ_LATER_WEIGHT, TRENDING_GRAVITY } from '@/lib/constants'
import { category, fandom, like, readLater, story, storyFandom } from '@/lib/db/schema'
import {
  buildStoryFilterSql,
  getRankedStories,
  hydrateRankedStories,
} from '@/lib/helpers/feed-helper'
import { storyWithForUser } from '@/lib/helpers/story-helper'
import { feedParamSchema, feedQuerySchema, feedResponseSchema } from './schema'

const app = new Hono<AppContext>()

app.get(
  '/new',
  describeRoute({
    description:
      'Fetches a paginated list of the most recently published stories sorted by creation date.',
    responses: {
      200: {
        description: 'Successful response',
        content: {
          'application/json': { schema: resolver(feedResponseSchema) },
        },
      },
    },
  }),
  validator('query', feedQuerySchema),
  withDatabase,
  async (c) => {
    const { page, limit } = c.req.valid('query')

    const db = c.get('db')

    const user = c.get('user')
    const userId = user?.id ?? ''
    const offset = (page - 1) * limit

    try {
      const latest = await db.query.story.findMany({
        orderBy: desc(story.createdAt),
        limit,
        offset,
        with: storyWithForUser(userId),
      })

      const [{ count: totalCount }] = await db
        .select({ count: sql<number>`count(*)`.mapWith(Number) })
        .from(story)

      const totalPages = Math.ceil(totalCount / limit)
      const hasMore = page < totalPages
      const nextPage = hasMore ? page + 1 : null

      return c.json(
        {
          success: true,
          stories: latest,
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

app.get(
  '/hot',
  describeRoute({
    description:
      'Fetches globally trending stories ordered by a Hacker-News-style time-decay score. Score is calculated using weighted user interactions (likes, read laters) relative to story age.',
    responses: {
      200: {
        description: 'Successful response',
        content: {
          'application/json': { schema: resolver(feedResponseSchema) },
        },
      },
    },
  }),
  validator('query', feedQuerySchema),
  withDatabase,
  async (c) => {
    const { page, limit } = c.req.valid('query')

    const db = c.get('db')

    const user = c.get('user')
    const userId = user?.id ?? ''
    const offset = (page - 1) * limit

    try {
      // rank = score / (age_in_hours + 2) ^ gravity — Hacker-News-style decay.
      // No hard time cutoff: a story that goes viral weeks after publishing
      // can still surface, decay alone determines what's "hot" right now.
      const weightedScore = sql`(${story.likeCount} * ${LIKES_WEIGHT} + ${story.readLaterCount} * ${READ_LATER_WEIGHT})`

      const rankedStories = await getRankedStories({
        db,
        scoreSql: weightedScore,
        gravity: TRENDING_GRAVITY,
        limit,
        offset,
      })

      if (rankedStories.length === 0) {
        return c.json({
          success: true,
          stories: [],
          currentPage: page,
          next: null,
          totalPages: 1,
          hasMore: false,
        })
      }

      const storyIds = rankedStories.map((s) => s.id)
      const scoreMap = Object.fromEntries(rankedStories.map((s) => [s.id, s.score]))

      const stories = await db.query.story.findMany({
        where: inArray(story.id, storyIds),
        with: {
          author: { columns: { id: true, username: true } },
          tags: {
            columns: {},
            with: {
              tag: { columns: { id: true, name: true, slug: true, type: true } },
            },
          },
          fandoms: {
            columns: {},
            with: { fandom: { columns: { id: true, name: true, slug: true } } },
          },
          likes: {
            where: eq(like.userId, userId),
            columns: { userId: true, storyId: true },
          },
          readLaters: {
            where: eq(readLater.userId, userId),
            columns: { userId: true, storyId: true },
          },
        },
      })

      const storyMap = new Map(stories.map((s) => [s.id, s]))
      const sortedStories = storyIds
        .map((id) => {
          const s = storyMap.get(id)
          return s ? { ...s, score: scoreMap[id] } : null
        })
        .filter((s) => s !== null)

      const [{ count: totalCount }] = await db
        .select({ count: sql<number>`count(*)`.mapWith(Number) })
        .from(story)

      const totalPages = Math.ceil(totalCount / limit)
      const hasMore = page < totalPages
      const nextPage = hasMore ? page + 1 : null

      return c.json(
        {
          success: true,
          stories: sortedStories,
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

app.get(
  '/:slug',

  describeRoute({
    description:
      'Fetches a decay-ranked trending feed for stories within a specific category. Supports additional filtering by language, completion status, and content rating.',
    responses: {
      200: {
        description: 'Successful response',
        content: {
          'application/json': { schema: resolver(feedResponseSchema) },
        },
      },
    },
  }),
  validator('query', feedQuerySchema),
  validator('param', feedParamSchema),
  withDatabase,
  async (c) => {
    const { page, limit, completion, languages, ratings } = c.req.valid('query')
    const { slug } = c.req.valid('param')

    const db = c.get('db')

    const categoryRow = await db.query.category.findFirst({
      where: eq(category.slug, slug),
      columns: { id: true },
    })

    if (!categoryRow) {
      return c.json({ success: false }, { status: 404 })
    }

    const user = c.get('user')
    const userId = user?.id ?? ''
    const offset = (page - 1) * limit

    // stories whose fandom belongs to this category — merged across every
    // fandom in the category, ranked as one decay-sorted list (not grouped
    // or sorted per-fandom)
    const categoryExists = sql`EXISTS (
		SELECT 1 FROM story_fandom sf
		JOIN fandom f ON f.id = sf.fandom_id
		WHERE sf.story_id = ${story.id} AND f.category_id = ${categoryRow.id}
	)`

    const filterWhere = buildStoryFilterSql({
      languages,
      contentRating: ratings,
      completion,
    })

    const combinedWhere = filterWhere ? and(categoryExists, filterWhere) : categoryExists

    try {
      const hotRows = await getRankedStories({
        db,
        extraWhere: combinedWhere,
        limit,
        offset,
      })

      const sortedStories = await hydrateRankedStories(
        db,
        hotRows.map((r) => r.id),
        Object.fromEntries(hotRows.map((r) => [r.id, r.score])),
        userId,
      )

      const [{ count: totalCount }] = await db
        .select({
          count: sql<number>`count(distinct ${story.id})`.mapWith(Number),
        })
        .from(story)
        .innerJoin(storyFandom, eq(storyFandom.storyId, story.id))
        .innerJoin(fandom, eq(fandom.id, storyFandom.fandomId))
        .where(
          filterWhere
            ? and(eq(fandom.categoryId, categoryRow.id), filterWhere)
            : eq(fandom.categoryId, categoryRow.id),
        )

      const totalPages = Math.ceil(totalCount / limit)
      const hasMore = page < totalPages
      const nextPage = hasMore ? page + 1 : null

      return c.json(
        {
          success: true,
          stories: sortedStories,
          totalCount,
          currentPage: page,
          nextPage,
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

export { app as feed }
