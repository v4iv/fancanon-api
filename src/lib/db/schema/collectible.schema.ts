import { relations } from 'drizzle-orm'
import {
  boolean,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core'

import { cuid } from '@/lib/utils'
import { user } from '@/lib/db/schema'

export const collectibleCategoryEnum = pgEnum('collectible_category', [
  'CONTENT', // related to writing stories/chapters
  'SOCIAL', // likes, follows, comments
  'EXPLORATION', // reading, browsing
  'EVENT', // time-limited site events
  'MILESTONE', // hit N stories, N words, etc.
])

export const badge = pgTable('badge', {
  id: cuid(),
  name: text('name').notNull().unique(), // "Tag Explorer"
  slug: text('slug').notNull().unique(), // "tag-explorer"
  description: text('description'), // "Used the X tag on a story"
  icon: text('icon'), // URL or icon key
  category: collectibleCategoryEnum('category').notNull(),
  // ── Award criteria (machine-readable) ──
  //
  // This is the KEY design decision. Store the rule as structured JSON
  // so your awarding logic can be data-driven rather than hard-coded.
  //
  // Example for "used tag X":
  //   { "type": "TAG_USED", "tagSlug": "alternate-universe" }
  //
  // Example for "published 10 stories":
  //   { "type": "STORY_COUNT", "threshold": 10 }
  //
  criteria: jsonb('criteria').notNull(),
  // Whether this badge is currently earnable
  active: boolean('active').default(true).notNull(),
  // For time-limited event badges
  startsAt: timestamp('starts_at'),
  expiresAt: timestamp('expires_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at')
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
})

export const userBadge = pgTable(
  'user_badge',
  {
    id: cuid(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    badgeId: text('badge_id')
      .notNull()
      .references(() => badge.id, { onDelete: 'cascade' }),
    // What triggered the award — helpful for audit/display
    // e.g. { "storyId": "clxyz...", "tagSlug": "alternate-universe" }
    context: jsonb('context'),
    awardedAt: timestamp('awarded_at').defaultNow().notNull(),
  },
  (table) => [
    unique('user_badge_user_id_badge_id_unique').on(table.userId, table.badgeId),
    index('user_badge_user_id_idx').on(table.userId),
    index('user_badge_badge_id_idx').on(table.badgeId),
  ],
)

export const badgeRelations = relations(badge, ({ many }) => ({
  userBadges: many(userBadge),
}))

export const userBadgeRelations = relations(userBadge, ({ one }) => ({
  user: one(user, {
    fields: [userBadge.userId],
    references: [user.id],
  }),
  badge: one(badge, {
    fields: [userBadge.badgeId],
    references: [badge.id],
  }),
}))
