import * as v from 'valibot'

import { StatsSchema, StorySchema } from '@/lib/schemas'

export const statsResponseSchema = v.object({
  success: v.boolean(),
  stats: StatsSchema,
})

export const storiesResponseSchema = v.object({
  succes: v.boolean(),
  stories: v.array(v.partial(StorySchema)),
})
