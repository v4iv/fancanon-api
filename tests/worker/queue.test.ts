import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { env, createExecutionContext, createMessageBatch, getQueueResult } from 'cloudflare:test'
import { eq, inArray } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'

import { createDb } from '@/lib/db'
import { activity, feedItem, follow, like, story, user } from '@/lib/db/schema'
import { handleFanoutBatch, enqueueFanout } from '@/lib/helpers/feed-helper'
import type { FanoutQueueMessage } from '@/lib/types'
import { app } from '@/index'

describe('Phase 4: Cloudflare Queues & Worker Runtime Tests (workerd)', () => {
  let db: ReturnType<typeof createDb>
  const trackedUserIds: string[] = []

  async function createTestUser(prefix = 'worker_user') {
    const id = `usr_${createId()}`
    const username = `u_${createId().slice(0, 10)}`
    const email = `${id}@worker-test.local`

    const [created] = await db
      .insert(user)
      .values({
        id,
        name: `${prefix}_${username}`,
        email,
        username,
        emailVerified: true,
      })
      .returning()

    trackedUserIds.push(created.id)
    return created
  }

  async function createTestStory(authorId: string) {
    const id = `sty_${createId()}`
    const [created] = await db
      .insert(story)
      .values({
        id,
        authorId,
        title: `Story ${id}`,
        description: 'Test story for queue fanout in workerd',
        contentRating: 'GENERAL',
        language: 'english',
      })
      .returning()

    return created
  }

  async function createTestActivity(actorId: string, storyId: string) {
    const id = `act_${createId()}`
    const [created] = await db
      .insert(activity)
      .values({
        id,
        actorId,
        verb: 'STORY_PUBLISHED',
        storyId,
      })
      .returning()

    return created
  }

  beforeAll(async () => {
    db = createDb(env.HYPERDRIVE.connectionString)
  })

  afterAll(async () => {
    if (trackedUserIds.length > 0) {
      await db.delete(user).where(inArray(user.id, trackedUserIds))
    }
  })

  describe('1. Queue Producer Binding & Helper Contract', () => {
    it('env.FANOUT_QUEUE should be bound and accept single messages', async () => {
      expect(env.FANOUT_QUEUE).toBeDefined()
      await expect(
        env.FANOUT_QUEUE.send({ activityId: 'act_producer_test_1' }),
      ).resolves.toBeDefined()
    })

    it('env.FANOUT_QUEUE should accept batch messages', async () => {
      await expect(
        env.FANOUT_QUEUE.sendBatch([
          { body: { activityId: 'act_batch_1' } },
          { body: { activityId: 'act_batch_2' } },
        ]),
      ).resolves.toBeDefined()
    })

    it('enqueueFanout helper should send a message to the queue', async () => {
      await expect(enqueueFanout(env.FANOUT_QUEUE, 'act_helper_test')).resolves.toBeUndefined()
    })
  })

  describe('2. Queue Consumer: Batch Processing & In-Batch Deduplication', () => {
    it('should fanout to recipients and acknowledge all deduplicated messages in the batch', async () => {
      const author = await createTestUser('author')
      const follower = await createTestUser('follower')
      const liker = await createTestUser('liker')

      const testStory = await createTestStory(author.id)

      // Set up follower and liker
      await db.insert(follow).values({ followerId: follower.id, followeeId: author.id })
      await db.insert(like).values({ userId: liker.id, storyId: testStory.id })

      const pubActivity = await createTestActivity(author.id, testStory.id)

      const ctx = createExecutionContext()
      // Simulate 3 queue messages in the same batch with the identical activityId
      const batch = createMessageBatch<FanoutQueueMessage>('fancanon-fanout-queue', [
        {
          id: 'msg-dup-1',
          timestamp: new Date(),
          body: { activityId: pubActivity.id },
          attempts: 1,
        },
        {
          id: 'msg-dup-2',
          timestamp: new Date(),
          body: { activityId: pubActivity.id },
          attempts: 1,
        },
        {
          id: 'msg-dup-3',
          timestamp: new Date(),
          body: { activityId: pubActivity.id },
          attempts: 1,
        },
      ])

      await handleFanoutBatch(batch, env as any, ctx)

      const result = await getQueueResult(batch, ctx)

      // All 3 messages must be acknowledged
      expect(result.outcome).toBe('ok')
      expect(result.explicitAcks).toEqual(['msg-dup-1', 'msg-dup-2', 'msg-dup-3'])
      expect(result.retryMessages.length).toBe(0)

      // Verify that the feed items were created for the recipients
      const feedItems = await db
        .select()
        .from(feedItem)
        .where(eq(feedItem.activityId, pubActivity.id))

      expect(feedItems.length).toBe(2)
      const recipientIds = feedItems.map((f) => f.ownerId)
      expect(recipientIds).toContain(follower.id)
      expect(recipientIds).toContain(liker.id)
      expect(recipientIds).not.toContain(author.id)
    })
  })

  describe('3. Queue Consumer: Retry Policies & Error Isolation', () => {
    it('should schedule retry for non-existent activity when fanoutActivity fails', async () => {
      const ctx = createExecutionContext()
      const nonExistentActivityId = `act_nonexistent_${createId()}`

      const batch = createMessageBatch<FanoutQueueMessage>('fancanon-fanout-queue', [
        {
          id: 'msg-fail-1',
          timestamp: new Date(),
          body: { activityId: nonExistentActivityId },
          attempts: 1,
        },
      ])

      await handleFanoutBatch(batch, env as any, ctx)

      const result = await getQueueResult(batch, ctx)

      // Message must be scheduled for retry, not acknowledged
      expect(result.explicitAcks).not.toContain('msg-fail-1')
      expect(result.retryMessages.map((m) => m.msgId)).toContain('msg-fail-1')
    })

    it('should achieve granular error isolation: ack valid message and retry failing message in mixed batch', async () => {
      const author = await createTestUser('author')
      const follower = await createTestUser('follower')
      await db.insert(follow).values({ followerId: follower.id, followeeId: author.id })

      const testStory = await createTestStory(author.id)
      const validActivity = await createTestActivity(author.id, testStory.id)
      const invalidActivityId = `act_invalid_${createId()}`

      const ctx = createExecutionContext()
      const batch = createMessageBatch<FanoutQueueMessage>('fancanon-fanout-queue', [
        {
          id: 'msg-good',
          timestamp: new Date(),
          body: { activityId: validActivity.id },
          attempts: 1,
        },
        {
          id: 'msg-bad',
          timestamp: new Date(),
          body: { activityId: invalidActivityId },
          attempts: 1,
        },
      ])

      await handleFanoutBatch(batch, env as any, ctx)

      const result = await getQueueResult(batch, ctx)

      // Valid message acknowledged, invalid message scheduled for retry
      expect(result.explicitAcks).toContain('msg-good')
      expect(result.explicitAcks).not.toContain('msg-bad')

      const retriedIds = result.retryMessages.map((m) => m.msgId)
      expect(retriedIds).toContain('msg-bad')
      expect(retriedIds).not.toContain('msg-good')

      // Verify the valid message created feed items in the DB
      const feedItems = await db
        .select()
        .from(feedItem)
        .where(eq(feedItem.activityId, validActivity.id))

      expect(feedItems.length).toBe(1)
      expect(feedItems[0].ownerId).toBe(follower.id)
    })

    it('should acknowledge malformed messages with empty activityId without infinite retrying', async () => {
      const ctx = createExecutionContext()
      const batch = createMessageBatch<FanoutQueueMessage>('fancanon-fanout-queue', [
        {
          id: 'msg-malformed',
          timestamp: new Date(),
          body: { activityId: '' },
          attempts: 1,
        },
      ])

      await handleFanoutBatch(batch, env as any, ctx)

      const result = await getQueueResult(batch, ctx)
      expect(result.explicitAcks).toContain('msg-malformed')
      expect(result.retryMessages.length).toBe(0)
    })
  })

  describe('4. Worker Fetch Handler in workerd Runtime', () => {
    it('should serve GET / with SVG logo in workerd', async () => {
      const ctx = createExecutionContext()
      const req = new Request('http://localhost/')
      const res = await app.fetch(req, env as any, ctx)

      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toContain('image/svg+xml')
    })

    it('should serve GET /openapi with JSON spec in workerd', async () => {
      const ctx = createExecutionContext()
      const req = new Request('http://localhost/openapi')
      const res = await app.fetch(req, env as any, ctx)

      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toContain('application/json')
      const spec = (await res.json()) as any
      expect(spec.info.title).toBe('Fancanon API Documentation')
    })

    it('should handle CORS preflight OPTIONS in workerd', async () => {
      const ctx = createExecutionContext()
      const req = new Request('http://localhost/v1/stories', {
        method: 'OPTIONS',
        headers: {
          Origin: 'http://localhost:5173',
          'Access-Control-Request-Method': 'POST',
        },
      })
      const res = await app.fetch(req, env as any, ctx)

      expect(res.status).toBe(204)
      expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:5173')
      expect(res.headers.get('access-control-max-age')).toBe('86400')
    })
  })
})
