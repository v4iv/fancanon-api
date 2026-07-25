// authors.ts
import { Hono } from "hono";

import { AppContext } from "@/lib/types";
import {
  DEFAULT_LIMIT,
  DEFAULT_PAGE,
  LIKES_WEIGHT,
  READ_LATER_WEIGHT,
  TRENDING_GRAVITY,
} from "@/lib/constants";
import {
  buildStoryFilterSql,
  getHotStoryIds,
  hydrateRankedStories,
} from "@/lib/utils";
import { withDatabase } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";

const feed = new Hono<AppContext>();

feed.get("/hot", withDatabase, async (c) => {
  const page = parseInt(c.req.query("page") ?? `${DEFAULT_PAGE}`);
  const limit = parseInt(c.req.query("limit") ?? `${DEFAULT_LIMIT}`);
  const offset = (page - 1) * limit;

  const db = c.get("db");

  const user = c.get("user");
  const userId = user?.id ?? "";

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
        likes: {
          where: { userId },
          select: { userId: true, storyId: true },
        },
        readLaters: {
          where: { userId },
          select: { userId: true, storyId: true },
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

feed.get("/new", withDatabase, async (c) => {
  const page = parseInt(c.req.query("page") ?? `${DEFAULT_PAGE}`);
  const limit = parseInt(c.req.query("limit") ?? `${DEFAULT_LIMIT}`);
  const offset = (page - 1) * limit;

  const db = c.get("db");

  const user = c.get("user");
  const userId = user?.id ?? "";

  try {
    const stories = await db.story.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
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
        likes: {
          where: { userId },
          select: { userId: true, storyId: true },
        },
        readLaters: {
          where: { userId },
          select: { userId: true, storyId: true },
        },
      },
    });

    const totalCount = await db.story.count();
    const totalPages = Math.ceil(totalCount / limit);
    const hasMore = page < totalPages;
    const nextPage = hasMore ? page + 1 : null;

    return c.json(
      {
        success: true,
        stories,
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

feed.get("/new", withDatabase, async (c) => {
  const page = parseInt(c.req.query("page") ?? `${DEFAULT_PAGE}`);
  const limit = parseInt(c.req.query("limit") ?? `${DEFAULT_LIMIT}`);
  const offset = (page - 1) * limit;

  const db = c.get("db");

  const user = c.get("user");
  const userId = user?.id ?? "";

  try {
    const stories = await db.story.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
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
        likes: {
          where: { userId },
          select: { userId: true, storyId: true },
        },
        readLaters: {
          where: { userId },
          select: { userId: true, storyId: true },
        },
      },
    });

    const totalCount = await db.story.count();
    const totalPages = Math.ceil(totalCount / limit);
    const hasMore = page < totalPages;
    const nextPage = hasMore ? page + 1 : null;

    return c.json(
      {
        success: true,
        stories,
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

feed.get("/:slug", withDatabase, async (c) => {
  const page = parseInt(c.req.query("page") ?? `${DEFAULT_PAGE}`);
  const limit = parseInt(c.req.query("limit") ?? `${DEFAULT_LIMIT}`);
  const offset = (page - 1) * limit;
  const languages = c.req.queries("languages") ?? [];
  const contentRating = c.req.queries("contentRating") ?? [];
  const completion = c.req.query("completion") ?? "any";
  const slug = c.req.param("slug");

  const db = c.get("db");

  const user = c.get("user");
  const userId = user?.id ?? "";

  if (
    !Number.isInteger(page) ||
    page < 1 ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 100
  ) {
    return c.json({ message: "Invalid pagination params" }, { status: 400 });
  }

  const category = await db.category.findUnique({
    where: { slug },
    select: { id: true },
  });

  if (!category) {
    return c.json({ message: "Category not found" }, { status: 404 });
  }

  // stories whose fandom belongs to this category — merged across every
  // fandom in the category, ranked as one decay-sorted list (not grouped
  // or sorted per-fandom)
  const baseWhere = Prisma.sql`EXISTS (
		SELECT 1 FROM story_fandom sf
		JOIN fandom f ON f.id = sf."fandomId"
		WHERE sf."storyId" = s.id AND f."categoryId" = ${category.id}
	)`;

  const extraWhere = buildStoryFilterSql({
    languages,
    contentRating,
    completion,
  });

  try {
    const hotRows = await getHotStoryIds({
      db,
      baseWhere,
      extraWhere,
      limit,
      offset,
    });

    const stories = await hydrateRankedStories(
      db,
      hotRows.map((r) => r.id),
      Object.fromEntries(hotRows.map((r) => [r.id, r.score])),
      userId,
    );

    const where: Prisma.StoryWhereInput = {
      fandoms: { some: { fandom: { categoryId: category.id } } },
      ...(languages.length > 0 && { language: { in: languages } }),
      ...(contentRating.length > 0 && {
        contentRating: { in: contentRating as any },
      }),
      ...(completion === "completed" && { completed: true }),
      ...(completion === "ongoing" && { completed: false }),
    };

    const totalCount = await db.story.count({ where });
    const totalPages = Math.ceil(totalCount / limit);
    const hasMore = page < totalPages;
    const nextPage = hasMore ? page + 1 : null;

    return c.json(
      {
        success: true,
        stories,
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
