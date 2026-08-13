import { Redis } from '@upstash/redis/cloudflare'

export function createRedis(env: CloudflareBindings): any {
  return Redis.fromEnv(env)
}

export type RedisType = ReturnType<typeof createRedis>
