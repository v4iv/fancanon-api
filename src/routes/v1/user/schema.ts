import * as v from 'valibot'

import { CommentSchema, StorySchema } from '@/lib/types'
import { DEFAULT_LIMIT, DEFAULT_PAGE } from '@/lib/constants'

export const requestParamSchema = v.object({
  username: v.string(),
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
  stories: v.array(StorySchema),
  totalCount: v.optional(v.number()),
  currentPage: v.number(),
  totalPages: v.number(),
  next: v.nullable(v.number()),
  hasMore: v.boolean(),
})

export const commentResponseSchema = v.object({
  success: v.boolean(),
  comments: v.array(CommentSchema),
  currentPage: v.number(),
  totalPages: v.number(),
  next: v.nullable(v.number()),
  hasMore: v.boolean(),
})
