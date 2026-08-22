import * as v from 'valibot'

import { DEFAULT_LIMIT, DEFAULT_PAGE } from '@/lib/constants'
import { CommentSchema } from '@/lib/types'

export const requestParamSchema = v.object({
  chapterId: v.string('Unique identifier of the target chapter.'),
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

export const actionResponseSchema = v.object({
  success: v.boolean(),
})

export const commentsResponseSchema = v.object({
  success: v.boolean(),
  comments: v.array(CommentSchema),
  totalCount: v.number(),
  totalPages: v.number(),
  hasMore: v.boolean(),
  next: v.nullable(v.number()),
})
