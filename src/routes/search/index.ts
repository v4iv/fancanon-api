import { Hono } from "hono";

import { DEFAULT_LIMIT, DEFAULT_PAGE } from "@/lib/constants";
import { withDatabase } from "@/lib/db";
import { AppContext } from "@/lib/types";
import { Prisma } from "@/generated/prisma/client";

const search = new Hono<AppContext>();

search.get("/", withDatabase, async (c) => {
  const query = c.req.query("q") as string;
  const page = parseInt(c.req.query("page") ?? `${DEFAULT_PAGE}`);
  const limit = parseInt(c.req.query("limit") ?? `${DEFAULT_LIMIT}`);
  const sort = c.req.query("sort") ?? "relevance";
  const fandoms = c.req.queries("fandoms") || "[]";
  const languages = c.req.queries("languages") ?? [];
  const ratings = c.req.queries("ratings") ?? [];
  const completion = c.req.query("completion") ?? "any";
  const offset = (page - 1) * limit;

  if (query.length < 3) {
    return c.json({
      stories: [],
      totalCount: 0,
      totalPages: 1,
      nextPage: null,
      hasMore: false,
      currentPage: 1,
    });
  }

  const db = c.get("db");

  const sanitizedQuery = query
    .replace(/[!@#$%^&*()_+=<>?~`:;"']/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .join(" | ");

  const tagMatches = await db.tag.findMany({
    where: { name: { contains: query, mode: "insensitive" } },
    select: { id: true },
  });

  const tagMatchTagIds = tagMatches.map((t) => t.id);

  const andConditions: Prisma.StoryWhereInput[] = [
    {
      OR: [
        { title: { search: sanitizedQuery } },
        { description: { search: sanitizedQuery } },
        ...(tagMatchTagIds.length > 0
          ? [{ storyTags: { some: { tagId: { in: tagMatchTagIds } } } }]
          : []),
        { author: { username: { search: sanitizedQuery } } },
        { author: { name: { search: sanitizedQuery } } },
      ],
    },
  ];

  // @ts-expect-error because value has to be parsed from string to JSON
  const fandomIds = JSON.parse(fandoms).map((f: { value: string }) => f.value);

  if (fandomIds.length > 0) {
    andConditions.push({
      fandoms: { some: { fandom: { id: { in: fandomIds } } } },
    });
  }

  if (languages.length > 0) {
    andConditions.push({ language: { in: languages } });
  }

  if (completion === "completed") {
    andConditions.push({ completed: true });
  } else if (completion === "ongoing") {
    andConditions.push({ completed: false });
  }

  if (ratings.length > 0) {
    andConditions.push({
      contentRating: { in: ratings as Prisma.EnumContentRatingFilter["in"] },
    });
  }

  const where: Prisma.StoryWhereInput = { AND: andConditions };

  let orderBy: Prisma.StoryOrderByWithRelationInput;

  switch (sort) {
    case "popular":
      orderBy = { likes: { _count: "desc" } };
      break;
    case "newest":
      orderBy = { createdAt: "desc" };
      break;
    case "relevance":
    default:
      orderBy = {
        _relevance: {
          fields: ["title", "description"],
          search: sanitizedQuery,
          sort: "desc",
        },
      };
      break;
  }

  try {
    const stories = await db.story.findMany({
      where,
      skip: offset,
      take: limit,
      orderBy,
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
        likes: { select: { storyId: true, userId: true } },
        readLaters: { select: { storyId: true, userId: true } },
      },
    });

    const totalCount = await db.story.count({ where });
    const totalPages = Math.ceil(totalCount / limit);
    const hasMore = page < totalPages;
    const nextPage = hasMore ? page + 1 : null;

    return c.json(
      {
        stories,
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

export { search };
