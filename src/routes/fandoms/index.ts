// authors.ts
import { Hono } from "hono";

import { DEFAULT_LIMIT } from "@/lib/constants";
import withDatabase from "@/lib/db";
import { AppContext } from "@/lib/types";

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

export { fandoms };
