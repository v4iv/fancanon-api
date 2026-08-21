import * as v from 'valibot'

import { DEFAULT_LIMIT, DEFAULT_PAGE } from '@/lib/constants'

export const indicatorResponseSchema = v.object({
  success: v.boolean(),
  unseenCount: v.number(),
})

export const requestSchema = v.object({
  notificationIds: v.array(v.string()),
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
  notifications: v.array(v.any()),
  currentPage: v.number(),
  totalPages: v.number(),
  next: v.nullable(v.number()),
  hasMore: v.boolean(),
})
