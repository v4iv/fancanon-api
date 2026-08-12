import type { Context, Next } from "hono";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/lib/db/schema";

function withDatabase(c: Context, next: Next) {
  const databaseUrl = c.env.HYPERDRIVE.connectionString;

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set");
  }

  const client = postgres(databaseUrl);

  const db = drizzle(client, { schema });

  if (!c.get("db")) {
    c.set("db", db);
  }

  return next();
}

export { withDatabase };
