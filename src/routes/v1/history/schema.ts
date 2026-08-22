import * as v from 'valibot'

import { DEFAULT_LIMIT, DEFAULT_PAGE } from '@/lib/constants'
import { ChapterSchema, StorySchema } from '@/lib/types'

export const requestParamSchema = v.object({
  chapterId: v.string(),
})

export const requestQuerySchema = v.object({
  page: v.fallback(
    v.pipe(
      v.string(),
      v.transform((val) => Number(val)),
      v.integer('Page must be an integer'),
      v.minValue(1, 'Page must be at least 1'),
    ),
    DEFAULT_PAGE,
  ),
  limit: v.fallback(
    v.pipe(
      v.string(),
      v.transform((val) => Number(val)),
      v.integer('Limit must be an integer'),
      v.minValue(1, 'Limit must be at least 1'),
      v.maxValue(100, 'Limit cannot exceed 100'),
    ),
    DEFAULT_LIMIT,
  ),
})

export const responseSchema = v.object({
  success: v.boolean(),
  history: v.array(
    v.object({
      userId: v.string(),
      chapterId: v.string(),
      storyId: v.string(),
      chapter: v.partial(ChapterSchema),
      story: v.partial(StorySchema),
      lastViewedAt: v.date(),
    }),
  ),
  currentPage: v.number(),
  totalPages: v.number(),
  next: v.nullable(v.number()),
  hasMore: v.boolean(),
})
