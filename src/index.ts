import { Hono } from "hono";
import { cors } from "hono/cors";

import { AppContext } from "@/lib/types";
import { auth } from "@/lib/auth";
import { feed } from "@/routes/feed";

const app = new Hono<AppContext>();

app.use("*", async (c, next) => {
  const allowedHosts = c.env.ALLOWED_HOSTS;

  const corsMiddlewareHandler = cors({
    origin: allowedHosts.split(","),
    credentials: true,
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
app.route("/api/feed", feed);

export default app;
