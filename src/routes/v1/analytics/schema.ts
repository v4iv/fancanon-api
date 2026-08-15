import * as v from 'valibot'

export const requestSchema = v.object({
  cid: v.string(),
  sid: v.string(),
  viewed: v.record(v.string(), v.number()),
})

export const responseSchema = v.object({
  success: v.boolean(),
})
