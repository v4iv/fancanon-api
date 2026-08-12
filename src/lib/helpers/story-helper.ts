import { eq } from "drizzle-orm";

import { like, readLater } from "@/lib/db/schema";

/**
 * Canonical `with` shape for hydrating a story into the app's `StoryType`
 * (author, tags, fandoms, and the current user's like/readLater rows).
 * Reuse this anywhere a full story needs hydrating instead of re-declaring
 * the object inline — currently duplicated in the trending route, worth
 * swapping that over to this too.
 */
export function storyWithForUser(userId: string) {
  return {
    author: { columns: { id: true, name: true, username: true, image: true } },
    tags: {
      columns: {},
      with: {
        tag: { columns: { id: true, name: true, slug: true, type: true } },
      },
    },
    fandoms: {
      columns: {},
      with: { fandom: { columns: { id: true, name: true, slug: true } } },
    },
    likes: {
      where: eq(like.userId, userId),
      columns: { userId: true, storyId: true },
    },
    readLaters: {
      where: eq(readLater.userId, userId),
      columns: { userId: true, storyId: true },
    },
  };
}
