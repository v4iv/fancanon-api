import { Hono } from "hono";

import { feed } from "@/routes/feed";
import { AppContext } from "@/lib/types";

const app = new Hono<AppContext>();

app.get("/", (c) => {
  return c.text("Hello fancanon! 🍀");
});

// routes
app.route("/api/feed", feed);

export default app;
