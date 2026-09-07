import type { SecondaryStorage } from 'better-auth'

import type { RedisType } from '@/lib/redis'

export function redisSecondaryStorage(redis: RedisType): SecondaryStorage {
  return {
    get(key) {
      return redis.get(key)
    },
    getAndDelete(key) {
      return redis.getdel(key)
    },
    async increment(key, ttl) {
      if (!Number.isInteger(ttl) || ttl <= 0) {
        throw new TypeError('Redis increment TTL must be a positive integer')
      }
      const [value] = await redis.multi().incr(key).expire(key, ttl, 'NX').exec()
      return value
    },
    async set(key, value, ttl) {
      if (ttl) {
        await redis.set(key, value, { ex: ttl })
      } else {
        await redis.set(key, value)
      }
    },
    async delete(key) {
      await redis.del(key)
    },
  }
}
