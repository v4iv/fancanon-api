import { Hono } from "hono";
import { desc, sql } from "drizzle-orm";

import { AppContext } from "@/lib/types";
import { withDatabase } from "@/lib/db";
import { story } from "@/lib/db/schema";
import { storyWithForUser } from "@/lib/helpers/story-helper";
import { DEFAULT_LIMIT, DEFAULT_PAGE } from "@/lib/constants";

const app = new Hono<AppContext>();

app.get("/new", withDatabase, async (c) => {
  const page = parseInt(c.req.query("page") ?? `${DEFAULT_PAGE}`);
  const limit = parseInt(c.req.query("limit") ?? `${DEFAULT_LIMIT}`);
  const offset = (page - 1) * limit;

  const db = c.get("db");

  const user = c.get("user");
  const userId = user?.id ?? "";

  try {
    const latest = await db.query.story.findMany({
      orderBy: desc(story.createdAt),
      limit,
      offset,
      with: storyWithForUser(userId),
    });

    const [{ count: totalCount }] = await db
      .select({ count: sql<number>`count(*)`.mapWith(Number) })
      .from(story);

    const totalPages = Math.ceil(totalCount / limit);
    const hasMore = page < totalPages;
    const nextPage = hasMore ? page + 1 : null;

    return c.json(
      {
        success: true,
        stories: latest,
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

export { app as feed };
