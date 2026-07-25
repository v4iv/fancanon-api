import { Hono } from "hono";

import { withDatabase } from "@/lib/db";
import { AppContext } from "@/lib/types";

const app = new Hono<AppContext>();

app.get("/", withDatabase, async (c) => {
  const db = c.get("db");
  const user = c.get("user");

  if (!user) {
    return c.json({ success: false, message: "Unauthorized" }, { status: 401 });
  }

  try {
    const stories = await db.story.findMany({
      where: { authorId: user.id },
      orderBy: { createdAt: "desc" },
    });

    if (!stories) {
      return c.json({ success: false, message: "Not Found" }, { status: 404 });
    }

    return c.json({ success: true, stories }, { status: 200 });
  } catch (err) {
    console.error(err);
  }
});

app.get("/:storyId", withDatabase, async (c) => {
  const storyId = c.req.param("storyId");

  const db = c.get("db");
  const user = c.get("user");
  const userId = user?.id ?? "";

  try {
    const story = await db.story.findUnique({
      where: { id: storyId },
      include: {
        author: {
          select: { id: true, name: true, username: true, image: true },
        },
        storyTags: {
          select: {
            tag: { select: { id: true, name: true, slug: true, type: true } },
          },
        },
        fandoms: {
          select: { fandom: { select: { id: true, name: true, slug: true } } },
        },
        likes: { where: { userId } },
        readLaters: { where: { userId } },
      },
    });

    if (!story) {
      return c.json({ message: "Not Found" }, { status: 404 });
    }

    return c.json({ success: true, story }, { status: 200 });
  } catch (err) {
    console.error(err);
  }
});

app.get("/:storyId/chapters", withDatabase, async (c) => {
  const storyId = c.req.param("storyId");

  const db = c.get("db");
  const user = c.get("user");
  const userId = user?.id ?? "";

  try {
    const chapters = await db.chapter.findMany({
      where: { storyId },
      include: { bookmarks: { where: { userId } } },
      orderBy: {
        chapterIndex: "asc",
      },
    });

    if (!chapters) {
      return c.json({ success: false, message: "Not Found" }, { status: 404 });
    }

    return c.json({ success: true, chapters }, { status: 200 });
  } catch (err) {
    console.error(err);
  }
});

export { app as stories };
