import { PrismaPg } from "@prisma/adapter-pg";
import { username } from "better-auth/plugins";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { betterAuth, type BetterAuthOptions } from "better-auth/minimal";

import { RESTRICTED_USERNAMES } from "@/lib/constants";
import { PrismaClient } from "@/generated/prisma/client";

const options = {
  // Additional options that depend on env ...
  emailAndPassword: {
    enabled: true,
  },
  plugins: [
    username({
      usernameValidator: (username) => {
        const normalized = username.trim().toLowerCase();

        return (
          !RESTRICTED_USERNAMES.some(
            (restricted) =>
              normalized === restricted ||
              normalized.startsWith(restricted) ||
              normalized.endsWith(restricted),
          ) && /^[a-zA-Z0-9_.]+$/.test(username)
        );
      },
    }),
  ],
} satisfies BetterAuthOptions;

/**
 * Better Auth Instance
 */
export const auth = (
  env: CloudflareBindings,
): ReturnType<typeof betterAuth<any>> => {
  const databaseUrl = env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set");
  }

  const adapter = new PrismaPg({
    connectionString: databaseUrl!,
  });

  const prisma = new PrismaClient({ adapter });

  return betterAuth({
    appName: "fancanon",
    database: prismaAdapter(prisma, { provider: "postgresql" }),
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    ...options,
  });
};
