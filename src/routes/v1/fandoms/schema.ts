import * as v from 'valibot'

import { DEFAULT_LIMIT, DEFAULT_PAGE } from '@/lib/constants'
import { CompletionSchema, ContentRatingSchema, LanguageSchema, StorySchema } from '@/lib/types'

export const requestParamSchema = v.object({
  slug: v.string(),
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

  sort: v.picklist(['hot', 'new', 'old'], 'new'),

  // Completion: Optional single value, defaults to 'any'
  completion: v.optional(CompletionSchema, 'any'),

  // Languages: Optional array of languages (e.g. ?languages=english&languages=french)
  // Accepts a single string or an array of strings, transformed into string[]
  languages: v.optional(
    v.pipe(
      v.union([v.string(), v.array(v.string())]),
      v.transform((val) => (Array.isArray(val) ? val : [val])),
      v.array(LanguageSchema),
    ),
  ),

  // Content Rating: Optional array of ratings (e.g. ?ratings=TEEN&ratings=MATURE)
  ratings: v.optional(
    v.pipe(
      v.union([v.string(), v.array(v.string())]),
      v.transform((val) => (Array.isArray(val) ? val : [val])),
      v.array(ContentRatingSchema),
    ),
  ),
})

export const searchRequestQuerySchema = v.object({
  q: v.pipe(
    v.string(),
    v.trim(),
    v.nonEmpty('Search query is required!'),
    v.minLength(3, 'Search query must be atleast 3 characters'),
    v.maxLength(30, 'Search query cannot be longer than 30 characters'),
  ),
  limit: v.fallback(
    v.pipe(
      v.string(),
      v.transform((val) => Number(val)),
      v.integer('Limit must be an integer'),
      v.minValue(1, 'Limit must be at least 1'),
      v.maxValue(100, 'Limit cannot exceed 100'),
    ),
    10,
  ),
})

export const responseSchema = v.object({
  success: v.boolean(),
  stories: v.array(StorySchema),
  currentPage: v.number(),
  totalPages: v.number(),
  next: v.nullable(v.number()),
  hasMore: v.boolean(),
})

export const searchResponseSchema = v.object({
  success: v.boolean(),
  results: v.array(
    v.object({
      label: v.string(),
      value: v.string(),
    }),
  ),
})
