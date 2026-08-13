import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { openAPIRouteHandler } from 'hono-openapi'

import { AppContext } from '@/lib/types'
import { auth } from '@/lib/auth'
import { createHostMatcher } from '@/lib/utils'
import { feed } from '@/routes/v1/feed'
import { stories } from '@/routes/v1/stories'

const app = new Hono<AppContext>()

// cors
app.use('*', async (c, next) => {
  const allowedHosts = c.env.ALLOWED_HOSTS || ''
  const isAllowedHost = createHostMatcher(allowedHosts)

  const corsMiddlewareHandler = cors({
    origin: (origin) => {
      // Allow non-browser calls (like cURL, Postman) which have no origin
      if (!origin) return null

      if (origin.startsWith('http://localhost:')) {
        return origin
      }
      if (isAllowedHost(origin)) {
        return origin
      }
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
  return c.text('🍀')
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
app.route('/v1/stories', stories)

export default app
