import type { Context, Next } from 'hono'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'

import * as schema from '@/lib/db/schema'

export function createDb(connectionString: string) {
  const client = postgres(connectionString, {
    prepare: false, // Prevents prepare query caching issues across proxy layers
    max: 1,
  })

  return drizzle(client, { schema })
}

export type Database = ReturnType<typeof createDb>

function withDatabase(c: Context, next: Next) {
  const databaseUrl = c.env.HYPERDRIVE.connectionString

  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set')
  }

  if (!c.get('db')) {
    c.set('db', createDb(databaseUrl))
  }

  return next()
}

export { withDatabase }
