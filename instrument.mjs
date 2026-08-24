import * as Sentry from '@sentry/hono/node'
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  dataCollection: {
    // To disable sending user data and HTTP bodies, uncomment the lines below. For more info visit:
    // https://docs.sentry.io/platforms/javascript/guides/hono/configuration/options/#dataCollection
    // userInfo: false,
    // httpBodies: [],
  },

  // Set tracesSampleRate to 1.0 to capture 100%
  // of spans for tracing.
  tracesSampleRate: 1.0,
})
