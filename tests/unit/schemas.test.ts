import { describe, expect, it } from 'vitest'
import * as v from 'valibot'

import { fanoutRequestSchema, feedParamSchema, feedQuerySchema } from '@/routes/v1/feed/schema'
import { searchQuerySchema } from '@/routes/v1/search/schema'
import { ChapterEmbedSchema, FanoutMessageSchema } from '@/lib/types'
import { DEFAULT_LIMIT, DEFAULT_PAGE } from '@/lib/constants'

describe('Feed Schemas', () => {
  describe('feedQuerySchema', () => {
    it('applies defaults for page and limit', () => {
      const parsed = v.parse(feedQuerySchema, {})
      expect(parsed.page).toBe(DEFAULT_PAGE)
      expect(parsed.limit).toBe(DEFAULT_LIMIT)
      expect(parsed.completion).toBe('any')
    })

    it('transforms string page and limit to numbers', () => {
      const parsed = v.parse(feedQuerySchema, { page: '3', limit: '50' })
      expect(parsed.page).toBe(3)
      expect(parsed.limit).toBe(50)
    })

    it('falls back to DEFAULT_LIMIT when limit exceeds 100 or is invalid', () => {
      const parsedExceeded = v.parse(feedQuerySchema, { limit: '150' })
      expect(parsedExceeded.limit).toBe(DEFAULT_LIMIT)

      const parsedInvalid = v.parse(feedQuerySchema, { limit: '-5' })
      expect(parsedInvalid.limit).toBe(DEFAULT_LIMIT)
    })

    it('transforms a single language string into an array', () => {
      const parsed = v.parse(feedQuerySchema, { languages: 'english' })
      expect(parsed.languages).toEqual(['english'])
    })

    it('accepts an array of valid supported languages', () => {
      const parsed = v.parse(feedQuerySchema, {
        languages: ['english', 'espanol'],
      })
      expect(parsed.languages).toEqual(['english', 'espanol'])
    })

    it('rejects unknown/invalid language', () => {
      expect(() => v.parse(feedQuerySchema, { languages: 'kryptonian' })).toThrow()
    })

    it('accepts valid content ratings', () => {
      const parsed = v.parse(feedQuerySchema, { ratings: ['TEEN', 'MATURE'] })
      expect(parsed.ratings).toEqual(['TEEN', 'MATURE'])
    })
  })

  describe('feedParamSchema', () => {
    it('accepts valid category slugs', () => {
      expect(v.parse(feedParamSchema, { slug: 'anime-manga' })).toEqual({
        slug: 'anime-manga',
      })
      expect(v.parse(feedParamSchema, { slug: 'books' })).toEqual({
        slug: 'books',
      })
    })

    it('rejects invalid category slugs', () => {
      expect(() => v.parse(feedParamSchema, { slug: 'non-existent-category' })).toThrow()
    })
  })

  describe('fanoutRequestSchema', () => {
    it('validates a correct payload with activityId', () => {
      const result = v.parse(fanoutRequestSchema, { activityId: 'act_123' })
      expect(result.activityId).toBe('act_123')
    })

    it('rejects payload missing activityId', () => {
      expect(() => v.parse(fanoutRequestSchema, {})).toThrow()
      expect(() => v.parse(fanoutRequestSchema, { activityId: 123 })).toThrow()
    })
  })
})

describe('Search Schemas', () => {
  it('accepts short queries and defaults or trims gracefully without throwing', () => {
    expect(v.parse(searchQuerySchema, { q: 'ab' }).q).toBe('ab')
    expect(v.parse(searchQuerySchema, { q: '   ' }).q).toBe('')
    expect(v.parse(searchQuerySchema, {}).q).toBe('')
    expect(v.parse(searchQuerySchema, { q: 'Harry Potter' }).q).toBe('Harry Potter')
  })

  it('parses JSON stringified tag/fandom selections gracefully', () => {
    const jsonArray = JSON.stringify([{ value: 'fandom_1' }, { value: 'fandom_2' }])
    const parsed = v.parse(searchQuerySchema, {
      q: 'magic',
      fandoms: jsonArray,
    })
    expect(parsed.fandoms).toEqual(['fandom_1', 'fandom_2'])
  })

  it('handles raw unquoted string fallback for single filter values', () => {
    const parsed = v.parse(searchQuerySchema, {
      q: 'magic',
      includeTags: 'angst',
    })
    expect(parsed.includeTags).toEqual(['angst'])
  })
})

describe('Chapter & Queue Types', () => {
  describe('ChapterEmbedSchema', () => {
    it('accepts spotify and apple-music providers with valid URLs', () => {
      expect(
        v.parse(ChapterEmbedSchema, {
          provider: 'spotify',
          url: 'https://open.spotify.com/track/abc',
        }),
      ).toEqual({
        provider: 'spotify',
        url: 'https://open.spotify.com/track/abc',
      })

      expect(
        v.parse(ChapterEmbedSchema, {
          provider: 'apple-music',
          url: 'https://music.apple.com/album/123',
        }),
      ).toEqual({
        provider: 'apple-music',
        url: 'https://music.apple.com/album/123',
      })
    })

    it('rejects unsupported embed providers', () => {
      expect(() =>
        v.parse(ChapterEmbedSchema, {
          provider: 'soundcloud',
          url: 'https://soundcloud.com/track',
        }),
      ).toThrow()
    })

    it('rejects malformed URLs', () => {
      expect(() =>
        v.parse(ChapterEmbedSchema, {
          provider: 'spotify',
          url: 'not-a-valid-url',
        }),
      ).toThrow()
    })
  })

  describe('FanoutMessageSchema', () => {
    it('validates queue message payload with required and optional fields', () => {
      const minimal = v.parse(FanoutMessageSchema, { activityId: 'act_1' })
      expect(minimal.activityId).toBe('act_1')

      const complete = v.parse(FanoutMessageSchema, {
        activityId: 'act_1',
        actorId: 'user_1',
        storyId: 'story_1',
      })
      expect(complete).toEqual({
        activityId: 'act_1',
        actorId: 'user_1',
        storyId: 'story_1',
      })
    })
  })
})
