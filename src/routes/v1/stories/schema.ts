import * as v from 'valibot'

export const storyParamSchema = v.object({
  storyId: v.string('Unique identifier of the target story.'),
})

export const storyActionResponseSchema = v.object({
  success: v.boolean(),
})
