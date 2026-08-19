import { eq, sql } from 'drizzle-orm'

import type { Database } from '@/lib/db'
import type { StatsType } from '@/lib/schemas'
import { story } from '@/lib/db/schema'

export async function getAuthorStats(db: Database, authorId: string): Promise<StatsType> {
  const [row] = await db
    .select({
      totalStories: sql<number>`count(*)`.mapWith(Number),
      totalChapters: sql<number>`coalesce(sum(${story.chapterCount}), 0)`.mapWith(Number),
      totalLikes: sql<number>`coalesce(sum(${story.likeCount}), 0)`.mapWith(Number),
      totalViews: sql<number>`coalesce(sum(${story.viewCount}), 0)`.mapWith(Number),
      totalComments: sql<number>`coalesce(sum(${story.commentCount}), 0)`.mapWith(Number),
      totalReadLaters: sql<number>`coalesce(sum(${story.readLaterCount}), 0)`.mapWith(Number),
    })
    .from(story)
    .where(eq(story.authorId, authorId))

  return row
}
