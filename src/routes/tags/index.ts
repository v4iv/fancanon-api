import { Hono } from "hono";

import { DEFAULT_LIMIT, DEFAULT_PAGE } from "@/lib/constants";
import { withDatabase } from "@/lib/db";
import { AppContext } from "@/lib/types";
import { TagType } from "@/generated/prisma/enums";
import { Prisma } from "@/generated/prisma/client";
import {
  buildStoryFilterSql,
  getHotStoryIds,
  hydrateRankedStories,
} from "@/lib/utils";

const app = new Hono<AppContext>();

app.get("/search", withDatabase, async (c) => {
  const query = c.req.query("q") as string;
  const type = c.req.query("type") ?? TagType.FREEFORM;
  const limit = parseInt(c.req.query("limit") ?? `${DEFAULT_LIMIT}`);

  const db = c.get("db");

  if (query.length === 0) {
    return c.json([]);
  }
  if (!type || !(type as TagType)) {
    return c.json({ message: "Invalid or missing tag type" }, { status: 400 });
  }

  try {
    const tags = await db.tag.findMany({
      where: {
        type: type as TagType,
        name: { contains: query, mode: "insensitive" },
      },
      select: { name: true, usageCount: true },
      orderBy: [{ usageCount: "desc" }, { name: "asc" }],
      take: limit,
    });

    return c.json(
      tags.map((t) => t.name),
      { status: 200 },
    );
  } catch (err) {
    console.error(err);
  }
});

app.get("/:slug", withDatabase, async (c) => {
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
    storyTags: { some: { tag: { slug } } },
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
				SELECT 1 FROM story_tag st
				JOIN tag t ON t.id = st."tagId"
				WHERE st."storyId" = s.id AND t.slug = ${slug}
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

export { app as tags };
