import * as v from 'valibot'

import { Languages } from '@/lib/constants'
import { contentRatingEnum, tagTypeEnum } from '@/lib/db/schema'

export const ContentRatingSchema = v.picklist(contentRatingEnum.enumValues)
export const TagTypeSchema = v.picklist(tagTypeEnum.enumValues)
export const LanguageSchema = v.enum(Languages)
export const CompletionSchema = v.picklist(['any', 'ongoing', 'completed'])

export const UserSchema = v.object({
  id: v.string(),
  name: v.string(),
  email: v.string(),
  emailVerified: v.boolean(),
  image: v.nullable(v.string()),
  username: v.nullable(v.string()),
  displayUsername: v.nullable(v.string()),
  explicitConsentAt: v.nullable(v.string()),
  explicitConsentVersion: v.nullable(v.string()),
  createdAt: v.date(),
  updatedAt: v.date(),
})

export type UserType = v.InferOutput<typeof UserSchema>

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
  author: v.pick(UserSchema, ['id', 'username']),
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
  createdAt: v.date(),
  updatedAt: v.date(),
})

export type StoryType = v.InferOutput<typeof StorySchema>

export const ChapterEmbedSchema = v.object({
  provider: v.picklist(['spotify', 'apple-music']),
  url: v.pipe(v.string(), v.url()),
})

export type ChapterEmbedType = v.InferOutput<typeof ChapterEmbedSchema>

export const ChapterSchema = v.object({
  id: v.string(),
  storyId: v.string(),
  authorId: v.string(),
  title: v.optional(v.string()),
  chapterIndex: v.number(),
  content: v.string(),
  embed: ChapterEmbedSchema,
  viewCount: v.number(),
  author: v.object({
    id: v.string(),
    username: v.string(),
    image: v.string(),
    name: v.string(),
  }),
  bookmarks: v.array(
    v.object({
      userId: v.string(),
      chapterId: v.string(),
    }),
  ),
  createdAt: v.date(),
  updatedAt: v.date(),
})

export type ChapterType = v.InferOutput<typeof ChapterSchema>

export type CommentType = {
  id: string
  chapterId: string
  authorId: string
  parentId: string | null
  content: string
  likeCount: number
  replyCount: number
  author: Pick<UserType, 'id' | 'name' | 'image' | 'username'>
  likes: { userId: string; commentId: string }[]
  depth: number
  replies: CommentType[]
  createdAt: Date
  updatedAt: Date
}

// GenericSchema Annotation: Applied to CommentSchema so TypeScript can resolve self-referential recursive schemas cleanly.
export const CommentSchema: v.GenericSchema<CommentType> = v.object({
  id: v.string(),
  chapterId: v.string(),
  authorId: v.string(),
  parentId: v.nullable(v.string()),
  content: v.string(),
  likeCount: v.number(),
  replyCount: v.number(),
  author: v.pick(UserSchema, ['id', 'image', 'name', 'username']),
  likes: v.array(
    v.object({
      userId: v.string(),
      commentId: v.string(),
    }),
  ),
  depth: v.number(),
  replies: v.array(v.lazy(() => CommentSchema)),
  createdAt: v.date(),
  updatedAt: v.date(),
})
