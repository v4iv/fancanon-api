import { createId } from '@paralleldrive/cuid2'
import { text } from 'drizzle-orm/pg-core'

export const cuid = (name = 'id') => text(name).$defaultFn(createId).primaryKey()

// Cache the compiled match function across request lifetimes (0ms CPU cost per request)
let cachedMatcher: ((origin: string) => boolean) | null = null
let cachedEnvString: string | null = null

export function getHostMatcher(rawEnv: string) {
  if (cachedMatcher && cachedEnvString === rawEnv) {
    return cachedMatcher
  }

  const hosts = (rawEnv || '')
    .split(',')
    .map((h) => h.trim())
    .filter(Boolean)

  const exactHosts = new Set<string>()
  const wildcardDomains: string[] = []

  for (const host of hosts) {
    if (host.startsWith('*.')) {
      wildcardDomains.push(host.slice(2))
    } else {
      exactHosts.add(host)
    }
  }

  // Pure string comparison — 0ms Regex creation, zero CPU overhead
  cachedMatcher = (origin: string): boolean => {
    try {
      const hostname = new URL(origin).hostname

      // 1. O(1) Instant exact match check
      if (exactHosts.has(hostname)) return true

      // 2. Simple string end-matching for subdomains
      return wildcardDomains.some(
        (domain) => hostname === domain || hostname.endsWith(`.${domain}`),
      )
    } catch {
      return false
    }
  }

  cachedEnvString = rawEnv
  return cachedMatcher
}
