import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { inArray } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import { vi } from 'vitest'

import * as schema from '@/lib/db/schema'
import { activity, chapter, story, user } from '@/lib/db/schema'
import { handleFanoutBatch } from '@/lib/helpers/feed-helper'
import type { FanoutQueueMessage } from '@/lib/types'

const DATABASE_URL =
  process.env.DATABASE_URL || 'postgres://root:mysecretpassword@localhost:5432/local'

const isPostgresAvailable = await (async () => {
  try {
    const probe = postgres(DATABASE_URL, { connect_timeout: 1, max: 1 })
    await probe`SELECT 1`
    await probe.end()
    return true
  } catch {
    return false
  }
})()

// Dynamic multi-user session store for E2E user switching
const sessionStore = new Map<string, { user: any; session: any }>()

vi.mock('@/lib/auth', () => ({
  auth: vi.fn(() => ({
    api: {
      getSession: vi.fn(async ({ headers }) => {
        const cookieHeader = headers?.get?.('cookie') || headers?.cookie || ''
        const match = cookieHeader.match(/fancanon\.session_token=([^;]+)/)
        const token = match?.[1]
        if (token && sessionStore.has(token)) {
          return sessionStore.get(token)
        }
        return null
      }),
    },
    handler: vi.fn(async () => new Response('auth handler ok')),
  })),
}))

import { app } from '@/index'

describe.skipIf(!isPostgresAvailable)('Phase 5: Critical User Journey & Smoke Tests (E2E)', () => {
  let client: postgres.Sql
  let db: ReturnType<typeof drizzle<typeof schema>>
  const trackedUserIds: string[] = []
  const queuedFanoutMessages: FanoutQueueMessage[] = []

  const mockQueue = {
    send: vi.fn(async (msg: FanoutQueueMessage) => {
      queuedFanoutMessages.push(msg)
    }),
  }

  const mockEnv: any = {
    SENTRY_DSN: 'https://public@sentry.example.com/1',
    ALLOWED_HOSTS: 'fancanon.com,*.netlify.app,fancanon.waybove.workers.dev',
    ORIGIN: 'https://fancanon.com',
    COOKIE_DOMAIN: '.fancanon.com',
    FANOUT_QUEUE: mockQueue,
    HYPERDRIVE: { connectionString: DATABASE_URL },
    UPSTASH_REDIS_REST_URL: 'https://mock.upstash.io',
    UPSTASH_REDIS_REST_TOKEN: 'mock-redis-token',
  }

  async function createE2EUser(namePrefix = 'e2e_user') {
    const id = `usr_${createId()}`
    const username = `u_${createId().slice(0, 10)}`
    const email = `${id}@e2e-test.local`

    const [created] = await db
      .insert(user)
      .values({
        id,
        name: `${namePrefix}_${username}`,
        email,
        username,
        emailVerified: true,
      })
      .returning()

    trackedUserIds.push(created.id)

    // Register session for Cookie-based requests
    const token = `token_${created.id}`
    sessionStore.set(token, {
      user: created,
      session: { id: `sess_${created.id}`, userId: created.id },
    })

    return { ...created, token }
  }

  function reqHeaders(token?: string) {
    return {
      Origin: 'https://fancanon.com',
      ...(token ? { Cookie: `fancanon.session_token=${token}` } : {}),
    }
  }

  beforeAll(async () => {
    client = postgres(DATABASE_URL, { max: 15 })
    db = drizzle(client, { schema })
  })

  afterAll(async () => {
    if (trackedUserIds.length > 0) {
      await db.delete(user).where(inArray(user.id, trackedUserIds))
    }
    await client.end()
  })

  describe('Journey 1: Author Publishing -> Queue Fanout -> Follower Feeds E2E', () => {
    it('should publish story, fan out via queue, and populate followers personalized feeds', async () => {
      // 1. Set up Author and 2 distinct Readers
      const author = await createE2EUser('author_j1')
      const followerA = await createE2EUser('follower_a')
      const followerB = await createE2EUser('follower_b')
      const nonFollower = await createE2EUser('non_follower')

      // 2. Readers follow the Author via the API endpoint
      const followResA = await app.request(
        `http://localhost/v1/user/${author.username}/follow`,
        { method: 'GET', headers: reqHeaders(followerA.token) },
        mockEnv,
      )
      expect(followResA.status).toBe(200)

      const followResB = await app.request(
        `http://localhost/v1/user/${author.username}/follow`,
        { method: 'GET', headers: reqHeaders(followerB.token) },
        mockEnv,
      )
      expect(followResB.status).toBe(200)

      // 3. Author creates Story and Chapter in DB
      const [createdStory] = await db
        .insert(story)
        .values({
          id: `sty_${createId()}`,
          authorId: author.id,
          title: 'Journey to the Stars',
          description: 'An epic space odyssey',
          contentRating: 'GENERAL',
          language: 'english',
        })
        .returning()

      const [createdChapter] = await db
        .insert(chapter)
        .values({
          id: `chp_${createId()}`,
          storyId: createdStory.id,
          authorId: author.id,
          chapterIndex: 1,
          title: 'Prologue: Departure',
          content: 'The rocket cleared the launch tower...',
        })
        .returning()

      const [publishedActivity] = await db
        .insert(activity)
        .values({
          id: `act_${createId()}`,
          actorId: author.id,
          verb: 'STORY_PUBLISHED',
          storyId: createdStory.id,
          chapterId: createdChapter.id,
        })
        .returning()

      // 4. Author calls the fanout endpoint: POST /v1/feed/fanout
      queuedFanoutMessages.length = 0
      const fanoutRes = await app.request(
        'http://localhost/v1/feed/fanout',
        {
          method: 'POST',
          headers: {
            ...reqHeaders(author.token),
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ activityId: publishedActivity.id }),
        },
        mockEnv,
      )

      expect(fanoutRes.status).toBe(200)
      const fanoutBody = await fanoutRes.json()
      expect(fanoutBody).toEqual({ success: true, queued: true })
      expect(queuedFanoutMessages.length).toBe(1)
      expect(queuedFanoutMessages[0].activityId).toBe(publishedActivity.id)

      // 5. Worker consumes the queue message batch
      const queueBatch: any = {
        queue: 'fancanon-fanout-queue',
        messages: queuedFanoutMessages.map((m, idx) => ({
          id: `msg_e2e_${idx}`,
          timestamp: new Date(),
          body: m,
          attempts: 1,
          ack: vi.fn(),
          retry: vi.fn(),
        })),
      }

      await handleFanoutBatch(queueBatch, mockEnv, {} as any)
      expect(queueBatch.messages[0].ack).toHaveBeenCalled()

      // 6. Verify Follower A's personalized feed contains the published story
      const feedResA = await app.request(
        'http://localhost/v1/feed?page=1&limit=10',
        { method: 'GET', headers: reqHeaders(followerA.token) },
        mockEnv,
      )
      expect(feedResA.status).toBe(200)
      const feedDataA = (await feedResA.json()) as any
      expect(feedDataA.success).toBe(true)
      expect(feedDataA.feed.length).toBeGreaterThanOrEqual(1)
      expect(feedDataA.feed[0].story.id).toBe(createdStory.id)
      expect(feedDataA.feed[0].verb).toBe('STORY_PUBLISHED')

      // 7. Verify Follower B also receives the story in their feed
      const feedResB = await app.request(
        'http://localhost/v1/feed?page=1&limit=10',
        { method: 'GET', headers: reqHeaders(followerB.token) },
        mockEnv,
      )
      expect(feedResB.status).toBe(200)
      const feedDataB = (await feedResB.json()) as any
      expect(feedDataB.feed.some((item: any) => item.story.id === createdStory.id)).toBe(true)

      // 8. Verify Non-Follower's feed is empty
      const feedResNon = await app.request(
        'http://localhost/v1/feed?page=1&limit=10',
        { method: 'GET', headers: reqHeaders(nonFollower.token) },
        mockEnv,
      )
      expect(feedResNon.status).toBe(200)
      const feedDataNon = (await feedResNon.json()) as any
      expect(feedDataNon.feed.length).toBe(0)
    })
  })

  describe('Journey 2: Reader Engagement, Likes, Read-Later & Notifications E2E', () => {
    it('should handle discovery, bookmarking, likes, read-later, and notify author', async () => {
      const author = await createE2EUser('author_j2')
      const reader = await createE2EUser('reader_j2')

      const [testStory] = await db
        .insert(story)
        .values({
          id: `sty_${createId()}`,
          authorId: author.id,
          title: 'The Alchemists Secret',
          description: 'A potion master discovers ancient magic',
          contentRating: 'GENERAL',
          language: 'english',
        })
        .returning()

      const [testChapter] = await db
        .insert(chapter)
        .values({
          id: `chp_${createId()}`,
          storyId: testStory.id,
          authorId: author.id,
          chapterIndex: 1,
          title: 'Chapter 1: The Flask',
          content: 'The brew was shimmering blue...',
        })
        .returning()

      // 1. Reader views story details: GET /v1/stories/:id
      const storyRes = await app.request(
        `http://localhost/v1/stories/${testStory.id}`,
        { method: 'GET', headers: reqHeaders(reader.token) },
        mockEnv,
      )
      expect(storyRes.status).toBe(200)
      const storyData = (await storyRes.json()) as any
      expect(storyData.story.id).toBe(testStory.id)
      expect(storyData.story.likeCount).toBe(0)

      // 2. Reader checks story chapters: GET /v1/stories/:id/chapters
      const chapRes = await app.request(
        `http://localhost/v1/stories/${testStory.id}/chapters`,
        { method: 'GET', headers: reqHeaders(reader.token) },
        mockEnv,
      )
      expect(chapRes.status).toBe(200)
      const chapData = (await chapRes.json()) as any
      expect(chapData.chapters.length).toBe(1)
      expect(chapData.chapters[0].id).toBe(testChapter.id)

      // 3. Reader bookmarks chapter: GET /v1/chapters/:chapterId/bookmark
      const bookmarkRes = await app.request(
        `http://localhost/v1/chapters/${testChapter.id}/bookmark`,
        { method: 'GET', headers: reqHeaders(reader.token) },
        mockEnv,
      )
      expect(bookmarkRes.status).toBe(200)

      // Verify bookmark appears in Reader's bookmarks: GET /v1/user/bookmarks
      const bookmarksListRes = await app.request(
        'http://localhost/v1/user/bookmarks?page=1&limit=10',
        { method: 'GET', headers: reqHeaders(reader.token) },
        mockEnv,
      )
      expect(bookmarksListRes.status).toBe(200)
      const bookmarksData = (await bookmarksListRes.json()) as any
      expect(
        bookmarksData.bookmarks.some((storyItem: any) =>
          storyItem.chapters.some((c: any) => c.id === testChapter.id),
        ),
      ).toBe(true)

      // 4. Reader likes the story: GET /v1/stories/:storyId/like
      const likeRes = await app.request(
        `http://localhost/v1/stories/${testStory.id}/like`,
        { method: 'GET', headers: reqHeaders(reader.token) },
        mockEnv,
      )
      expect(likeRes.status).toBe(200)

      // Verify story likeCount incremented in DB
      const updatedStoryRes = await app.request(
        `http://localhost/v1/stories/${testStory.id}`,
        { method: 'GET', headers: reqHeaders(reader.token) },
        mockEnv,
      )
      const updatedStoryData = (await updatedStoryRes.json()) as any
      expect(updatedStoryData.story.likeCount).toBe(1)

      // Verify story appears in Reader's likes: GET /v1/user/likes
      const userLikesRes = await app.request(
        'http://localhost/v1/user/likes?page=1&limit=10',
        { method: 'GET', headers: reqHeaders(reader.token) },
        mockEnv,
      )
      expect(userLikesRes.status).toBe(200)
      const userLikesData = (await userLikesRes.json()) as any
      expect(userLikesData.stories.some((s: any) => s.id === testStory.id)).toBe(true)

      // 5. Author checks notifications: GET /v1/notifications
      const notifRes = await app.request(
        'http://localhost/v1/notifications?page=1&limit=10',
        { method: 'GET', headers: reqHeaders(author.token) },
        mockEnv,
      )
      expect(notifRes.status).toBe(200)
      const notifData = (await notifRes.json()) as any
      expect(notifData.notifications.length).toBeGreaterThanOrEqual(1)
      expect(notifData.notifications[0].activity.verb).toBe('STORY_LIKED')
      expect(notifData.notifications[0].activity.actor.username).toBe(reader.username)

      // Check notification indicator: GET /v1/notifications/indicator
      const indicatorRes = await app.request(
        'http://localhost/v1/notifications/indicator',
        { method: 'GET', headers: reqHeaders(author.token) },
        mockEnv,
      )
      expect(indicatorRes.status).toBe(200)
      const indicatorData = (await indicatorRes.json()) as any
      expect(indicatorData.success).toBe(true)
      expect(indicatorData.unseenCount).toBeGreaterThanOrEqual(1)

      // Author marks notification as seen: POST /v1/notifications
      const markSeenRes = await app.request(
        'http://localhost/v1/notifications',
        {
          method: 'POST',
          headers: {
            ...reqHeaders(author.token),
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            notificationIds: [notifData.notifications[0].id],
          }),
        },
        mockEnv,
      )
      expect(markSeenRes.status).toBe(200)

      // Indicator unseenCount is now 0
      const indicatorRes2 = await app.request(
        'http://localhost/v1/notifications/indicator',
        { method: 'GET', headers: reqHeaders(author.token) },
        mockEnv,
      )
      const indicatorData2 = (await indicatorRes2.json()) as any
      expect(indicatorData2.unseenCount).toBe(0)

      // 6. Reader saves to read later: GET /v1/stories/:storyId/read-later
      const readLaterRes = await app.request(
        `http://localhost/v1/stories/${testStory.id}/read-later`,
        { method: 'GET', headers: reqHeaders(reader.token) },
        mockEnv,
      )
      expect(readLaterRes.status).toBe(200)

      // Reader removes like and read-later: DELETE endpoints
      const unlikeRes = await app.request(
        `http://localhost/v1/stories/${testStory.id}/like`,
        { method: 'DELETE', headers: reqHeaders(reader.token) },
        mockEnv,
      )
      expect(unlikeRes.status).toBe(200)

      const unReadLaterRes = await app.request(
        `http://localhost/v1/stories/${testStory.id}/read-later`,
        { method: 'DELETE', headers: reqHeaders(reader.token) },
        mockEnv,
      )
      expect(unReadLaterRes.status).toBe(200)

      // Verify counts restored to 0
      const finalStoryRes = await app.request(
        `http://localhost/v1/stories/${testStory.id}`,
        { method: 'GET', headers: reqHeaders(reader.token) },
        mockEnv,
      )
      const finalStoryData = (await finalStoryRes.json()) as any
      expect(finalStoryData.story.likeCount).toBe(0)
      expect(finalStoryData.story.readLaterCount).toBe(0)
    })
  })

  describe('Journey 3: Author Dashboard & Public Profiles E2E', () => {
    it('should retrieve author stories on dashboard and view public profile', async () => {
      const author = await createE2EUser('author_j3')

      await db.insert(story).values({
        id: `sty_${createId()}`,
        authorId: author.id,
        title: 'Chronicles of the Realm',
        description: 'A historical account of dragons',
        contentRating: 'GENERAL',
        language: 'english',
      })

      // Author fetches their dashboard stories: GET /v1/dashboard/stories
      const dashStoriesRes = await app.request(
        'http://localhost/v1/dashboard/stories?page=1&limit=10',
        { method: 'GET', headers: reqHeaders(author.token) },
        mockEnv,
      )
      expect(dashStoriesRes.status).toBe(200)
      const dashData = (await dashStoriesRes.json()) as any
      expect(dashData.stories.length).toBeGreaterThanOrEqual(1)
      expect(dashData.stories[0].title).toBe('Chronicles of the Realm')

      // Public user views author profile: GET /v1/user/:username
      const profileRes = await app.request(
        `http://localhost/v1/user/${author.username}`,
        { method: 'GET', headers: reqHeaders() },
        mockEnv,
      )
      expect(profileRes.status).toBe(200)
      const profileData = (await profileRes.json()) as any
      expect(profileData.user.username).toBe(author.username)

      // Public user views author published stories: GET /v1/user/:username/stories
      const userStoriesRes = await app.request(
        `http://localhost/v1/user/${author.username}/stories?page=1&limit=10`,
        { method: 'GET', headers: reqHeaders() },
        mockEnv,
      )
      expect(userStoriesRes.status).toBe(200)
      const userStoriesData = (await userStoriesRes.json()) as any
      expect(userStoriesData.stories.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('Journey 4: Story Search & Discovery E2E', () => {
    it('should search and discover stories by keywords', async () => {
      const author = await createE2EUser('author_j4')
      const uniqueKeyword = `CyberPhoenix_${createId().slice(0, 6)}`

      await db.insert(story).values({
        id: `sty_${createId()}`,
        authorId: author.id,
        title: `Flight of the ${uniqueKeyword}`,
        description: 'A neon cyberpunk adventure in neo-tokyo',
        contentRating: 'GENERAL',
        language: 'english',
      })

      // Search for story: GET /v1/search?q=...
      const searchRes = await app.request(
        `http://localhost/v1/search?q=${uniqueKeyword}&page=1&limit=10`,
        { method: 'GET', headers: reqHeaders() },
        mockEnv,
      )
      expect(searchRes.status).toBe(200)
      const searchData = (await searchRes.json()) as any
      expect(searchData.success).toBe(true)
      expect(searchData.stories.some((s: any) => s.title.includes(uniqueKeyword))).toBe(true)
    })
  })

  describe('Journey 5: Pre-Deployment Smoke Tests & Security Guardrails', () => {
    it('GET / should return 200 with SVG logo', async () => {
      const res = await app.request('http://localhost/', {}, mockEnv)
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toContain('image/svg+xml')
    })

    it('GET /openapi should return 200 with OpenAPI specification', async () => {
      const res = await app.request('http://localhost/openapi', {}, mockEnv)
      expect(res.status).toBe(200)
      const data = (await res.json()) as any
      expect(data.info.title).toBe('Fancanon API Documentation')
    })

    it('Direct address bar access to /v1/* without Origin should be strictly rejected (403)', async () => {
      const res = await app.request('http://localhost/v1/tags', {}, mockEnv)
      expect(res.status).toBe(403)
    })

    it('Accessing from api.fancanon.com subdomain should be rejected (403)', async () => {
      const res = await app.request(
        'http://localhost/v1/tags',
        { headers: { Origin: 'https://api.fancanon.com' } },
        mockEnv,
      )
      expect(res.status).toBe(403)
    })

    it('CORS preflight OPTIONS on /v1/stories with production origin should cache for 24h', async () => {
      const res = await app.request(
        'http://localhost/v1/stories',
        {
          method: 'OPTIONS',
          headers: {
            Origin: 'https://fancanon.com',
            'Access-Control-Request-Method': 'POST',
          },
        },
        mockEnv,
      )
      expect(res.status).toBe(204)
      expect(res.headers.get('access-control-allow-origin')).toBe('https://fancanon.com')
      expect(res.headers.get('access-control-max-age')).toBe('86400')
    })
  })
})
