import { describe, expect, it, beforeEach, vi } from 'vitest'

// Mock state
let currentMockSession: {
  user: { id: string; email?: string; username?: string }
  session: { id: string; userId: string }
} | null = null

const mockDb = {
  query: {
    activity: {
      findFirst: vi.fn(),
    },
    feedItem: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    notification: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    story: {
      findFirst: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
    },
  },
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  insert: vi.fn().mockReturnThis(),
  values: vi.fn().mockReturnThis(),
  returning: vi.fn().mockResolvedValue([]),
  delete: vi.fn().mockReturnThis(),
  update: vi.fn().mockReturnThis(),
  set: vi.fn().mockReturnThis(),
}

// Hoisted mocks for auth and database
vi.mock('@/lib/auth', () => ({
  auth: vi.fn(() => ({
    api: {
      getSession: vi.fn(async () => currentMockSession),
    },
    handler: vi.fn(async () => new Response('auth handler ok', { status: 200 })),
  })),
}))

vi.mock('@/lib/db', () => ({
  createDb: vi.fn(() => mockDb),
  withDatabase: vi.fn(async (c, next) => {
    c.set('db', mockDb)
    return next()
  }),
}))

// Import the Hono app after mocks
import { app } from '@/index'

describe('Phase 2: Route & Middleware Integration Tests', () => {
  const mockQueue = {
    send: vi.fn().mockResolvedValue(undefined),
  }

  const mockEnv: any = {
    SENTRY_DSN: 'https://public@sentry.example.com/1',
    ALLOWED_HOSTS: 'fancanon.com,*.netlify.app,fancanon.waybove.workers.dev',
    ORIGIN: 'https://fancanon.com',
    COOKIE_DOMAIN: '.fancanon.com',
    BETTER_AUTH_SECRET: 'test-secret-at-least-32-characters-long',
    FANOUT_QUEUE: mockQueue,
    HYPERDRIVE: { connectionString: 'postgres://localhost:5432/mock' },
    UPSTASH_REDIS_REST_URL: 'https://mock.upstash.io',
    UPSTASH_REDIS_REST_TOKEN: 'mock-redis-token',
  }

  beforeEach(() => {
    vi.clearAllMocks()
    currentMockSession = null
  })

  describe('1. Public Routes & Documentation', () => {
    it('GET / should return 200 OK with SVG logo', async () => {
      const res = await app.request('http://localhost/', {}, mockEnv)
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toContain('image/svg+xml')
      const body = await res.text()
      expect(body).toContain('<svg')
    })

    it('GET /openapi should return 200 OK with OpenAPI specification', async () => {
      const res = await app.request('http://localhost/openapi', {}, mockEnv)
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toContain('application/json')
      const data = (await res.json()) as any
      expect(data).toHaveProperty('openapi')
      expect(data).toHaveProperty('info')
      expect(data.info.title).toBe('Fancanon API Documentation')
    })

    it('GET /api/auth/* should bypass /v1/* strict origin guard', async () => {
      // Direct browser navigation to auth (e.g. OAuth callback) has no Origin header
      const res = await app.request('http://localhost/api/auth/session', {}, mockEnv)
      expect(res.status).toBe(200)
      const text = await res.text()
      expect(text).toBe('auth handler ok')
    })
  })

  describe('2. CORS & Strict Origin Guard (/v1/*)', () => {
    it('should return 403 Forbidden for direct requests without Origin header', async () => {
      const res = await app.request('http://localhost/v1/tags', {}, mockEnv)
      expect(res.status).toBe(403)
      const data = await res.json()
      expect(data).toEqual({ success: false, message: 'Forbidden: Access denied' })
    })

    it('should return 403 Forbidden when accessed from its own api.fancanon.com subdomain', async () => {
      const res = await app.request(
        'http://localhost/v1/tags',
        {
          headers: { Origin: 'https://api.fancanon.com' },
        },
        mockEnv,
      )
      expect(res.status).toBe(403)
      const data = await res.json()
      expect(data).toEqual({ success: false, message: 'Forbidden: Access denied' })
    })

    it('should return 403 Forbidden for unauthorized third-party origins', async () => {
      const res = await app.request(
        'http://localhost/v1/tags',
        {
          headers: { Origin: 'https://evil.attacker.com' },
        },
        mockEnv,
      )
      expect(res.status).toBe(403)
      const data = await res.json()
      expect(data).toEqual({ success: false, message: 'Forbidden: Access denied' })
    })

    it('should allow requests from production fancanon.com', async () => {
      const res = await app.request(
        'http://localhost/v1/tags',
        {
          headers: { Origin: 'https://fancanon.com' },
        },
        mockEnv,
      )
      expect(res.status).not.toBe(403)
    })

    it('should allow requests from Netlify preview deploys (*.netlify.app)', async () => {
      const res = await app.request(
        'http://localhost/v1/tags',
        {
          headers: { Origin: 'https://deploy-preview-123--fancanon.netlify.app' },
        },
        mockEnv,
      )
      expect(res.status).not.toBe(403)
    })

    it('should allow requests from fancanon.waybove.workers.dev', async () => {
      const res = await app.request(
        'http://localhost/v1/tags',
        {
          headers: { Origin: 'https://fancanon.waybove.workers.dev' },
        },
        mockEnv,
      )
      expect(res.status).not.toBe(403)
    })

    it('should allow requests from localhost during development', async () => {
      const res5173 = await app.request(
        'http://localhost/v1/tags',
        {
          headers: { Origin: 'http://localhost:5173' },
        },
        mockEnv,
      )
      expect(res5173.status).not.toBe(403)

      const res3000 = await app.request(
        'http://localhost/v1/tags',
        {
          headers: { Origin: 'http://localhost:3000' },
        },
        mockEnv,
      )
      expect(res3000.status).not.toBe(403)
    })

    it('should handle CORS preflight OPTIONS with 204 and caching headers for allowed origins', async () => {
      const res = await app.request(
        'http://localhost/v1/stories',
        {
          method: 'OPTIONS',
          headers: {
            Origin: 'https://fancanon.com',
            'Access-Control-Request-Method': 'POST',
            'Access-Control-Request-Headers': 'Content-Type',
          },
        },
        mockEnv,
      )
      expect(res.status).toBe(204)
      expect(res.headers.get('access-control-allow-origin')).toBe('https://fancanon.com')
      expect(res.headers.get('access-control-allow-credentials')).toBe('true')
      expect(res.headers.get('access-control-max-age')).toBe('86400')
    })

    it('should not set Access-Control-Allow-Origin on OPTIONS for disallowed origins', async () => {
      const res = await app.request(
        'http://localhost/v1/stories',
        {
          method: 'OPTIONS',
          headers: {
            Origin: 'https://attacker.org',
            'Access-Control-Request-Method': 'POST',
          },
        },
        mockEnv,
      )
      expect(res.status).toBe(204)
      expect(res.headers.get('access-control-allow-origin')).toBeNull()
    })
  })

  describe('3. Auth Gate Verification (Unauthenticated Requests -> 401)', () => {
    const originHeader = { Origin: 'https://fancanon.com' }

    it('GET /v1/feed should return 401 when not logged in', async () => {
      const res = await app.request(
        'http://localhost/v1/feed',
        {
          method: 'GET',
          headers: originHeader,
        },
        mockEnv,
      )
      expect(res.status).toBe(401)
      const data = await res.json()
      expect(data).toHaveProperty('success', false)
    })

    it('POST /v1/feed/fanout should return 401 when not logged in', async () => {
      const res = await app.request(
        'http://localhost/v1/feed/fanout',
        {
          method: 'POST',
          headers: {
            ...originHeader,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ activityId: 'act_test_123' }),
        },
        mockEnv,
      )
      expect(res.status).toBe(401)
      const data = await res.json()
      expect(data).toHaveProperty('success', false)
    })

    it('GET /v1/notifications should return 401 when not logged in', async () => {
      const res = await app.request(
        'http://localhost/v1/notifications',
        {
          method: 'GET',
          headers: originHeader,
        },
        mockEnv,
      )
      expect(res.status).toBe(401)
      const data = await res.json()
      expect(data).toHaveProperty('success', false)
    })

    it('GET /v1/stories/:storyId/like should return 401 when not logged in', async () => {
      const res = await app.request(
        'http://localhost/v1/stories/story-xyz/like',
        {
          method: 'GET',
          headers: originHeader,
        },
        mockEnv,
      )
      expect(res.status).toBe(401)
    })

    it('DELETE /v1/stories/:storyId/like should return 401 when not logged in', async () => {
      const res = await app.request(
        'http://localhost/v1/stories/story-xyz/like',
        {
          method: 'DELETE',
          headers: originHeader,
        },
        mockEnv,
      )
      expect(res.status).toBe(401)
    })

    it('GET /v1/stories/:storyId/read-later should return 401 when not logged in', async () => {
      const res = await app.request(
        'http://localhost/v1/stories/story-xyz/read-later',
        {
          method: 'GET',
          headers: originHeader,
        },
        mockEnv,
      )
      expect(res.status).toBe(401)
    })

    it('DELETE /v1/stories/:storyId/read-later should return 401 when not logged in', async () => {
      const res = await app.request(
        'http://localhost/v1/stories/story-xyz/read-later',
        {
          method: 'DELETE',
          headers: originHeader,
        },
        mockEnv,
      )
      expect(res.status).toBe(401)
    })

    it('GET /v1/history should return 401 when not logged in', async () => {
      const res = await app.request(
        'http://localhost/v1/history',
        {
          method: 'GET',
          headers: originHeader,
        },
        mockEnv,
      )
      expect(res.status).toBe(401)
    })

    it('GET /v1/dashboard/stories should return 401 when not logged in', async () => {
      const res = await app.request(
        'http://localhost/v1/dashboard/stories',
        {
          method: 'GET',
          headers: originHeader,
        },
        mockEnv,
      )
      expect(res.status).toBe(401)
    })

    it('DELETE /v1/comments/:commentId should return 401 when not logged in', async () => {
      const res = await app.request(
        'http://localhost/v1/comments/comm-123',
        {
          method: 'DELETE',
          headers: originHeader,
        },
        mockEnv,
      )
      expect(res.status).toBe(401)
    })

    it('GET /v1/comments/:commentId/like should return 401 when not logged in', async () => {
      const res = await app.request(
        'http://localhost/v1/comments/comm-123/like',
        {
          method: 'GET',
          headers: originHeader,
        },
        mockEnv,
      )
      expect(res.status).toBe(401)
    })

    it('GET /v1/chapters/:chapterId/bookmark should return 401 when not logged in', async () => {
      const res = await app.request(
        'http://localhost/v1/chapters/chap-123/bookmark',
        {
          method: 'GET',
          headers: originHeader,
        },
        mockEnv,
      )
      expect(res.status).toBe(401)
    })

    it('DELETE /v1/chapters/:chapterId/bookmark should return 401 when not logged in', async () => {
      const res = await app.request(
        'http://localhost/v1/chapters/chap-123/bookmark',
        {
          method: 'DELETE',
          headers: originHeader,
        },
        mockEnv,
      )
      expect(res.status).toBe(401)
    })

    it('DELETE /v1/chapters/:chapterId should return 401 when not logged in', async () => {
      const res = await app.request(
        'http://localhost/v1/chapters/chap-123',
        {
          method: 'DELETE',
          headers: originHeader,
        },
        mockEnv,
      )
      expect(res.status).toBe(401)
    })
  })

  describe('4. Fanout Endpoint Integration & Business Logic', () => {
    const originHeader = {
      Origin: 'https://fancanon.com',
      'Content-Type': 'application/json',
    }

    it('should return 400 Bad Request if activityId is missing or empty', async () => {
      currentMockSession = {
        user: { id: 'user_author_1', username: 'author1' },
        session: { id: 'sess_1', userId: 'user_author_1' },
      }

      const res = await app.request(
        'http://localhost/v1/feed/fanout',
        {
          method: 'POST',
          headers: originHeader,
          body: JSON.stringify({}),
        },
        mockEnv,
      )
      expect(res.status).toBe(400)
    })

    it('should return 404 Not Found if activity does not exist', async () => {
      currentMockSession = {
        user: { id: 'user_author_1', username: 'author1' },
        session: { id: 'sess_1', userId: 'user_author_1' },
      }

      mockDb.query.activity.findFirst.mockResolvedValueOnce(null)

      const res = await app.request(
        'http://localhost/v1/feed/fanout',
        {
          method: 'POST',
          headers: originHeader,
          body: JSON.stringify({ activityId: 'act_nonexistent' }),
        },
        mockEnv,
      )

      expect(res.status).toBe(404)
      const data = await res.json()
      expect(data).toEqual({ success: false, queued: false, message: 'Activity not found' })
    })

    it('should return 403 Forbidden if activity actorId does not match authenticated user', async () => {
      currentMockSession = {
        user: { id: 'user_impostor', username: 'impostor' },
        session: { id: 'sess_2', userId: 'user_impostor' },
      }

      mockDb.query.activity.findFirst.mockResolvedValueOnce({
        id: 'act_100',
        actorId: 'user_real_author',
      })

      const res = await app.request(
        'http://localhost/v1/feed/fanout',
        {
          method: 'POST',
          headers: originHeader,
          body: JSON.stringify({ activityId: 'act_100' }),
        },
        mockEnv,
      )

      expect(res.status).toBe(403)
      const data = await res.json()
      expect(data).toEqual({ success: false, queued: false, message: 'Forbidden' })
      expect(mockQueue.send).not.toHaveBeenCalled()
    })

    it('should enqueue fanout task and return 200 OK when owned by authenticated author', async () => {
      currentMockSession = {
        user: { id: 'user_real_author', username: 'realauthor' },
        session: { id: 'sess_3', userId: 'user_real_author' },
      }

      mockDb.query.activity.findFirst.mockResolvedValueOnce({
        id: 'act_100',
        actorId: 'user_real_author',
      })

      const res = await app.request(
        'http://localhost/v1/feed/fanout',
        {
          method: 'POST',
          headers: originHeader,
          body: JSON.stringify({ activityId: 'act_100' }),
        },
        mockEnv,
      )

      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data).toEqual({ success: true, queued: true })
      expect(mockQueue.send).toHaveBeenCalledTimes(1)
      expect(mockQueue.send).toHaveBeenCalledWith({
        activityId: 'act_100',
      })
    })
  })
})
