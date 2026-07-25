import { Hono } from "hono";

import { AppContext } from "@/lib/types";
import { feed } from "@/routes/feed";
import { tags } from "@/routes/tags";
import { fandoms } from "@/routes/fandoms";

const app = new Hono<AppContext>();

app.get("/", (c) => {
  return c.text("Hello fancanon! 🍀");
});

// routes
app.route("/api/feed", feed);
app.route("/api/tags", tags);
app.route("/api/fandoms", fandoms);

export default app;
