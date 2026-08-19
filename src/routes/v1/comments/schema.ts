import * as v from 'valibot'

export const requestParamSchema = v.object({
  commentId: v.string('Unique identifier of the target comment.'),
})

export const actionResponseSchema = v.object({
  success: v.boolean(),
})
