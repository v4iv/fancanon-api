import * as v from 'valibot'

import { DEFAULT_LIMIT, DEFAULT_PAGE } from '@/lib/constants'
import { CompletionSchema, ContentRatingSchema, LanguageSchema, StorySchema } from '@/lib/types'

const idArrayFromJson = () =>
  v.optional(
    v.pipe(
      v.string(),
      v.transform((val) => {
        try {
          const parsed = JSON.parse(val)
          if (Array.isArray(parsed)) {
            return parsed
              .map((item) =>
                typeof item === 'object' && item !== null && 'value' in item
                  ? String(item.value)
                  : String(item),
              )
              .filter(Boolean)
          }
          // Single selection collapsed to a bare { value } object rather
          // than a one-element array.
          if (parsed && typeof parsed === 'object' && 'value' in parsed) {
            return [String((parsed as { value: unknown }).value)].filter(Boolean)
          }
          // Bare JSON string, e.g. includeTags="abc123"
          if (typeof parsed === 'string' && parsed.length > 0) return [parsed]
          return null
        } catch {
          // Not valid JSON at all — a raw unquoted id like ?fandoms=abc123
          return val ? [val] : null
        }
      }),
      v.array(v.string()),
    ),
  )

export const searchQuerySchema = v.object({
  q: v.fallback(
    v.pipe(
      v.string(),
      v.trim(),
      v.maxLength(100, 'Search query cannot be longer than 100 characters'),
    ),
    '',
  ),

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

  sort: v.optional(v.picklist(['relevance', 'newest', 'oldest']), 'relevance'),

  fandoms: idArrayFromJson(),

  includeTags: idArrayFromJson(),

  excludeTags: idArrayFromJson(),
})

export const searchResponseSchema = v.object({
  success: v.boolean(),
  stories: v.array(StorySchema),
  totalCount: v.number(),
  currentPage: v.number(),
  totalPages: v.number(),
  next: v.nullable(v.number()),
  hasMore: v.boolean(),
})
