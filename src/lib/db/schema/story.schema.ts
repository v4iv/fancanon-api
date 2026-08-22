import { relations, sql } from 'drizzle-orm'
import {
  pgTable,
  text,
  timestamp,
  boolean,
  integer,
  index,
  varchar,
  pgEnum,
  jsonb,
  unique,
  primaryKey,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core'

import { cuid } from '@/lib/utils'
import { ChapterEmbedType } from '@/lib/types'
import { activity, bookmark, comment, like, readLater, report, user } from '@/lib/db/schema'

export const contentRatingEnum = pgEnum('content_rating', ['GENERAL', 'TEEN', 'MATURE', 'EXPLICIT'])

export const tagTypeEnum = pgEnum('tag_type', [
  'FANDOM_FREEFORM',
  'RELATIONSHIP',
  'CHARACTER',
  'WARNING',
  'FREEFORM',
])

export const category = pgTable('category', {
  id: cuid(),
  createdById: text('created_by_id').references(() => user.id),
  name: text('name').notNull(),
  description: text('description'),
  slug: text('slug').notNull().unique(),
  meta: jsonb('meta'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at')
    .defaultNow()
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
})

export const fandom = pgTable('fandom', {
  id: cuid(),
  createdById: text('created_by_id').references(() => user.id),
  name: text('name').notNull(),
  description: text('description'),
  slug: varchar('slug').notNull().unique(),
  categoryId: text('category_id').references(() => category.id, {
    onDelete: 'cascade',
  }),
  meta: jsonb('meta'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at')
    .defaultNow()
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
})

export const story = pgTable(
  'story',
  {
    id: cuid(),
    authorId: text('author_id')
      .notNull()
      .references(() => user.id, {
        onDelete: 'cascade',
      }),
    title: text('title').notNull(),
    description: text('description'),
    contentRating: contentRatingEnum('content_rating').default('GENERAL').notNull(),
    language: varchar('language').default('english').notNull(),
    completed: boolean('completed').default(false).notNull(),

    // stats
    likeCount: integer('like_count').default(0).notNull(),
    wordCount: integer('word_count').default(0).notNull(),
    viewCount: integer('view_count').default(0).notNull(),
    chapterCount: integer('chapter_count').default(0).notNull(),
    commentCount: integer('comment_count').default(0).notNull(),
    readLaterCount: integer('read_later_count').default(0).notNull(),

    // metadata
    meta: jsonb('meta'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },

  (table) => [
    index('story_created_at_idx').on(table.createdAt), // your existing index

    // Matches: to_tsvector('english', story.title || ' ' || coalesce(story.description, ''))
    // — must stay byte-for-byte identical to the expression used in the
    // search query's WHERE/ORDER BY, or Postgres won't recognize this
    // index as applicable and will fall back to a full table scan.
    index('story_search_idx').using(
      'gin',
      sql`to_tsvector('english', ${table.title} || ' ' || coalesce(${table.description}, ''))`,
    ),
    index('story_title_trgm_idx').using('gin', sql`${table.title} gin_trgm_ops`),
    index('story_description_trgm_idx').using(
      'gin',
      sql`coalesce(${table.description}, '') gin_trgm_ops`,
    ),
  ],
)

export const chapter = pgTable(
  'chapter',
  {
    id: cuid(),
    authorId: text('author_id')
      .notNull()
      .references(() => user.id, {
        onDelete: 'cascade',
      }),
    storyId: text('story_id')
      .notNull()
      .references(() => story.id, {
        onDelete: 'cascade',
      }),
    chapterIndex: integer('chapter_index'),
    title: text('title').notNull(),
    content: text('content').notNull(),
    embed: jsonb('embed').$type<ChapterEmbedType | null>(),

    // stats
    viewCount: integer('view_count').default(0).notNull(),

    // metadata
    meta: jsonb('meta'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    unique('chapter_story_id_chapter_index_unique').on(table.storyId, table.chapterIndex),
  ],
)

export const tag = pgTable(
  'tag',
  {
    id: cuid(),
    name: text('name').notNull().unique(),
    slug: text('slug').notNull().unique(),
    type: tagTypeEnum('type').default('FREEFORM').notNull(),
    usageCount: integer('usage_count').default(0).notNull(),
    synonymOfId: text('synonym_of_id').references((): AnyPgColumn => tag.id),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index('tag_name_trgm_idx').using('gin', sql`${table.name} gin_trgm_ops`)],
)

export const storyTag = pgTable(
  'story_tag',
  {
    storyId: text('story_id')
      .notNull()
      .references(() => story.id, {
        onDelete: 'cascade',
      }),
    tagId: text('tag_id')
      .notNull()
      .references(() => tag.id, {
        onDelete: 'cascade',
      }),
  },
  (table) => [primaryKey({ columns: [table.storyId, table.tagId] })],
)

export const storyFandom = pgTable(
  'story_fandom',
  {
    storyId: text('story_id')
      .notNull()
      .references(() => story.id, {
        onDelete: 'cascade',
      }),
    fandomId: text('fandom_id')
      .notNull()
      .references(() => fandom.id, {
        onDelete: 'cascade',
      }),
  },
  (table) => [primaryKey({ columns: [table.storyId, table.fandomId] })],
)

/* -------------------------------------------------------------------------- */
/*                                  Relations                                 */
/* -------------------------------------------------------------------------- */

export const categoryRelations = relations(category, ({ one, many }) => ({
  createdBy: one(user, {
    fields: [category.createdById],
    references: [user.id],
  }),
  fandoms: many(fandom),
}))

export const fandomRelations = relations(fandom, ({ one, many }) => ({
  createdBy: one(user, {
    fields: [fandom.createdById],
    references: [user.id],
  }),

  category: one(category, {
    fields: [fandom.categoryId],
    references: [category.id],
  }),

  stories: many(storyFandom),
}))

export const storyRelations = relations(story, ({ one, many }) => ({
  author: one(user, {
    fields: [story.authorId],

    references: [user.id],
  }),

  chapters: many(chapter),
  tags: many(storyTag),
  fandoms: many(storyFandom),
  likes: many(like),
  readLaters: many(readLater),
  reports: many(report),
  activities: many(activity),
}))

export const chapterRelations = relations(chapter, ({ one, many }) => ({
  author: one(user, {
    fields: [chapter.authorId],
    references: [user.id],
  }),

  story: one(story, {
    fields: [chapter.storyId],
    references: [story.id],
  }),

  bookmarks: many(bookmark),
  comments: many(comment),
  reports: many(report),
  activities: many(activity),
}))

export const tagRelations = relations(tag, ({ one, many }) => ({
  synonymOf: one(tag, {
    fields: [tag.synonymOfId],
    references: [tag.id],
    relationName: 'synonyms',
  }),

  synonyms: many(tag, {
    relationName: 'synonyms',
  }),

  stories: many(storyTag),
}))

export const storyTagRelations = relations(storyTag, ({ one }) => ({
  story: one(story, {
    fields: [storyTag.storyId],
    references: [story.id],
  }),

  tag: one(tag, {
    fields: [storyTag.tagId],
    references: [tag.id],
  }),
}))

export const storyFandomRelations = relations(storyFandom, ({ one }) => ({
  story: one(story, {
    fields: [storyFandom.storyId],
    references: [story.id],
  }),

  fandom: one(fandom, {
    fields: [storyFandom.fandomId],
    references: [fandom.id],
  }),
}))
