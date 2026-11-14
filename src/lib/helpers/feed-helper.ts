import { and, desc, eq, inArray, ne, sql, type SQL } from 'drizzle-orm'
import { union } from 'drizzle-orm/pg-core'
import { captureException } from '@sentry/hono/cloudflare'

import { createDb, type Database } from '@/lib/db'
import { storyWithForUser } from '@/lib/helpers/story-helper'
import { activity, chapter, feedItem, follow, like, readLater, story } from '@/lib/db/schema'
import type { FanoutQueueMessage } from '@/lib/types'

interface RankedStoriesArgs {
  db: Database
  /** Extra condition ANDed onto the base filter, e.g. eq(story.contentRating, 'GENERAL') */
  extraWhere?: SQL
  /** Override the default score expression, e.g. a weighted likes/readLater sum */
  scoreSql?: SQL
  /** Higher = faster decay. HN uses 1.8. */
  gravity?: number
  limit?: number
  offset?: number
}

export async function getRankedStories({
  db,
  extraWhere,
  scoreSql,
  gravity = 1.8,
  limit = 20,
  offset = 0,
}: RankedStoriesArgs) {
  const ageHours = sql`EXTRACT(EPOCH FROM (now() - ${story.createdAt})) / 3600.0`

  const score =
    scoreSql ?? sql`(${story.likeCount} + ${story.commentCount} + ${story.readLaterCount} + 1)`

  const rank = sql<number>`${score} / POWER(${ageHours} + 2, ${gravity})`.mapWith(Number)
  const scoreCol = sql<number>`${score}`.mapWith(Number)

  const baseWhere = sql`true`
  const where = extraWhere ? and(baseWhere, extraWhere) : baseWhere

  return db
    .select({ id: story.id, score: scoreCol, rank })
    .from(story)
    .where(where)
    .orderBy(desc(rank), desc(story.createdAt))
    .limit(limit)
    .offset(offset)
}

interface StoryFilters {
  languages?: string[]
  contentRating?: string[]
  completion?: string | null
}

/** Builds the shared language/contentRating/completed filter fragment. Returns undefined if no filters apply. */
export function buildStoryFilterSql({
  languages = [],
  contentRating = [],
  completion,
}: StoryFilters): SQL | undefined {
  const conditions: SQL[] = []

  if (languages.length > 0) {
    conditions.push(inArray(story.language, languages))
  }

  if (contentRating.length > 0) {
    conditions.push(
      inArray(
        story.contentRating,
        contentRating as (typeof story.contentRating.enumValues)[number][],
      ),
    )
  }

  if (completion === 'completed') {
    conditions.push(eq(story.completed, true))
  } else if (completion === 'ongoing') {
    conditions.push(eq(story.completed, false))
  }

  if (conditions.length === 0) return undefined
  return and(...conditions)
}

/** Fetches full story rows for the given ids and re-sorts them to match the ranked order. */
export async function hydrateRankedStories(
  db: Database,
  ids: string[],
  scoreMap: Record<string, number>,
  userId: string,
) {
  if (ids.length === 0) return []

  const stories = await db.query.story.findMany({
    where: inArray(story.id, ids),
    with: storyWithForUser(userId),
  })

  const storyMap = new Map(stories.map((s) => [s.id, s]))

  return ids
    .map((id) => {
      const s = storyMap.get(id)
      return s ? { ...s, score: scoreMap[id] } : null
    })
    .filter((s) => s !== null)
}

export async function fanoutActivity(db: Database, activityId: string) {
  const activityRow = await db.query.activity.findFirst({
    where: eq(activity.id, activityId),
  })

  if (!activityRow) {
    throw new Error(`fanoutActivity: activity ${activityId} not found`)
  }

  let storyId = activityRow.storyId
  if (!storyId && activityRow.chapterId) {
    const chapterRow = await db.query.chapter.findFirst({
      where: eq(chapter.id, activityRow.chapterId),
      columns: { storyId: true },
    })
    storyId = chapterRow?.storyId ?? null
  }

  // 1. Author's followers (excluding the author themselves)
  const followersQuery = db
    .select({ userId: follow.followerId })
    .from(follow)
    .where(
      and(eq(follow.followeeId, activityRow.actorId), ne(follow.followerId, activityRow.actorId)),
    )

  let recipientsQuery
  if (storyId) {
    // 2. People who liked the story (excluding the author)
    const likersQuery = db
      .select({ userId: like.userId })
      .from(like)
      .where(and(eq(like.storyId, storyId), ne(like.userId, activityRow.actorId)))

    // 3. People who added the story to read later (excluding the author)
    const readLaterQuery = db
      .select({ userId: readLater.userId })
      .from(readLater)
      .where(and(eq(readLater.storyId, storyId), ne(readLater.userId, activityRow.actorId)))

    // Deduplicate all recipient IDs using PostgreSQL UNION
    recipientsQuery = union(followersQuery, likersQuery, readLaterQuery)
  } else {
    recipientsQuery = followersQuery
  }

  const recipients = await recipientsQuery

  if (recipients.length === 0) return { insertedCount: 0 }

  // Batch insert into feedItem in chunks to avoid query parameter limits
  const CHUNK_SIZE = 500
  for (let i = 0; i < recipients.length; i += CHUNK_SIZE) {
    const chunk = recipients.slice(i, i + CHUNK_SIZE)
    await db
      .insert(feedItem)
      .values(
        chunk.map((r) => ({
          ownerId: r.userId,
          activityId: activityRow.id,
          createdAt: activityRow.createdAt,
        })),
      )
      .onConflictDoNothing()
  }

  return { insertedCount: recipients.length }
}

export async function handleFanoutBatch(
  batch: MessageBatch<FanoutQueueMessage>,
  env: CloudflareBindings,
  _ctx?: ExecutionContext,
) {
  const db = createDb(env.HYPERDRIVE.connectionString)
  const processed = new Set<string>()

  for (const message of batch.messages) {
    try {
      const { activityId } = message.body
      if (!activityId) {
        message.ack()
        continue
      }

      if (!processed.has(activityId)) {
        await fanoutActivity(db, activityId)
        processed.add(activityId)
      }
      message.ack()
    } catch (err) {
      captureException(err)
      message.retry()
    }
  }
}

export async function enqueueFanout(queue: Queue<FanoutQueueMessage>, activityId: string) {
  await queue.send({ activityId })
}
