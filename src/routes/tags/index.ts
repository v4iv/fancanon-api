// authors.ts
import { Hono } from "hono";

import { DEFAULT_LIMIT } from "@/lib/constants";
import { withDatabase } from "@/lib/db";
import { AppContext } from "@/lib/types";
import { TagType } from "@/generated/prisma/enums";

const tags = new Hono<AppContext>();

tags.get("/search", withDatabase, async (c) => {
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

export { tags };
