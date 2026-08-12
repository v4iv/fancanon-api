import { relations } from "drizzle-orm";
import {
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

import { cuid } from "@/lib/utils";
import { chapter, story, user } from "@/lib/db/schema";

export const reportStatusEnum = pgEnum("report_status", [
  "PENDING",
  "REVIEWED",
  "RESOLVED",
  "REJECTED",
]);

export const like = pgTable(
  "like",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    storyId: text("story_id")
      .notNull()
      .references(() => story.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.userId, table.storyId],
    }),
    index("like_story_id_idx").on(table.storyId),
  ],
);

export const readLater = pgTable(
  "read_later",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    storyId: text("story_id")
      .notNull()
      .references(() => story.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.userId, table.storyId],
    }),
    index("read_later_story_id_idx").on(table.storyId),
  ],
);

export const follow = pgTable(
  "follow",
  {
    followerId: text("follower_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    followeeId: text("followee_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({
      columns: [table.followerId, table.followeeId],
    }),
    index("follow_followee_id_idx").on(table.followeeId),
  ],
);

export const bookmark = pgTable(
  "bookmark",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    chapterId: text("chapter_id")
      .notNull()
      .references(() => chapter.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.userId, table.chapterId],
    }),
    index("bookmark_chapter_id_idx").on(table.chapterId),
  ],
);

export const comment = pgTable(
  "comment",
  {
    id: cuid(),
    chapterId: text("chapter_id")
      .notNull()
      .references(() => chapter.id, { onDelete: "cascade" }),
    authorId: text("author_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    parentId: text("parent_id").references((): AnyPgColumn => comment.id, {
      onDelete: "cascade",
    }),
    content: text("content").notNull(),
    likeCount: integer("like_count").default(0).notNull(),
    replyCount: integer("reply_count").default(0).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("comment_chapter_id_idx").on(table.chapterId),
    index("comment_author_id_idx").on(table.authorId),
    index("comment_parent_id_idx").on(table.parentId),
  ],
);

export const commentLike = pgTable(
  "comment_like",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    commentId: text("comment_id")
      .notNull()
      .references(() => comment.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.userId, table.commentId],
    }),
    index("comment_like_comment_id_idx").on(table.commentId),
  ],
);

export const report = pgTable(
  "report",
  {
    id: cuid(),
    reportedById: text("reported_by_id").references(() => user.id),
    storyId: text("story_id").references(() => story.id, {
      onDelete: "cascade",
    }),
    chapterId: text("chapter_id").references(() => chapter.id, {
      onDelete: "cascade",
    }),
    commentId: text("comment_id").references(() => comment.id, {
      onDelete: "cascade",
    }),
    userId: text("user_id").references(() => user.id, {
      onDelete: "cascade",
    }),
    reason: text("reason").notNull(),
    description: text("description"),
    status: reportStatusEnum("status").default("PENDING").notNull(),
    resolvedById: text("resolved_by_id").references(() => user.id),
    resolvedAt: timestamp("resolved_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("report_status_idx").on(table.status),
    index("report_story_id_idx").on(table.storyId),
    index("report_chapter_id_idx").on(table.chapterId),
    index("report_comment_id_idx").on(table.commentId),
    index("report_user_id_idx").on(table.userId),
  ],
);

export const history = pgTable(
  "history",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    chapterId: text("chapter_id")
      .notNull()
      .references(() => chapter.id, { onDelete: "cascade" }),
    storyId: text("story_id") // denormalized — avoids a join through chapter for "distinct stories in history" queries
      .notNull()
      .references(() => story.id, { onDelete: "cascade" }),
    lastViewedAt: timestamp("last_viewed_at").defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.chapterId] }),
    index("history_user_last_viewed_idx").on(table.userId, table.lastViewedAt),
  ],
);

/* -------------------------------------------------------------------------- */
/*                                  Relations                                 */
/* -------------------------------------------------------------------------- */

export const likeRelations = relations(like, ({ one }) => ({
  user: one(user, {
    fields: [like.userId],
    references: [user.id],
  }),
  story: one(story, {
    fields: [like.storyId],
    references: [story.id],
  }),
}));

export const readLaterRelations = relations(readLater, ({ one }) => ({
  user: one(user, {
    fields: [readLater.userId],
    references: [user.id],
  }),
  story: one(story, {
    fields: [readLater.storyId],
    references: [story.id],
  }),
}));

export const followRelations = relations(follow, ({ one }) => ({
  follower: one(user, {
    fields: [follow.followerId],
    references: [user.id],
    relationName: "following",
  }),
  followee: one(user, {
    fields: [follow.followeeId],
    references: [user.id],
    relationName: "followers",
  }),
}));

export const bookmarkRelations = relations(bookmark, ({ one }) => ({
  user: one(user, {
    fields: [bookmark.userId],
    references: [user.id],
  }),

  chapter: one(chapter, {
    fields: [bookmark.chapterId],
    references: [chapter.id],
  }),
}));

export const commentRelations = relations(comment, ({ one, many }) => ({
  chapter: one(chapter, {
    fields: [comment.chapterId],
    references: [chapter.id],
  }),

  author: one(user, {
    fields: [comment.authorId],
    references: [user.id],
  }),

  parent: one(comment, {
    fields: [comment.parentId],
    references: [comment.id],
    relationName: "replies",
  }),

  replies: many(comment, {
    relationName: "replies",
  }),

  likes: many(commentLike),

  reports: many(report),
}));

export const commentLikeRelations = relations(commentLike, ({ one }) => ({
  user: one(user, {
    fields: [commentLike.userId],
    references: [user.id],
  }),

  comment: one(comment, {
    fields: [commentLike.commentId],
    references: [comment.id],
  }),
}));

export const reportRelations = relations(report, ({ one }) => ({
  reportedBy: one(user, {
    fields: [report.reportedById],
    references: [user.id],
    relationName: "reports",
  }),

  reportedUser: one(user, {
    fields: [report.userId],
    references: [user.id],
    relationName: "reports_received",
  }),

  resolvedBy: one(user, {
    fields: [report.resolvedById],
    references: [user.id],
    relationName: "reports_resolved",
  }),

  story: one(story, {
    fields: [report.storyId],
    references: [story.id],
  }),

  chapter: one(chapter, {
    fields: [report.chapterId],
    references: [chapter.id],
  }),

  comment: one(comment, {
    fields: [report.commentId],
    references: [comment.id],
  }),
}));

export const historyRelations = relations(history, ({ one }) => ({
  user: one(user, { fields: [history.userId], references: [user.id] }),
  chapter: one(chapter, {
    fields: [history.chapterId],
    references: [chapter.id],
  }),
  story: one(story, { fields: [history.storyId], references: [story.id] }),
}));
