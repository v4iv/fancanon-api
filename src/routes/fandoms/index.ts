import { Hono } from "hono";

import { DEFAULT_LIMIT, DEFAULT_PAGE } from "@/lib/constants";
import { withDatabase } from "@/lib/db";
import { AppContext } from "@/lib/types";
import { Prisma } from "@/generated/prisma/client";
import {
  buildStoryFilterSql,
  getHotStoryIds,
  hydrateRankedStories,
} from "@/lib/utils";

const fandoms = new Hono<AppContext>();

fandoms.get("/search", withDatabase, async (c) => {
  const query = c.req.query("q") as string;
  const limit = parseInt(c.req.query("limit") ?? `${DEFAULT_LIMIT}`);

  const db = c.get("db");

  if (!query.length) {
    return c.json(
      { success: false },
      { status: 400, statusText: "Bad Request" },
    );
  }

  try {
    const fandoms = await db.fandom.findMany({
      where: {
        OR: [
          {
            name: {
              contains: query,
              mode: "insensitive",
            },
          },
          {
            slug: {
              contains: query,
              mode: "insensitive",
            },
          },
          {
            description: {
              contains: query,
              mode: "insensitive",
            },
          },
        ],
      },
      take: limit,
      select: {
        id: true,
        slug: true,
        name: true,
      },
    });

    const filteredResults = fandoms
      .filter((fandom) => fandom.name !== "Original Content")
      .map((fandom) => ({
        label: fandom.name,
        value: fandom.id,
      }));

    return c.json(
      {
        success: true,
        results: filteredResults,
      },
      { status: 200 },
    );
  } catch (err) {
    console.error(err);
  }
});

fandoms.get("/:slug", withDatabase, async (c) => {
  const page = parseInt(c.req.query("page") ?? `${DEFAULT_PAGE}`);
  const limit = parseInt(c.req.query("limit") ?? `${DEFAULT_LIMIT}`);
  const offset = (page - 1) * limit;
  const sort = c.req.query("sort") ?? "new";
  const languages = c.req.queries("languages") ?? [];
  const contentRating = c.req.queries("contentRating") ?? [];
  const completion = c.req.query("completion") ?? "any";
  const slug = c.req.param("slug");

  if (
    !Number.isInteger(page) ||
    page < 1 ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 100
  ) {
    return c.json({ message: "Invalid pagination params" }, { status: 400 });
  }

  if (!["hot", "new", "old"].includes(sort)) {
    return c.json({ message: "Invalid sort" }, { status: 400 });
  }

  const db = c.get("db");

  const user = c.get("user");
  const userId = user?.id ?? "";

  const where: Prisma.StoryWhereInput = {
    fandoms: { some: { fandom: { slug } } },
    ...(languages.length > 0 && { language: { in: languages } }),
    ...(contentRating.length > 0 && {
      contentRating: { in: contentRating as any },
    }),
    ...(completion === "completed" && { completed: true }),
    ...(completion === "ongoing" && { completed: false }),
  };

  try {
    let sortedStories;

    if (sort === "hot") {
      const baseWhere = Prisma.sql`EXISTS (
				SELECT 1 FROM story_fandom sf
				JOIN fandom f ON f.id = sf."fandomId"
				WHERE sf."storyId" = s.id AND f.slug = ${slug}
			)`;
      const extraWhere = buildStoryFilterSql({
        languages,
        contentRating,
        completion,
      });
      const hotRows = await getHotStoryIds({
        db,
        baseWhere,
        extraWhere,
        limit,
        offset,
      });
      sortedStories = await hydrateRankedStories(
        db,
        hotRows.map((r) => r.id),
        Object.fromEntries(hotRows.map((r) => [r.id, r.score])),
        userId,
      );
    } else {
      sortedStories = await db.story.findMany({
        where,
        orderBy: { createdAt: sort === "old" ? "asc" : "desc" },
        include: {
          author: { select: { id: true, username: true } },
          storyTags: {
            select: {
              tag: { select: { id: true, name: true, slug: true, type: true } },
            },
          },
          fandoms: {
            select: {
              fandom: { select: { id: true, name: true, slug: true } },
            },
          },
          likes: { where: { userId }, select: { userId: true, storyId: true } },
          readLaters: {
            where: { userId },
            select: { userId: true, storyId: true },
          },
        },
        take: limit,
        skip: offset,
      });
    }

    const totalCount = await db.story.count({ where });
    const totalPages = Math.ceil(totalCount / limit);
    const hasMore = page < totalPages;
    const nextPage = hasMore ? page + 1 : null;

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
    );
  } catch (err) {
    console.error(err);
  }
});

export { fandoms };
