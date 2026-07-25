import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import {
  LIKES_WEIGHT,
  READ_LATER_WEIGHT,
  TRENDING_GRAVITY,
} from "@/lib/constants";

/**
 * Returns story ids + decayed rank scores for stories matching an arbitrary
 * WHERE fragment, ordered by Hacker-News-style decay:
 *   rank = score / (age_hours + 2) ^ gravity
 *
 * `extraWhere` is ANDed against the base filter. Pass Prisma.empty if there's
 * nothing extra to filter by.
 */
export async function getHotStoryIds({
  db,
  baseWhere,
  extraWhere = Prisma.empty,
  limit,
  offset,
}: {
  db: PrismaClient;
  baseWhere: Prisma.Sql;
  extraWhere?: Prisma.Sql;
  limit: number;
  offset: number;
}): Promise<{ id: string; score: number }[]> {
  return db.$queryRaw<{ id: string; score: number }[]>`
		SELECT
			s.id,
			(s."likeCount" * ${LIKES_WEIGHT} + s."readLaterCount" * ${READ_LATER_WEIGHT})
				/ POWER((EXTRACT(EPOCH FROM (now() - s."createdAt")) / 3600) + 2, ${TRENDING_GRAVITY}) AS score
		FROM story s
		WHERE ${baseWhere}
		${extraWhere}
		ORDER BY score DESC, s."createdAt" DESC
		LIMIT ${limit} OFFSET ${offset}
	`;
}

/**
 * Builds the shared AND-chain of optional filters (language, contentRating,
 * completion) as a single Prisma.Sql fragment, reusable across any page
 * that filters stories the same way (fandom, tag, search, etc.)
 */
export function buildStoryFilterSql({
  languages,
  contentRating,
  completion,
}: {
  languages: string[];
  contentRating: string[];
  completion: string | null;
}): Prisma.Sql {
  const parts: Prisma.Sql[] = [];

  if (languages.length > 0) {
    parts.push(Prisma.sql`AND s.language = ANY(${languages})`);
  }
  if (contentRating.length > 0) {
    parts.push(
      Prisma.sql`AND s."contentRating" = ANY(${contentRating}::"ContentRating"[])`,
    );
  }
  if (completion === "completed") {
    parts.push(Prisma.sql`AND s.completed = true`);
  } else if (completion === "ongoing") {
    parts.push(Prisma.sql`AND s.completed = false`);
  }

  return parts.length > 0 ? Prisma.join(parts, " ") : Prisma.empty;
}

/**
 * Given ordered story ids + a score map, hydrates full Story rows via Prisma
 * and re-sorts them back into the original rank order (Prisma's `findMany`
 * with `id: { in }` does not preserve input order).
 */
export async function hydrateRankedStories(
  db: PrismaClient,
  storyIds: string[],
  scoreMap: Record<string, number>,
  userId: string,
) {
  if (storyIds.length === 0) return [];

  const stories = await db.story.findMany({
    where: { id: { in: storyIds } },
    include: {
      author: { select: { id: true, username: true } },
      storyTags: {
        select: {
          tag: { select: { id: true, name: true, slug: true, type: true } },
        },
      },
      fandoms: {
        select: { fandom: { select: { id: true, name: true, slug: true } } },
      },
      likes: { where: { userId }, select: { userId: true, storyId: true } },
      readLaters: {
        where: { userId },
        select: { userId: true, storyId: true },
      },
    },
  });

  const storyMap = new Map(stories.map((s) => [s.id, s]));
  return storyIds
    .map((id) => {
      const story = storyMap.get(id);
      return story ? { ...story, score: scoreMap[id] } : null;
    })
    .filter((s) => s !== null);
}
