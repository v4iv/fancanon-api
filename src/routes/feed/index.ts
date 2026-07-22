// authors.ts
import { Hono } from "hono";

import {
  DEFAULT_LIMIT,
  DEFAULT_PAGE,
  LIKES_WEIGHT,
  READ_LATER_WEIGHT,
  TRENDING_GRAVITY,
} from "@/lib/constants";
import withDatabase from "@/lib/db";
import { AppContext } from "@/lib/types";

const feed = new Hono<AppContext>();

feed.get("/hot", withDatabase, async (c) => {
  const page = parseInt(c.req.param("page") ?? `${DEFAULT_PAGE}`);
  const limit = parseInt(c.req.param("limit") ?? `${DEFAULT_LIMIT}`);
  const offset = (DEFAULT_PAGE - 1) * DEFAULT_LIMIT;

  const db = c.get("db");

  try {
    // rank = score / (age_in_hours + 2) ^ gravity — Hacker-News-style decay.
    // No hard time cutoff: a story that goes viral weeks after publishing
    // can still surface, decay alone determines what's "hot" right now.
    const rankedStories = await db.$queryRaw<
      { id: string; score: number; rank: number }[]
    >`
			SELECT
				id,
				("likeCount" * ${LIKES_WEIGHT} + "readLaterCount" * ${READ_LATER_WEIGHT}) AS score,
				("likeCount" * ${LIKES_WEIGHT} + "readLaterCount" * ${READ_LATER_WEIGHT})
					/ POWER((EXTRACT(EPOCH FROM (now() - "createdAt")) / 3600) + 2, ${TRENDING_GRAVITY}) AS rank
			FROM story
			ORDER BY rank DESC, "createdAt" DESC
			LIMIT ${limit} OFFSET ${offset}
		`;

    if (rankedStories.length === 0) {
      return c.json({
        success: true,
        stories: [],
        currentPage: page,
        next: null,
        totalPages: 1,
        hasMore: false,
      });
    }

    const storyIds = rankedStories.map((s) => s.id);
    const scoreMap = Object.fromEntries(
      rankedStories.map((s) => [s.id, s.score]),
    );

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
      },
    });

    const storyMap = new Map(stories.map((s) => [s.id, s]));
    const sortedStories = storyIds
      .map((id) => {
        const story = storyMap.get(id);
        return story ? { ...story, score: scoreMap[id] } : null;
      })
      .filter((s) => s !== null);

    const totalCount = await db.story.count();
    const totalPages = Math.ceil(totalCount / limit);
    const hasMore = page < totalPages;
    const nextPage = hasMore ? page + 1 : null;

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
    );
  } catch (err) {
    console.error(err);
  }
});

export { feed };
