import * as v from 'valibot'

import { CATEGORIES, DEFAULT_LIMIT, DEFAULT_PAGE } from '@/lib/constants'
import { CompletionSchema, ContentRatingSchema, LanguageSchema, StorySchema } from '@/lib/schemas'

export const feedQuerySchema = v.object({
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

export const feedParamSchema = v.object({
  slug: v.picklist(CATEGORIES.map((cat) => cat.slug)),
})

export const feedResponseSchema = v.object({
  success: v.boolean(),
  stories: v.array(StorySchema),
  currentPage: v.number(),
  totalPages: v.number(),
  nextPage: v.nullable(v.number()),
  hasMore: v.boolean(),
})
