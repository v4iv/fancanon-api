import { Hono } from 'hono'
import { eq, sql } from 'drizzle-orm'
import { describeRoute, resolver, validator } from 'hono-openapi'

import { AppContext } from '@/types'
import { withDatabase } from '@/lib/db'
import { VIEW_DEDUP_WINDOW_SECONDS } from '@/lib/constants'
import { chapter, story, history } from '@/lib/db/schema'
import { requestSchema, responseSchema } from './schema'

const app = new Hono<AppContext>()

app.post(
  '/views/record',
  describeRoute({
    description: 'Records chapter views and reading history',
    responses: {
      200: {
        description: 'Successful response',
        content: {
          'application/json': { schema: resolver(responseSchema) },
        },
      },
    },
  }),
  validator('json', requestSchema),
  withDatabase,
  async (c) => {
    const { cid, sid, viewed } = c.req.valid('json')
    const user = c.get('user')
    const userId = user?.id ?? ''
    const db = c.get('db')

    try {
      // Aggregate counter — soft dedup via the client-supplied "last
      // seen" hint. Only decides whether to bump the public count.
      const lastViewed = viewed?.[cid]
      const alreadyCountedRecently =
        lastViewed && Date.now() - lastViewed < VIEW_DEDUP_WINDOW_SECONDS * 1000

      if (!alreadyCountedRecently) {
        await db.transaction(async (tx) => {
          await tx
            .update(chapter)
            .set({ viewCount: sql`${chapter.viewCount} + 1` })
            .where(eq(chapter.id, cid))
          await tx
            .update(story)
            .set({ viewCount: sql`${story.viewCount} + 1` })
            .where(eq(story.id, sid))
        })
      }

      // History — deliberately NOT gated by alreadyCountedRecently. A
      // user who read this anonymously, then logged in and revisits it,
      // still needs a history row now — the counter's dedup window has
      // nothing to do with whether THIS user has a history entry.
      if (user) {
        await db
          .insert(history)
          .values({
            userId,
            chapterId: cid,
            storyId: sid,
            lastViewedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: [history.userId, history.chapterId],
            set: { lastViewedAt: new Date() },
          })
      }

      return c.json({ success: true })
    } catch (err) {
      console.error(err)
      return c.json({ success: true })
    }
  },
)

export { app as analytics }
