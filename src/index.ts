import { Hono } from "hono";

import { AppContext } from "@/lib/types";
import { auth } from "@/lib/auth";
import { tags } from "@/routes/tags";
import { feed } from "@/routes/feed";
import { search } from "@/routes/search";
import { stories } from "@/routes/stories";
import { fandoms } from "@/routes/fandoms";

const app = new Hono<AppContext>();

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
