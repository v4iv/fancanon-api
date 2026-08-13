import * as v from 'valibot'

import { auth } from '@/lib/auth'
import type { Database } from '@/lib/db'
import { Languages } from '@/lib/constants'
import { contentRatingEnum, tagTypeEnum } from '@/lib/db/schema'

export type AppContext = {
  Bindings: CloudflareBindings
  Variables: {
    db: Database
    user: typeof auth.$Infer.Session.user | null
    session: typeof auth.$Infer.Session.session | null
  }
}

export const ContentRatingSchema = v.picklist(contentRatingEnum.enumValues)
export const TagTypeSchema = v.picklist(tagTypeEnum.enumValues)
export const LanguageSchema = v.enum(Languages)
export const CompletionSchema = v.picklist(['any', 'ongoing', 'completed'])

export const StorySchema = v.object({
  id: v.string(),
  authorId: v.string(),
  title: v.string(),
  description: v.string(),
  contentRating: ContentRatingSchema,
  language: LanguageSchema,
  completed: v.boolean(),
  likeCount: v.number(),
  wordCount: v.number(),
  viewCount: v.number(),
  chapterCount: v.number(),
  commentCount: v.number(),
  readLaterCount: v.number(),
  meta: v.nullable(v.any()),
  score: v.number(),
  author: v.object({
    id: v.string(),
    username: v.string(),
  }),
  tags: v.array(
    v.object({
      tag: v.object({
        id: v.string(),
        name: v.string(),
        slug: v.string(),
        type: TagTypeSchema,
      }),
    }),
  ),
  fandoms: v.array(
    v.object({
      fandom: v.object({
        id: v.string(),
        name: v.string(),
        slug: v.string(),
      }),
    }),
  ),
  likes: v.array(
    v.object({
      userId: v.string(),
      storyId: v.string(),
    }),
  ),
  readLaters: v.array(
    v.object({
      userId: v.string(),
      storyId: v.string(),
    }),
  ),
  createdAt: v.string(),
  updatedAt: v.string(),
})

export type StoryType = v.InferOutput<typeof StorySchema>
