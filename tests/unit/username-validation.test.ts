import { describe, expect, it } from 'vitest'
import { RESTRICTED_USERNAMES } from '@/lib/constants'

// Extracted from auth configuration validator
export const isValidUsername = (username: string) => {
  const normalized = username.trim().toLowerCase()

  return (
    !RESTRICTED_USERNAMES.some(
      (restricted) =>
        normalized === restricted ||
        normalized.startsWith(restricted) ||
        normalized.endsWith(restricted),
    ) && /^[a-zA-Z0-9_.]+$/.test(username)
  )
}

describe('Username Validation', () => {
  it('allows valid alphanumeric usernames, underscores, and dots', () => {
    expect(isValidUsername('john_doe')).toBe(true)
    expect(isValidUsername('jane.doe42')).toBe(true)
    expect(isValidUsername('coolAuthor99')).toBe(true)
  })

  it('rejects usernames containing restricted system words', () => {
    expect(isValidUsername('admin')).toBe(false)
    expect(isValidUsername('administrator')).toBe(false)
    expect(isValidUsername('root')).toBe(false)
    expect(isValidUsername('support')).toBe(false)
    expect(isValidUsername('fancanon')).toBe(false)
  })

  it('rejects usernames starting with or ending with restricted words', () => {
    expect(isValidUsername('admin_user')).toBe(false)
    expect(isValidUsername('the_admin')).toBe(false)
    expect(isValidUsername('mod_alice')).toBe(false)
    expect(isValidUsername('super_mod')).toBe(false)
  })

  it('rejects usernames with illegal characters or spaces', () => {
    expect(isValidUsername('john doe')).toBe(false)
    expect(isValidUsername('user@name')).toBe(false)
    expect(isValidUsername('bad#tag')).toBe(false)
    expect(isValidUsername('slash/user')).toBe(false)
    expect(isValidUsername('')).toBe(false)
  })
})
