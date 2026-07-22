import type { Context, Next } from "hono";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

function withDatabase(c: Context, next: Next) {
  const databaseUrl = c.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set");
  }

  const adapter = new PrismaPg({
    connectionString: databaseUrl,
  });

  const db = new PrismaClient({ adapter });

  if (!c.get("db")) {
    c.set("db", db);
  }

  return next();
}

export default withDatabase;
