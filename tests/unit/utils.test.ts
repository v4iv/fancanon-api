import { describe, expect, it } from 'vitest'
import { getHostMatcher } from '@/lib/utils'

describe('getHostMatcher', () => {
  it('matches exact hostnames', () => {
    const matcher = getHostMatcher('fancanon.com, localhost')
    expect(matcher('https://fancanon.com')).toBe(true)
    expect(matcher('http://localhost:5173')).toBe(true)
    expect(matcher('https://other.com')).toBe(false)
  })

  it('matches wildcard subdomains with *.domain.com', () => {
    const matcher = getHostMatcher('*.fancanon.com')
    expect(matcher('https://api.fancanon.com')).toBe(true)
    expect(matcher('https://staging.api.fancanon.com')).toBe(true)
    expect(matcher('https://fancanon.com')).toBe(true)
    expect(matcher('https://notfancanon.com')).toBe(false)
    expect(matcher('https://evil-fancanon.com')).toBe(false)
  })

  it('handles spaces and empty segments gracefully in rawEnv', () => {
    const matcher = getHostMatcher('  fancanon.com ,  , *.fancanon.com  ')
    expect(matcher('https://fancanon.com')).toBe(true)
    expect(matcher('https://preview.fancanon.com')).toBe(true)
    expect(matcher('https://external.org')).toBe(false)
  })

  it('returns false for invalid or malformed origin URLs', () => {
    const matcher = getHostMatcher('fancanon.com')
    expect(matcher('not-a-valid-url')).toBe(false)
    expect(matcher('')).toBe(false)
  })
})
