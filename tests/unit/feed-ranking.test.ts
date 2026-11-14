import { describe, expect, it } from 'vitest'
import { buildStoryFilterSql } from '@/lib/helpers/feed-helper'

describe('buildStoryFilterSql', () => {
  it('returns undefined when no filter criteria are provided', () => {
    expect(buildStoryFilterSql({})).toBeUndefined()
    expect(
      buildStoryFilterSql({
        languages: [],
        contentRating: [],
        completion: null,
      }),
    ).toBeUndefined()
  })

  it('builds a language filter condition', () => {
    const filter = buildStoryFilterSql({ languages: ['english', 'spanish'] })
    expect(filter).toBeDefined()
  })

  it('builds a content rating condition', () => {
    const filter = buildStoryFilterSql({ contentRating: ['GENERAL', 'TEEN'] })
    expect(filter).toBeDefined()
  })

  it('handles completion statuses correctly', () => {
    const completedFilter = buildStoryFilterSql({ completion: 'completed' })
    expect(completedFilter).toBeDefined()

    const ongoingFilter = buildStoryFilterSql({ completion: 'ongoing' })
    expect(ongoingFilter).toBeDefined()

    const anyFilter = buildStoryFilterSql({ completion: 'any' })
    expect(anyFilter).toBeUndefined()
  })

  it('combines multiple conditions', () => {
    const combined = buildStoryFilterSql({
      languages: ['english'],
      contentRating: ['EXPLICIT'],
      completion: 'completed',
    })
    expect(combined).toBeDefined()
  })
})

describe('Hacker News Style Decay Scoring Logic', () => {
  const calculateRank = (score: number, ageHours: number, gravity = 1.8) => {
    return score / Math.pow(ageHours + 2, gravity)
  }

  it('decays rank over time for identical interaction score', () => {
    const score = 100
    const rank1Hour = calculateRank(score, 1)
    const rank24Hours = calculateRank(score, 24)
    const rank72Hours = calculateRank(score, 72)

    expect(rank1Hour).toBeGreaterThan(rank24Hours)
    expect(rank24Hours).toBeGreaterThan(rank72Hours)
  })

  it('ranks higher scoring story higher at the same age', () => {
    const rankHigh = calculateRank(500, 12)
    const rankLow = calculateRank(50, 12)

    expect(rankHigh).toBeGreaterThan(rankLow)
  })

  it('decays faster with higher gravity', () => {
    const normalDecay = calculateRank(100, 24, 1.8)
    const fastDecay = calculateRank(100, 24, 2.5)

    expect(normalDecay).toBeGreaterThan(fastDecay)
  })
})
