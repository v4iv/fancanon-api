import { relations } from "drizzle-orm";
import {
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

import { cuid } from "@/lib/utils";
import { comment, chapter, story, user } from "@/lib/db/schema";

export const activityVerbEnum = pgEnum("activity_verb", [
  "STORY_LIKED",
  "USER_FOLLOWED",
  "REPLY_POSTED",
  "COMMENT_LIKED",
  "COMMENT_POSTED",
  "STORY_PUBLISHED",
  "CHAPTER_PUBLISHED",
]);

export const activity = pgTable(
  "activity",
  {
    id: cuid(),
    actorId: text("actor_id")
      .notNull()
      .references(() => user.id, {
        onDelete: "cascade",
      }),
    verb: activityVerbEnum("verb").notNull(),
    // Exactly one of these should be populated depending on the verb.
    storyId: text("story_id").references(() => story.id, {
      onDelete: "cascade",
    }),
    chapterId: text("chapter_id").references(() => chapter.id, {
      onDelete: "cascade",
    }),
    commentId: text("comment_id").references(() => comment.id, {
      onDelete: "cascade",
    }),
    targetUserId: text("target_user_id").references(() => user.id, {
      onDelete: "cascade",
    }),
    meta: jsonb("meta"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("activity_actor_created_at_idx").on(table.actorId, table.createdAt),
  ],
);

export const feedItem = pgTable(
  "feed_item",
  {
    id: cuid(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, {
        onDelete: "cascade",
      }),
    activityId: text("activity_id")
      .notNull()
      .references(() => activity.id, {
        onDelete: "cascade",
      }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    seenAt: timestamp("seen_at"),
  },
  (table) => [
    unique("feed_item_owner_id_activity_id_unique").on(
      table.ownerId,
      table.activityId,
    ),
    index("feed_item_owner_created_at_idx").on(table.ownerId, table.createdAt),
  ],
);

export const notification = pgTable(
  "notification",
  {
    id: cuid(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, {
        onDelete: "cascade",
      }),
    activityId: text("activity_id")
      .notNull()
      .references(() => activity.id, {
        onDelete: "cascade",
      }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    seenAt: timestamp("seen_at"),
  },
  (table) => [
    unique("notification_owner_id_activity_id_unique").on(
      table.ownerId,
      table.activityId,
    ),
    index("notification_owner_created_at_idx").on(
      table.ownerId,
      table.createdAt,
    ),
  ],
);

/* -------------------------------------------------------------------------- */
/*                                  Relations                                 */
/* -------------------------------------------------------------------------- */

export const activityRelations = relations(activity, ({ one, many }) => ({
  actor: one(user, {
    fields: [activity.actorId],
    references: [user.id],
    relationName: "activity_actor",
  }),

  targetUser: one(user, {
    fields: [activity.targetUserId],
    references: [user.id],
    relationName: "activity_target",
  }),

  story: one(story, {
    fields: [activity.storyId],
    references: [story.id],
  }),

  chapter: one(chapter, {
    fields: [activity.chapterId],
    references: [chapter.id],
  }),

  comment: one(comment, {
    fields: [activity.commentId],
    references: [comment.id],
  }),

  feedItems: many(feedItem),
  notifications: many(notification),
}));

export const feedItemRelations = relations(feedItem, ({ one }) => ({
  owner: one(user, {
    fields: [feedItem.ownerId],
    references: [user.id],
  }),

  activity: one(activity, {
    fields: [feedItem.activityId],
    references: [activity.id],
  }),
}));

export const notificationRelations = relations(notification, ({ one }) => ({
  owner: one(user, {
    fields: [notification.ownerId],
    references: [user.id],
  }),

  activity: one(activity, {
    fields: [notification.activityId],
    references: [activity.id],
  }),
}));
