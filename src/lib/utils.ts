import slug from "slug";

import {
  LIKES_WEIGHT,
  NO_WARNING_CHOSEN_TAG_NAME,
  READ_LATER_WEIGHT,
  TRENDING_GRAVITY,
} from "@/lib/constants";
import { Prisma, TagType, type PrismaClient } from "@/generated/prisma/client";

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

export async function fanoutActivity(db: PrismaClient, activityId: string) {
  const activity = await db.activity.findUniqueOrThrow({
    where: { id: activityId },
  });

  const followers = await db.follow.findMany({
    where: { followeeId: activity.actorId },
    select: { followerId: true },
  });

  if (followers.length === 0) return;

  await db.feedItem.createMany({
    data: followers.map((f) => ({
      ownerId: f.followerId,
      activityId: activity.id,
      createdAt: activity.createdAt,
    })),
    skipDuplicates: true,
  });
}

slug.charmap["/"] = "-";
slug.charmap["&"] = "-";

type PrismaClientLike = PrismaClient | Prisma.TransactionClient;

async function resolveWarningTags(
  client: PrismaClientLike,
  warningNames: string[],
) {
  const names =
    warningNames.length > 0 ? warningNames : [NO_WARNING_CHOSEN_TAG_NAME];
  // warnings are admin-seeded only — findMany, never upsert/create here
  const tags = await client.tag.findMany({
    where: { name: { in: names }, type: "WARNING" },
    select: { id: true },
  });
  return tags.map((t: { id: string }) => t.id);
}

async function resolveTags(
  client: PrismaClientLike,
  tagNames: string[],
  type: TagType,
) {
  const normalized = [
    ...new Set(tagNames.map((t) => t.trim()).filter(Boolean)),
  ];
  if (normalized.length === 0) return [];

  // one batched insert, skip any that already exist by unique `name` —
  // replaces the old N-upserts-in-a-Promise.all, which was the source
  // of the transaction timeout: each upsert was its own round-trip
  await client.tag.createMany({
    data: normalized.map((name) => ({ name, slug: slug(name), type })),
    skipDuplicates: true,
  });

  // one more round-trip to fetch ids for both newly-created and
  // pre-existing tags
  const tags = await client.tag.findMany({
    where: { name: { in: normalized } },
    select: { id: true },
  });

  return tags.map((t: { id: string }) => t.id);
}

type ResolvedTagIds = {
  relationshipIds: string[];
  characterIds: string[];
  freeformIds: string[];
  warningIds: string[];
};

/**
 * Resolves tag names -> tag ids. Runs against the plain client, NOT inside
 * a transaction — tag resolution is idempotent (Tag.name is @unique, so
 * concurrent createMany+skipDuplicates calls are race-safe on their own)
 * and has no correctness dependency on the Story row existing yet. Keeping
 * this outside $transaction is what keeps the actual transaction short
 * enough to stay under Prisma's interactive-transaction timeout.
 */
export async function resolveStoryTagIds(
  db: PrismaClient,
  tags: {
    relationshipTags: string[];
    characterTags: string[];
    freeformTags: string[];
    warningTags: string[];
  },
): Promise<ResolvedTagIds> {
  const [relationshipIds, characterIds, freeformIds, warningIds] =
    await Promise.all([
      resolveTags(db, tags.relationshipTags, "RELATIONSHIP"),
      resolveTags(db, tags.characterTags, "CHARACTER"),
      resolveTags(db, tags.freeformTags, "FREEFORM"),
      resolveWarningTags(db, tags.warningTags),
    ]);
  return { relationshipIds, characterIds, freeformIds, warningIds };
}

/** Call after resolveStoryTagIds, inside the transaction, for a brand-new story. */
export async function createStoryTagLinks(
  tx: Prisma.TransactionClient,
  storyId: string,
  resolved: ResolvedTagIds,
) {
  const allTagIds = [
    ...resolved.relationshipIds,
    ...resolved.characterIds,
    ...resolved.freeformIds,
    ...resolved.warningIds,
  ];

  if (allTagIds.length > 0) {
    await tx.storyTag.createMany({
      data: allTagIds.map((tagId) => ({ storyId, tagId })),
      skipDuplicates: true,
    });
    await tx.tag.updateMany({
      where: { id: { in: allTagIds } },
      data: { usageCount: { increment: 1 } },
    });
  }
}

/** Call after resolveStoryTagIds, inside the transaction, for an edited story. */
export async function syncStoryTagLinks(
  tx: Prisma.TransactionClient,
  storyId: string,
  resolved: ResolvedTagIds,
) {
  const desiredTagIds = new Set([
    ...resolved.relationshipIds,
    ...resolved.characterIds,
    ...resolved.freeformIds,
    ...resolved.warningIds,
  ]);

  const existing = await tx.storyTag.findMany({
    where: { storyId },
    select: { tagId: true },
  });
  const existingTagIds = new Set(existing.map((st) => st.tagId));

  const toAdd = [...desiredTagIds].filter((id) => !existingTagIds.has(id));
  const toRemove = [...existingTagIds].filter((id) => !desiredTagIds.has(id));

  if (toRemove.length > 0) {
    await tx.storyTag.deleteMany({
      where: { storyId, tagId: { in: toRemove } },
    });
    await tx.tag.updateMany({
      where: { id: { in: toRemove } },
      data: { usageCount: { decrement: 1 } },
    });
  }
  if (toAdd.length > 0) {
    await tx.storyTag.createMany({
      data: toAdd.map((tagId) => ({ storyId, tagId })),
    });
    await tx.tag.updateMany({
      where: { id: { in: toAdd } },
      data: { usageCount: { increment: 1 } },
    });
  }
}
