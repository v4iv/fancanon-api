import * as v from 'valibot'

import { DEFAULT_LIMIT, DEFAULT_PAGE } from '@/lib/constants'
import { CompletionSchema, ContentRatingSchema, LanguageSchema, StorySchema } from '@/lib/schemas'

const idArrayFromJson = () =>
  v.optional(
    v.pipe(
      v.string(),
      v.transform((val) => {
        try {
          const parsed = JSON.parse(val)
          if (Array.isArray(parsed)) {
            return parsed.map((item: { value: string }) => item.value)
          }
          // Single selection collapsed to a bare { value } object rather
          // than a one-element array.
          if (parsed && typeof parsed === 'object' && 'value' in parsed) {
            return [(parsed as { value: string }).value]
          }
          // Bare JSON string, e.g. includeTags="abc123"
          if (typeof parsed === 'string') return [parsed]
          return null
        } catch {
          // Not valid JSON at all — a raw unquoted id like ?fandoms=abc123
          return [val]
        }
      }),
      v.array(v.string()),
    ),
  )

const tagNameArrayFromJson = () =>
  v.optional(
    v.pipe(
      v.string(),
      v.transform((val) => {
        try {
          const parsed = JSON.parse(val)
          if (Array.isArray(parsed)) return parsed
          if (typeof parsed === 'string') return [parsed]
          return null
        } catch {
          // Not valid JSON at all — a bare `includeTags=angst` is a
          // plausible single-value shape too, so treat it as one tag
          // rather than failing the whole request.
          return [val]
        }
      }),
      v.array(v.string()),
    ),
  )

export const searchQuerySchema = v.object({
  q: v.pipe(
    v.string(),
    v.trim(),
    v.nonEmpty('Search query is required!'),
    v.minLength(3, 'Search query must be atleast 3 characters'),
    v.maxLength(30, 'Search query cannot be longer than 30 characters'),
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

  includeTags: tagNameArrayFromJson(),

  excludeTags: tagNameArrayFromJson(),
})

export const searchResponseSchema = v.object({
  success: v.boolean(),
  stories: v.array(StorySchema),
  totalCount: v.number(),
  currentPage: v.number(),
  totalPages: v.number(),
  nextPage: v.nullable(v.number()),
  hasMore: v.boolean(),
})
