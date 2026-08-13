import { Hono } from 'hono'
import { describeRoute, resolver, validator } from 'hono-openapi'
import { and, asc, desc, eq, inArray, or, sql, type SQL } from 'drizzle-orm'

import { AppContext } from '@/lib/types'
import { withDatabase } from '@/lib/db'
import { story, tag } from '@/lib/db/schema'
import { storyWithForUser } from '@/lib/helpers/story-helper'
import { searchQuerySchema, searchResponseSchema } from './schema'
import { SIMILARITY_THRESHOLD, WORD_SIMILARITY_THRESHOLD } from '@/lib/constants'

const app = new Hono<AppContext>()

app.get(
  '/',
  describeRoute({
    description: 'Searches the query against story title, desc, tags or author',
    responses: {
      200: {
        description: 'Successful response',
        content: {
          'application/json': { schema: resolver(searchResponseSchema) },
        },
      },
    },
  }),
  validator('query', searchQuerySchema),
  withDatabase,
  async (c) => {
    const {
      q: query,
      page,
      limit,
      languages,
      ratings,
      completion,
      sort,
      fandoms,
      includeTags,
      excludeTags,
    } = c.req.valid('query')

    const db = c.get('db')

    const user = c.get('user')
    const userId = user?.id ?? ''
    const offset = (page - 1) * limit

    // websearch_to_tsquery parses raw search-box input directly — punctuation,
    // quotes, "-exclude", etc. are handled internally, so no manual
    // sanitization is needed and no syntax errors are possible. Bare words are
    // ANDed together (must all match), unlike the old hand-rolled `term | term`
    // string which ORed them — AND narrows the candidate set faster against the
    // GIN index, and the trigram fuzzy matching below picks up looser/typo'd
    // cases this won't catch.
    const tsQuery = sql`websearch_to_tsquery('english', ${query})`

    // Plain query text, reused across every trigram comparison below.
    const fandomIds = fandoms ?? []

    // A tag can't be both required and forbidden — if the client sends an
    // overlap, include wins and the contradiction is dropped from exclude.
    let excludeTagNames = excludeTags ?? []
    const includeTagNames = includeTags ?? []

    if (includeTagNames.length > 0 && excludeTagNames.length > 0) {
      const includeSet = new Set(includeTagNames)

      excludeTagNames = excludeTagNames.filter((name) => !includeSet.has(name))
    }

    try {
      // Everything that touches trigram similarity — the tag lookup, and the
      // two story queries below — runs inside one transaction so SET LOCAL
      // applies consistently to all of it and can't leak onto other requests
      // sharing the connection pool.
      const [stories, [{ count: totalCount }]] = await db.transaction(async (tx) => {
        await tx.execute(
          sql.raw(`SET LOCAL pg_trgm.word_similarity_threshold = ${WORD_SIMILARITY_THRESHOLD}`),
        )

        await tx.execute(
          sql.raw(`SET LOCAL pg_trgm.similarity_threshold = ${SIMILARITY_THRESHOLD}`),
        )

        // Tag name matching: fuzzy similarity (%) instead of ILIKE, so a
        // typo'd tag name in the free-text query box still surfaces the tag's
        // stories.
        const tagMatches = await tx
          .select({ id: tag.id })
          .from(tag)
          .where(sql`${tag.name} % ${query}`)
        const tagMatchIds = tagMatches.map((t) => t.id)

        // Resolve requested include/exclude tag *names* to ids. Exact match against
        // tag.name (unique) rather than the fuzzy `%` used for free-text search above
        // — these come from a controlled tag picker, not typed prose.
        let includeTagIds: string[] = []
        let impossibleIncludeMatch = false

        if (includeTagNames.length > 0) {
          const resolved = await tx
            .select({ id: tag.id })
            .from(tag)
            .where(inArray(tag.name, includeTagNames))
          includeTagIds = resolved.map((t) => t.id)
          // If a requested name doesn't exist as a real tag, no story can carry it —
          // short-circuit to zero results instead of quietly requiring fewer tags
          // than the user actually asked for.
          if (includeTagIds.length < includeTagNames.length) {
            impossibleIncludeMatch = true
          }
        }

        let excludeTagIds: string[] = []

        if (excludeTagNames.length > 0) {
          const resolved = await tx
            .select({ id: tag.id })
            .from(tag)
            .where(inArray(tag.name, excludeTagNames))
          excludeTagIds = resolved.map((t) => t.id)
          // A name that doesn't exist has nothing to exclude — just drop it, no
          // need to short-circuit like the include case.
        }

        // title/description match: exact-ish full-text OR typo-tolerant word
        // similarity. word_similarity (<%) is used instead of similarity (%)
        // here because title/description are long-form text and we're
        // checking whether the query resembles *some* word within them, not
        // the whole string.
        const titleDescMatch = sql`(
          to_tsvector('english', ${story.title} || ' ' || coalesce(${story.description}, '')) @@ ${tsQuery}
          OR ${query} <% ${story.title}
          OR ${query} <% coalesce(${story.description}, '')
        )`

        // author username/name match, via EXISTS against user — same
        // full-text + fuzzy combination as titleDescMatch.
        const authorMatch = sql`EXISTS (
          SELECT 1 FROM "user" u
          WHERE u.id = ${story.authorId}
          AND (
            to_tsvector('english', coalesce(u.username, '') || ' ' || coalesce(u.name, '')) @@ ${tsQuery}
            OR ${query} <% coalesce(u.username, '')
            OR ${query} <% coalesce(u.name, '')
          )
        )`

        const searchConditions = [titleDescMatch, authorMatch]

        if (tagMatchIds.length > 0) {
          searchConditions.push(sql`EXISTS (
            SELECT 1 FROM story_tag st
            WHERE st.story_id = ${story.id} AND st.tag_id IN ${tagMatchIds}
          )`)
        }

        const filters: SQL[] = [or(...searchConditions)!]

        if (languages && languages.length > 0) {
          filters.push(inArray(story.language, languages))
        }

        if (completion === 'completed') {
          filters.push(eq(story.completed, true))
        } else if (completion === 'ongoing') {
          filters.push(eq(story.completed, false))
        }

        if (ratings && ratings.length > 0) {
          filters.push(
            inArray(
              story.contentRating,
              ratings as (typeof story.contentRating.enumValues)[number][],
            ),
          )
        }

        if (fandomIds.length > 0) {
          filters.push(sql`EXISTS (
            SELECT 1 FROM story_fandom sf
            WHERE sf.story_id = ${story.id} AND sf.fandom_id IN ${fandomIds}
          )`)
        }

        if (impossibleIncludeMatch) {
          filters.push(sql`false`)
        } else if (includeTagIds.length > 0) {
          // Story must carry every requested tag, not just one of them — count
          // distinct matches against the resolved id set and require full coverage.
          filters.push(sql`(
            SELECT COUNT(DISTINCT st.tag_id) FROM story_tag st
            WHERE st.story_id = ${story.id} AND st.tag_id IN ${includeTagIds}
          ) = ${includeTagIds.length}`)
        }

        if (excludeTagIds.length > 0) {
          filters.push(sql`NOT EXISTS (
            SELECT 1 FROM story_tag st
            WHERE st.story_id = ${story.id} AND st.tag_id IN ${excludeTagIds}
          )`)
        }

        const where = and(...filters)

        // Blend exact/stemmed rank with trigram similarity so typo-only
        // matches (ts_rank = 0, since to_tsquery found no lexeme match) still
        // rank above zero instead of being indistinguishable from a
        // non-match under 'relevance' sort. This is a simple heuristic, not
        // a calibrated score — GREATEST just lets whichever signal fired
        // harder win.
        const relevanceRank = sql`GREATEST(
          ts_rank(to_tsvector('english', ${story.title} || ' ' || coalesce(${story.description}, '')), ${tsQuery}),
          similarity(${story.title}, ${query})
        )`

        let orderBy

        switch (sort) {
          case 'oldest':
            orderBy = asc(story.createdAt)
            break
          case 'newest':
            orderBy = desc(story.createdAt)
            break
          case 'relevance':
          default:
            orderBy = desc(relevanceRank)
            break
        }

        return Promise.all([
          tx.query.story.findMany({
            where,
            orderBy,
            limit,
            offset,
            with: storyWithForUser(userId),
          }),
          tx
            .select({ count: sql<number>`count(*)`.mapWith(Number) })
            .from(story)
            .where(where),
        ])
      })

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
      console.error(err)
      return c.json({ success: false }, { status: 500 })
    }
  },
)

export { app as search }
