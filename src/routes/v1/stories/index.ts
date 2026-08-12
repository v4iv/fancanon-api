import { Hono } from "hono";
import { and, eq, sql } from "drizzle-orm";

import { AppContext } from "@/lib/types";
import { withDatabase } from "@/lib/db";
import { activity, like, notification, story } from "@/lib/db/schema";

const app = new Hono<AppContext>();

app.get("/:storyId/like", withDatabase, async (c) => {
  const storyId = c.req.param("storyId") as string;

  const user = c.get("user");
  if (!user) {
    return c.json({ success: false }, { status: 401 });
  }

  const userId = user?.id ?? "";
  const db = c.get("db");

  try {
    await db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(like)
        .values({ userId, storyId })
        .onConflictDoNothing()
        .returning({ storyId: like.storyId });

      // Already liked — no-op, don't double-count or spam another activity/notification.
      if (!inserted) return;

      const [updatedStory] = await tx
        .update(story)
        .set({ likeCount: sql`${story.likeCount} + 1` })
        .where(eq(story.id, storyId))
        .returning({ authorId: story.authorId });

      // storyId didn't reference a real story — roll back the like insert.
      if (!updatedStory) {
        tx.rollback();
      }

      const [createdActivity] = await tx
        .insert(activity)
        .values({ actorId: userId, verb: "STORY_LIKED", storyId })
        .returning({ id: activity.id });

      if (updatedStory.authorId !== userId) {
        await tx.insert(notification).values({
          ownerId: updatedStory.authorId,
          activityId: createdActivity.id,
        });
      }
    });

    return c.json({ success: true }, { status: 200 });
  } catch (err) {
    console.error(err);
    return c.json({ success: false }, { status: 500 });
  }
});

app.delete("/:storyId/unlike", withDatabase, async (c) => {
  const storyId = c.req.param("storyId") as string;

  const user = c.get("user");
  if (!user) {
    return c.json({ success: false }, { status: 401 });
  }

  const userId = user?.id ?? "";
  const db = c.get("db");

  try {
    await db.transaction(async (tx) => {
      const [deleted] = await tx
        .delete(like)
        .where(and(eq(like.userId, userId), eq(like.storyId, storyId)))
        .returning({ storyId: like.storyId });

      // Wasn't liked in the first place — no-op.
      if (!deleted) return;

      const [updatedStory] = await tx
        .update(story)
        .set({ likeCount: sql`GREATEST(${story.likeCount} - 1, 0)` })
        .where(eq(story.id, storyId))
        .returning({ id: story.id });

      if (!updatedStory) {
        tx.rollback();
      }

      // Deleting the activity cascades to notification/feedItem rows
      // referencing it (both declared onDelete: 'cascade'), so this
      // single delete cleans up the fan-out too.
      await tx
        .delete(activity)
        .where(
          and(
            eq(activity.actorId, userId),
            eq(activity.verb, "STORY_LIKED"),
            eq(activity.storyId, storyId),
          ),
        );
    });

    return c.json({ success: true }, { status: 200 });
  } catch (err) {
    console.error(err);
    return c.json({ success: false }, { status: 500 });
  }
});

export { app as stories };
