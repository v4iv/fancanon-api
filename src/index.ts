import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { openAPIRouteHandler } from 'hono-openapi'

import { AppContext } from '@/lib/types'
import { uwu } from './lib/assets/uwu'
import { auth } from '@/lib/auth'
import { getHostMatcher } from '@/lib/utils'
import { feed } from '@/routes/v1/feed'
import { search } from '@/routes/v1/search'
import { stories } from '@/routes/v1/stories'
import { chapters } from '@/routes/v1/chapters'
import { comments } from '@/routes/v1/comments'
import { analytics } from '@/routes/v1/analytics'
import { dashboard } from '@/routes/v1/dashboard'
import { notifications } from '@/routes/v1/notifications'

const app = new Hono<AppContext>()

// cors
app.use('*', async (c, next) => {
  const isAllowedHost = getHostMatcher(c.env?.ALLOWED_HOSTS ?? '')

  const corsMiddlewareHandler = cors({
    origin: (origin) => {
      if (!origin) return null
      if (origin.startsWith('http://localhost:')) return origin
      if (isAllowedHost(origin)) return origin
      return null
    },
    credentials: true,
  })

  return corsMiddlewareHandler(c, next)
})

// session & user middleware
app.use('*', async (c, next) => {
  const session = await auth(c.env).api.getSession({
    headers: c.req.raw.headers,
  })

  if (!session) {
    c.set('user', null)
    c.set('session', null)
    await next()
    return
  }

  c.set('user', session.user)
  c.set('session', session.session)

  await next()
})

// better-auth route handler
app.on(['GET', 'POST'], '/api/auth/*', (c) => {
  return auth(c.env).handler(c.req.raw)
})

// home
app.get('/', (c) => {
  return c.body(uwu, 200, {
    'Content-Type': 'image/svg+xml',
    'Cache-Control': 'public, max-age=3600',
  })
})

// OpenAPI spec to be consumed by Scalar/Swagger
app.get(
  '/openapi',
  openAPIRouteHandler(app, {
    documentation: {
      info: {
        title: 'Fancanon API Documentation',
        version: '1.0.0',
        description: 'API documentation for Fancanon',
      },
      servers: [
        { url: 'http://localhost:8787', description: 'Local Server' },
        { url: 'https://api.fancanon.com', description: 'Production Server' },
      ],
    },
  }),
)

// routes
app.route('/v1/feed', feed)
app.route('/v1/search', search)
app.route('/v1/stories', stories)
app.route('/v1/chapters', chapters)
app.route('/v1/comments', comments)
app.route('/v1/analytics', analytics)
app.route('/v1/dashboard', dashboard)
app.route('/v1/notifications', notifications)

export default app
