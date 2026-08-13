import { createId } from '@paralleldrive/cuid2'
import { text } from 'drizzle-orm/pg-core'

export const cuid = (name = 'id') => text(name).$defaultFn(createId).primaryKey()

// Helper function to turn wildcard origin strings into regular expressions
export function createHostMatcher(allowedHostsEnv: string) {
  const hosts = allowedHostsEnv.split(',').map((h) => h.trim())

  const matchers = hosts.map((host) => {
    // Escape standard regex characters except *
    const escaped = host.replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    // Replace * with regex wildcard for subdomains
    const regexString = `^${escaped.replace(/\\\*/g, '.*')}$`
    return new RegExp(regexString)
  })

  return (origin: string): boolean => {
    try {
      // Extract hostname from full origin URL (e.g., "https://sub.fancanon.com:8080" -> "sub.fancanon.com")
      const hostname = new URL(origin).hostname
      return matchers.some((matcher) => matcher.test(hostname))
    } catch {
      return false // Return false if origin is not a valid URL
    }
  }
}
