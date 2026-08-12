import { createId } from '@paralleldrive/cuid2'
import { text } from 'drizzle-orm/pg-core'

export const cuid = (name = 'id') => text(name).$defaultFn(createId).primaryKey()
