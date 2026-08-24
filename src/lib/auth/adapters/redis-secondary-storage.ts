import type { SecondaryStorage } from 'better-auth'
import { captureException } from '@sentry/hono/cloudflare'

import type { RedisType } from '@/lib/redis'

export function redisSecondaryStorage(redis: RedisType): SecondaryStorage {
  return {
    async get(key: string) {
      try {
        const value = await redis.get(key)

        // Handle different return types from Redis
        if (value === null || value === undefined) {
          return null
        }

        // If it's already a string, return it
        if (typeof value === 'string') {
          return value
        }

        // If it's an object, stringify it
        if (typeof value === 'object') {
          return JSON.stringify(value)
        }

        // Convert to string for any other type
        return String(value)
      } catch (error) {
        captureException(error)
        return null
      }
    },

    async set(key: string, value: string, ttl?: number) {
      try {
        // Ensure value is a string
        const stringValue = typeof value === 'string' ? value : JSON.stringify(value)

        if (ttl) {
          // Set with TTL in seconds
          await redis.set(key, stringValue, { ex: ttl })
        } else {
          // Set without TTL
          await redis.set(key, stringValue)
        }
      } catch (error) {
        captureException(error)
        throw error
      }
    },

    async delete(key: string) {
      try {
        await redis.del(key)
      } catch (error) {
        captureException(error)
        throw error
      }
    },
  }
}
