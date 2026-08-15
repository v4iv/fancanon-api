import { ChapterSchema, ContentRatingSchema, StorySchema } from '@/lib/types.d'
import * as v from 'valibot'

export const storyParamSchema = v.object({
  storyId: v.string('Unique identifier of the target story.'),
})

export const storyActionResponseSchema = v.object({
  success: v.boolean(),
})

export const storyResponseSchema = v.object({
  success: v.boolean(),
  story: StorySchema,
})

export const ratingResponseSchema = v.object({
  success: v.boolean(),
  contentRating: ContentRatingSchema,
  author: v.object({
    id: v.string(),
    username: v.string(),
  }),
})

export const chaptersResponseSchema = v.object({
  success: v.boolean(),
  chapters: v.array(
    v.pick(ChapterSchema, [
      'id',
      'title',
      'authorId',
      'storyId',
      'chapterIndex',
      'viewCount',
      'bookmarks',
      'createdAt',
      'updatedAt',
    ]),
  ),
})
