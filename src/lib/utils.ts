import { createId } from '@paralleldrive/cuid2'
import { text } from 'drizzle-orm/pg-core'

export const cuid = (name = 'id') => text(name).$defaultFn(createId).primaryKey()

// Helper function to turn wildcard origin strings into regular expressions
export function createHostMatcher(allowedHostsEnv: string) {
  // 1. Guard against empty/undefined string
  if (!allowedHostsEnv || typeof allowedHostsEnv !== 'string') {
    return () => false
  }

  // 2. Split and remove empty entries / accidental whitespace
  const hosts = allowedHostsEnv
    .split(',')
    .map((h) => h.trim())
    .filter((h) => h.length > 0) // Removes empty strings!

  const matchers = hosts.map((host) => {
    // 3. Escape regex special characters safely
    const escaped = host.replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    // Replace wildcard '*' with wildcard pattern '.*'
    const regexString = `^${escaped.replace(/\\\*/g, '.*')}$`

    // 4. Wrap in try-catch in case an invalid string sneaks in
    try {
      return new RegExp(regexString)
    } catch (e) {
      console.error(`Invalid CORS host regex created for: "${host}"`, e)
      return /^$/ // harmless fallback regex that matches nothing
    }
  })

  return (origin: string): boolean => {
    try {
      const hostname = new URL(origin).hostname
      return matchers.some((matcher) => matcher.test(hostname))
    } catch {
      return false
    }
  }
}
