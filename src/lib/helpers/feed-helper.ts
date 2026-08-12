import { and, desc, eq, inArray, sql, type SQL } from "drizzle-orm";

import type { Database } from "@/lib/db";
import { storyWithForUser } from "@/lib/helpers/story-helper";
import { activity, feedItem, follow, story } from "@/lib/db/schema";

interface RankedStoriesArgs {
  db: Database;
  /** Extra condition ANDed onto the base filter, e.g. eq(story.contentRating, 'GENERAL') */
  extraWhere?: SQL;
  /** Override the default score expression, e.g. a weighted likes/readLater sum */
  scoreSql?: SQL;
  /** Higher = faster decay. HN uses 1.8. */
  gravity?: number;
  limit?: number;
  offset?: number;
}

export async function getRankedStories({
  db,
  extraWhere,
  scoreSql,
  gravity = 1.8,
  limit = 20,
  offset = 0,
}: RankedStoriesArgs) {
  const ageHours = sql`EXTRACT(EPOCH FROM (now() - ${story.createdAt})) / 3600.0`;

  const score =
    scoreSql ??
    sql`(${story.likeCount} + ${story.commentCount} + ${story.readLaterCount} + 1)`;

  const rank =
    sql<number>`${score} / POWER(${ageHours} + 2, ${gravity})`.mapWith(Number);
  const scoreCol = sql<number>`${score}`.mapWith(Number);

  const baseWhere = sql`true`;
  const where = extraWhere ? and(baseWhere, extraWhere) : baseWhere;

  return db
    .select({ id: story.id, score: scoreCol, rank })
    .from(story)
    .where(where)
    .orderBy(desc(rank), desc(story.createdAt))
    .limit(limit)
    .offset(offset);
}

interface StoryFilters {
  languages?: string[];
  contentRating?: string[];
  completion?: string | null;
}

/** Builds the shared language/contentRating/completed filter fragment. Returns undefined if no filters apply. */
export function buildStoryFilterSql({
  languages = [],
  contentRating = [],
  completion,
}: StoryFilters): SQL | undefined {
  const conditions: SQL[] = [];

  if (languages.length > 0) {
    conditions.push(inArray(story.language, languages));
  }

  if (contentRating.length > 0) {
    conditions.push(
      inArray(
        story.contentRating,
        contentRating as (typeof story.contentRating.enumValues)[number][],
      ),
    );
  }

  if (completion === "completed") {
    conditions.push(eq(story.completed, true));
  } else if (completion === "ongoing") {
    conditions.push(eq(story.completed, false));
  }

  if (conditions.length === 0) return undefined;
  return and(...conditions);
}

/** Fetches full story rows for the given ids and re-sorts them to match the ranked order. */
export async function hydrateRankedStories(
  db: Database,
  ids: string[],
  scoreMap: Record<string, number>,
  userId: string,
) {
  if (ids.length === 0) return [];

  const stories = await db.query.story.findMany({
    where: inArray(story.id, ids),
    with: storyWithForUser(userId),
  });

  const storyMap = new Map(stories.map((s) => [s.id, s]));

  return ids
    .map((id) => {
      const s = storyMap.get(id);
      return s ? { ...s, score: scoreMap[id] } : null;
    })
    .filter((s) => s !== null);
}

export async function fanoutActivity(db: Database, activityId: string) {
  const activityRow = await db.query.activity.findFirst({
    where: eq(activity.id, activityId),
  });

  if (!activityRow) {
    throw new Error(`fanoutActivity: activity ${activityId} not found`);
  }

  const followers = await db
    .select({ followerId: follow.followerId })
    .from(follow)
    .where(eq(follow.followeeId, activityRow.actorId));

  if (followers.length === 0) return;

  await db
    .insert(feedItem)
    .values(
      followers.map((f) => ({
        ownerId: f.followerId,
        activityId: activityRow.id,
        createdAt: activityRow.createdAt,
      })),
    )
    .onConflictDoNothing();
}
