import { Hono } from "hono";
import { cors } from "hono/cors";

import { AppContext } from "@/lib/types";
import { auth } from "@/lib/auth";
import { tags } from "@/routes/tags";
import { feed } from "@/routes/feed";
import { search } from "@/routes/search";
import { stories } from "@/routes/stories";
import { fandoms } from "@/routes/fandoms";

const app = new Hono<AppContext>();

app.use("*", async (c, next) => {
  const trustedOrigins = c.env.TRUSTED_ORIGINS;

  const corsMiddlewareHandler = cors({
    origin: trustedOrigins.split(","),
  });

  return corsMiddlewareHandler(c, next);
});

app.use("*", async (c, next) => {
  const session = await auth(c.env).api.getSession({
    headers: c.req.raw.headers,
  });

  if (!session) {
    c.set("user", null);
    c.set("session", null);
    await next();
    return;
  }

  c.set("user", session.user);
  c.set("session", session.session);

  await next();
});

app.on(["GET", "POST"], "/api/auth/*", (c) => {
  return auth(c.env).handler(c.req.raw);
});

app.get("/", (c) => {
  return c.text("🍀 fancanon 🍀");
});

// routes
app.route("/api/tags", tags);
app.route("/api/feed", feed);
app.route("/api/search", search);
app.route("/api/stories", stories);
app.route("/api/fandoms", fandoms);

export default app;
