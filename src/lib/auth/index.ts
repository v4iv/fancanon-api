import postgres from 'postgres'
import { username } from 'better-auth/plugins'
import { drizzle } from 'drizzle-orm/postgres-js'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { betterAuth, type BetterAuthOptions } from 'better-auth/minimal'

import { RESTRICTED_USERNAMES } from '@/lib/constants'
import * as schema from '@/lib/db/schema'

const options = {
  experimental: { joins: true },
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    sendResetPassword: async ({ url, user }) => {
      console.log('\nReset Password Link: ', user, url)
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    sendOnSignIn: true,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      console.log('\nConfirm Your Email Link: ', user, url)
    },
  },
  // additional fields for user
  user: {
    additionalFields: {
      explicitConsentAt: {
        type: 'date',
        required: false,
        defaultValue: null,
      },
      explicitConsentVersion: {
        type: 'number',
        required: false,
        defaultValue: null,
      },
    },
  },
  plugins: [
    username({
      usernameValidator: (username) => {
        const normalized = username.trim().toLowerCase()

        return (
          !RESTRICTED_USERNAMES.some(
            (restricted) =>
              normalized === restricted ||
              normalized.startsWith(restricted) ||
              normalized.endsWith(restricted),
          ) && /^[a-zA-Z0-9_.]+$/.test(username)
        )
      },
    }),
  ],
} satisfies BetterAuthOptions

/**
 * Better Auth Instance
 */
export const auth = (env: CloudflareBindings): ReturnType<typeof betterAuth<any>> => {
  const databaseUrl = env.HYPERDRIVE.connectionString
  const allowedHosts = env.ALLOWED_HOSTS.split(',')

  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set')
  }

  const client = postgres(databaseUrl)

  const db = drizzle(client, { schema })
  return betterAuth({
    appName: 'fancanon',
    baseURL: {
      allowedHosts,
      // protocol: dev ? "http" : "https",
      fallback: env.ORIGIN,
    },
    secret: env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(db, { provider: 'pg' }),
    advanced: {
      cookiePrefix: 'fancanon',
      crossSubDomainCookies: {
        enabled: true,
        domain: env.COOKIE_DOMAIN,
      },
      defaultCookieAttributes: {
        sameSite: 'none',
        secure: true,
        httpOnly: true,
        domain: env.COOKIE_DOMAIN,
      },
    },
    socialProviders: {
      google: {
        prompt: 'select_account consent',
        clientId: env.GOOGLE_CLIENT_ID as string,
        clientSecret: env.GOOGLE_CLIENT_SECRET as string,
        accessType: 'offline',
        // Optional: Map or manipulate incoming Google profile fields
        mapProfileToUser: async (profile: any) => {
          return {
            // Generates a tentative username from their Google email handle
            username: profile.email.split('@')[0],
          }
        },
      },
    },

    ...options,
  })
}
