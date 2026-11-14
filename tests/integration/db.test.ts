import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'

import * as schema from '@/lib/db/schema'
import {
  activity,
  bookmark,
  chapter,
  comment,
  commentLike,
  feedItem,
  follow,
  like,
  readLater,
  story,
  storyTag,
  tag,
  user,
} from '@/lib/db/schema'
import { fanoutActivity, getRankedStories } from '@/lib/helpers/feed-helper'

const DATABASE_URL =
  process.env.DATABASE_URL || 'postgres://root:mysecretpassword@localhost:5432/local'

const isPostgresAvailable = await (async () => {
  try {
    const probeClient = postgres(DATABASE_URL, { connect_timeout: 1, max: 1 })
    await probeClient`SELECT 1`
    await probeClient.end()
    return true
  } catch {
    return false
  }
})()

describe.skipIf(!isPostgresAvailable)(
  'Phase 3: Database & Transaction Integrity Tests (Local Postgres)',
  () => {
    let client: postgres.Sql
    let db: ReturnType<typeof drizzle<typeof schema>>
    const trackedUserIds: string[] = []
    const trackedTagIds: string[] = []

    // Helper to create isolated test users
    async function createTestUser(namePrefix = 'test_user') {
      const id = `usr_${createId()}`
      const email = `${id}@test-fancanon.local`
      const username = `u_${createId().slice(0, 12)}`

      const [created] = await db
        .insert(user)
        .values({
          id,
          name: `${namePrefix}_${username}`,
          email,
          username,
          emailVerified: true,
        })
        .returning()

      trackedUserIds.push(created.id)
      return created
    }

    // Helper to create a test story
    async function createTestStory(
      authorId: string,
      overrides?: Partial<typeof story.$inferInsert>,
    ) {
      const id = `sty_${createId()}`
      const [created] = await db
        .insert(story)
        .values({
          id,
          authorId,
          title: overrides?.title ?? `Story ${id}`,
          description: overrides?.description ?? `Description for story ${id}`,
          contentRating: overrides?.contentRating ?? 'GENERAL',
          language: overrides?.language ?? 'english',
          completed: overrides?.completed ?? false,
          likeCount: overrides?.likeCount ?? 0,
          readLaterCount: overrides?.readLaterCount ?? 0,
          commentCount: overrides?.commentCount ?? 0,
          chapterCount: overrides?.chapterCount ?? 0,
          wordCount: overrides?.wordCount ?? 0,
          createdAt: overrides?.createdAt,
        })
        .returning()

      return created
    }

    // Helper to create a test chapter
    async function createTestChapter(
      storyId: string,
      authorId: string,
      chapterIndex: number,
      overrides?: Partial<typeof chapter.$inferInsert>,
    ) {
      const id = `chp_${createId()}`
      const [created] = await db
        .insert(chapter)
        .values({
          id,
          storyId,
          authorId,
          chapterIndex,
          title: overrides?.title ?? `Chapter ${chapterIndex}`,
          content: overrides?.content ?? `Content for chapter ${chapterIndex}`,
          viewCount: overrides?.viewCount ?? 0,
        })
        .returning()

      return created
    }

    // Helper to create a test tag
    async function createTestTag(namePrefix = 'tag') {
      const id = `tag_${createId()}`
      const name = `${namePrefix}_${createId().slice(0, 8)}`
      const [created] = await db
        .insert(tag)
        .values({
          id,
          name,
          slug: name.toLowerCase(),
          type: 'FREEFORM',
        })
        .returning()

      trackedTagIds.push(created.id)
      return created
    }

    beforeAll(async () => {
      client = postgres(DATABASE_URL, { max: 15 })
      db = drizzle(client, { schema })
    })

    afterAll(async () => {
      // Cascade-clean all tracked test users and tags
      if (trackedUserIds.length > 0) {
        await db.delete(user).where(inArray(user.id, trackedUserIds))
      }
      if (trackedTagIds.length > 0) {
        await db.delete(tag).where(inArray(tag.id, trackedTagIds))
      }
      await client.end()
    })

    describe('1. Foreign Key Cascades & Referential Integrity', () => {
      it('deleting a user should cascade and remove their stories, chapters, comments, likes, and activities', async () => {
        const author = await createTestUser('author')
        const reader = await createTestUser('reader')

        const testStory = await createTestStory(author.id)
        const testChapter = await createTestChapter(testStory.id, author.id, 1)

        // Reader likes the story and bookmarks the chapter
        await db.insert(like).values({ userId: reader.id, storyId: testStory.id })
        await db.insert(bookmark).values({ userId: reader.id, chapterId: testChapter.id })

        // Reader comments on the chapter
        const [testComment] = await db
          .insert(comment)
          .values({
            id: `cm_${createId()}`,
            authorId: reader.id,
            chapterId: testChapter.id,
            content: 'Amazing story!',
          })
          .returning()

        // Activity created for the story
        const [testActivity] = await db
          .insert(activity)
          .values({
            id: `act_${createId()}`,
            actorId: author.id,
            verb: 'STORY_PUBLISHED',
            storyId: testStory.id,
          })
          .returning()

        // Delete the author
        await db.delete(user).where(eq(user.id, author.id))

        // Verify cascade: story, chapter, comment, bookmark, and activity are deleted
        const storyResult = await db.query.story.findFirst({
          where: eq(story.id, testStory.id),
        })
        expect(storyResult).toBeUndefined()

        const chapterResult = await db.query.chapter.findFirst({
          where: eq(chapter.id, testChapter.id),
        })
        expect(chapterResult).toBeUndefined()

        const commentResult = await db.query.comment.findFirst({
          where: eq(comment.id, testComment.id),
        })
        expect(commentResult).toBeUndefined()

        const likeResult = await db.query.like.findFirst({
          where: and(eq(like.userId, reader.id), eq(like.storyId, testStory.id)),
        })
        expect(likeResult).toBeUndefined()

        const activityResult = await db.query.activity.findFirst({
          where: eq(activity.id, testActivity.id),
        })
        expect(activityResult).toBeUndefined()

        // Reader user still exists
        const readerResult = await db.query.user.findFirst({
          where: eq(user.id, reader.id),
        })
        expect(readerResult).toBeDefined()
      })

      it('deleting a story should cascade to chapters, story_tags, likes, and read_later without deleting the tag or author', async () => {
        const author = await createTestUser('author')
        const reader = await createTestUser('reader')
        const testTag = await createTestTag('fantasy')

        const testStory = await createTestStory(author.id)
        const chap1 = await createTestChapter(testStory.id, author.id, 1)
        const chap2 = await createTestChapter(testStory.id, author.id, 2)

        await db.insert(storyTag).values({ storyId: testStory.id, tagId: testTag.id })
        await db.insert(like).values({ userId: reader.id, storyId: testStory.id })
        await db.insert(readLater).values({ userId: reader.id, storyId: testStory.id })

        // Delete the story
        await db.delete(story).where(eq(story.id, testStory.id))

        // Chapters must be cascaded
        const chaptersRemaining = await db.query.chapter.findMany({
          where: inArray(chapter.id, [chap1.id, chap2.id]),
        })
        expect(chaptersRemaining.length).toBe(0)

        // Story-Tag join record must be cascaded
        const storyTagRemaining = await db
          .select()
          .from(storyTag)
          .where(eq(storyTag.storyId, testStory.id))
        expect(storyTagRemaining.length).toBe(0)

        // Like and ReadLater must be cascaded
        const likeRemaining = await db.query.like.findFirst({
          where: eq(like.storyId, testStory.id),
        })
        expect(likeRemaining).toBeUndefined()

        const readLaterRemaining = await db.query.readLater.findFirst({
          where: eq(readLater.storyId, testStory.id),
        })
        expect(readLaterRemaining).toBeUndefined()

        // The tag itself and the author must remain untouched
        const tagRemaining = await db.query.tag.findFirst({
          where: eq(tag.id, testTag.id),
        })
        expect(tagRemaining).toBeDefined()

        const authorRemaining = await db.query.user.findFirst({
          where: eq(user.id, author.id),
        })
        expect(authorRemaining).toBeDefined()
      })

      it('deleting a parent comment should cascade to child replies and comment likes', async () => {
        const author = await createTestUser('author')
        const userA = await createTestUser('commenter_a')
        const userB = await createTestUser('commenter_b')

        const testStory = await createTestStory(author.id)
        const testChapter = await createTestChapter(testStory.id, author.id, 1)

        // Parent comment
        const [parent] = await db
          .insert(comment)
          .values({
            id: `cm_${createId()}`,
            authorId: userA.id,
            chapterId: testChapter.id,
            content: 'Parent comment',
          })
          .returning()

        // Child reply referencing parent.id
        const [reply] = await db
          .insert(comment)
          .values({
            id: `cm_${createId()}`,
            authorId: userB.id,
            chapterId: testChapter.id,
            parentId: parent.id,
            content: 'Child reply',
          })
          .returning()

        // Like on parent comment
        await db.insert(commentLike).values({ userId: userB.id, commentId: parent.id })

        // Delete parent comment
        await db.delete(comment).where(eq(comment.id, parent.id))

        // Reply and commentLike should be removed
        const replyRemaining = await db.query.comment.findFirst({
          where: eq(comment.id, reply.id),
        })
        expect(replyRemaining).toBeUndefined()

        const likeRemaining = await db
          .select()
          .from(commentLike)
          .where(eq(commentLike.commentId, parent.id))
        expect(likeRemaining.length).toBe(0)
      })
    })

    describe('2. Unique Constraints & Index Enforcement', () => {
      it('should reject duplicate (storyId, chapterIndex) with unique constraint violation', async () => {
        const author = await createTestUser('author')
        const testStory = await createTestStory(author.id)

        await createTestChapter(testStory.id, author.id, 1)

        // Attempting to insert chapterIndex 1 again must throw unique constraint error (Postgres 23505)
        await expect(
          db.insert(chapter).values({
            id: `chp_${createId()}`,
            storyId: testStory.id,
            authorId: author.id,
            chapterIndex: 1,
            title: 'Duplicate Index Chapter',
            content: 'This should fail',
          }),
        ).rejects.toThrow()

        try {
          await db.insert(chapter).values({
            id: `chp_${createId()}`,
            storyId: testStory.id,
            authorId: author.id,
            chapterIndex: 1,
            title: 'Duplicate Index Chapter',
            content: 'This should fail',
          })
          expect.unreachable()
        } catch (err: any) {
          const errorMsg = `${err.message} ${err.cause?.message || ''} ${err.cause?.code || ''}`
          expect(errorMsg).toMatch(/Failed query|duplicate key|unique constraint|23505/)
        }
      })

      it('should reject duplicate (userId, storyId) on like table', async () => {
        const author = await createTestUser('author')
        const reader = await createTestUser('reader')
        const testStory = await createTestStory(author.id)

        await db.insert(like).values({ userId: reader.id, storyId: testStory.id })

        // Duplicate insert without onConflictDoNothing should throw
        await expect(
          db.insert(like).values({ userId: reader.id, storyId: testStory.id }),
        ).rejects.toThrow()

        // With onConflictDoNothing it should silently succeed
        const result = await db
          .insert(like)
          .values({ userId: reader.id, storyId: testStory.id })
          .onConflictDoNothing()
          .returning()

        expect(result.length).toBe(0)
      })

      it('should enforce unique constraint on feedItem (ownerId, activityId)', async () => {
        const author = await createTestUser('author')
        const reader = await createTestUser('reader')
        const testStory = await createTestStory(author.id)

        const [act] = await db
          .insert(activity)
          .values({
            id: `act_${createId()}`,
            actorId: author.id,
            verb: 'STORY_PUBLISHED',
            storyId: testStory.id,
          })
          .returning()

        await db.insert(feedItem).values({ ownerId: reader.id, activityId: act.id })

        // Duplicate insert should throw
        await expect(
          db.insert(feedItem).values({ ownerId: reader.id, activityId: act.id }),
        ).rejects.toThrow()
      })
    })

    describe('3. Atomic Transactions & Rollback Semantics', () => {
      it('should atomically commit like insertion and counter increment, and rollback cleanly on error', async () => {
        const author = await createTestUser('author')
        const reader = await createTestUser('reader')
        const testStory = await createTestStory(author.id, { likeCount: 0 })

        // Successful atomic transaction
        await db.transaction(async (tx) => {
          await tx.insert(like).values({ userId: reader.id, storyId: testStory.id })
          await tx
            .update(story)
            .set({ likeCount: sql`${story.likeCount} + 1` })
            .where(eq(story.id, testStory.id))
        })

        const updatedStory = await db.query.story.findFirst({
          where: eq(story.id, testStory.id),
        })
        expect(updatedStory?.likeCount).toBe(1)

        // Transaction that rolls back: attempt like for non-existent story
        const reader2 = await createTestUser('reader2')
        try {
          await db.transaction(async (tx) => {
            await tx
              .update(story)
              .set({ likeCount: sql`${story.likeCount} + 1` })
              .where(eq(story.id, testStory.id))

            // Insert like pointing to invalid story id -> foreign key violation
            await tx.insert(like).values({ userId: reader2.id, storyId: 'non_existent_story' })
          })
        } catch {
          // Expected transaction error
        }

        // Verify rollback: likeCount did not increment to 2
        const rolledBackStory = await db.query.story.findFirst({
          where: eq(story.id, testStory.id),
        })
        expect(rolledBackStory?.likeCount).toBe(1)

        const likeExists = await db.query.like.findFirst({
          where: and(eq(like.userId, reader2.id), eq(like.storyId, testStory.id)),
        })
        expect(likeExists).toBeUndefined()
      })

      it('decrement operations should floor at 0 using GREATEST(count - 1, 0)', async () => {
        const author = await createTestUser('author')
        const testStory = await createTestStory(author.id, { likeCount: 0, readLaterCount: 0 })

        // Decrement when already at 0
        await db
          .update(story)
          .set({
            likeCount: sql`GREATEST(${story.likeCount} - 1, 0)`,
            readLaterCount: sql`GREATEST(${story.readLaterCount} - 1, 0)`,
          })
          .where(eq(story.id, testStory.id))

        const updated = await db.query.story.findFirst({
          where: eq(story.id, testStory.id),
        })
        expect(updated?.likeCount).toBe(0)
        expect(updated?.readLaterCount).toBe(0)
      })

      it('chapter indexing with MAX(chapterIndex) + 1 should avoid index collisions even after deletions', async () => {
        const author = await createTestUser('author')
        const testStory = await createTestStory(author.id)

        await createTestChapter(testStory.id, author.id, 1)
        const c2 = await createTestChapter(testStory.id, author.id, 2)
        await createTestChapter(testStory.id, author.id, 3)

        // Delete chapter 2 mid-sequence (remaining: 1, 3; COUNT(*) is 2, but MAX is 3)
        await db.delete(chapter).where(eq(chapter.id, c2.id))

        // Use MAX(chapterIndex) + 1 logic
        const result = await db.transaction(async (tx) => {
          const [{ maxIndex }] = await tx
            .select({ maxIndex: sql<number | null>`max(${chapter.chapterIndex})` })
            .from(chapter)
            .where(eq(chapter.storyId, testStory.id))

          const nextIndex = (maxIndex ?? 0) + 1

          const [newChapter] = await tx
            .insert(chapter)
            .values({
              id: `chp_${createId()}`,
              storyId: testStory.id,
              authorId: author.id,
              chapterIndex: nextIndex,
              title: `Chapter ${nextIndex}`,
              content: 'New Chapter Content',
            })
            .returning()

          return newChapter
        })

        // Next index must be 4 (not 3, which would collide with existing chapter 3)
        expect(result.chapterIndex).toBe(4)
      })
    })

    describe('4. Concurrency & Race Condition Resilience', () => {
      it('concurrent likes from 10 different users should increment likeCount accurately without lost updates', async () => {
        const author = await createTestUser('author')
        const testStory = await createTestStory(author.id, { likeCount: 0 })

        // Create 10 distinct users
        const readers = await Promise.all(
          Array.from({ length: 10 }, (_, i) => createTestUser(`concurrent_user_${i}`)),
        )

        // Execute 10 simultaneous likes in parallel
        await Promise.all(
          readers.map(async (reader) => {
            await db.transaction(async (tx) => {
              const [inserted] = await tx
                .insert(like)
                .values({ userId: reader.id, storyId: testStory.id })
                .onConflictDoNothing()
                .returning()

              if (inserted) {
                await tx
                  .update(story)
                  .set({ likeCount: sql`${story.likeCount} + 1` })
                  .where(eq(story.id, testStory.id))
              }
            })
          }),
        )

        const finalStory = await db.query.story.findFirst({
          where: eq(story.id, testStory.id),
        })
        expect(finalStory?.likeCount).toBe(10)

        const likesCount = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(like)
          .where(eq(like.storyId, testStory.id))

        expect(likesCount[0].count).toBe(10)
      })

      it('concurrent duplicate like attempts by the same user should be idempotent and increment counter exactly once', async () => {
        const author = await createTestUser('author')
        const reader = await createTestUser('reader')
        const testStory = await createTestStory(author.id, { likeCount: 0 })

        // Fire 5 identical like requests concurrently from the same user
        await Promise.all(
          Array.from({ length: 5 }, async () => {
            await db.transaction(async (tx) => {
              const [inserted] = await tx
                .insert(like)
                .values({ userId: reader.id, storyId: testStory.id })
                .onConflictDoNothing()
                .returning()

              if (inserted) {
                await tx
                  .update(story)
                  .set({ likeCount: sql`${story.likeCount} + 1` })
                  .where(eq(story.id, testStory.id))
              }
            })
          }),
        )

        const finalStory = await db.query.story.findFirst({
          where: eq(story.id, testStory.id),
        })
        expect(finalStory?.likeCount).toBe(1)
      })
    })

    describe('5. Complex SQL Queries & Feed Fanout Logic', () => {
      it('fanoutActivity should correctly union followers, likers, and read_later users while strictly excluding author', async () => {
        const author = await createTestUser('author')

        // Recipients in various relations
        const followerOnly = await createTestUser('follower_only')
        const followerAndLiker = await createTestUser('follower_and_liker')
        const likerOnly = await createTestUser('liker_only')
        const readLaterOnly = await createTestUser('read_later_only')
        const likerAndReadLater = await createTestUser('liker_and_read_later')

        // Author sets up relationships
        await db.insert(follow).values([
          { followerId: followerOnly.id, followeeId: author.id },
          { followerId: followerAndLiker.id, followeeId: author.id },
          // Author following themselves (edge case)
          { followerId: author.id, followeeId: author.id },
        ])

        const testStory = await createTestStory(author.id)

        await db.insert(like).values([
          { userId: followerAndLiker.id, storyId: testStory.id },
          { userId: likerOnly.id, storyId: testStory.id },
          { userId: likerAndReadLater.id, storyId: testStory.id },
          // Author liking their own story (edge case)
          { userId: author.id, storyId: testStory.id },
        ])

        await db.insert(readLater).values([
          { userId: readLaterOnly.id, storyId: testStory.id },
          { userId: likerAndReadLater.id, storyId: testStory.id },
          // Author adding to read later (edge case)
          { userId: author.id, storyId: testStory.id },
        ])

        // Activity: new story published
        const [pubActivity] = await db
          .insert(activity)
          .values({
            id: `act_${createId()}`,
            actorId: author.id,
            verb: 'STORY_PUBLISHED',
            storyId: testStory.id,
          })
          .returning()

        // Run fanoutActivity
        const fanoutResult = await fanoutActivity(db, pubActivity.id)

        // Exactly 5 unique recipients:
        // followerOnly, followerAndLiker, likerOnly, readLaterOnly, likerAndReadLater
        expect(fanoutResult.insertedCount).toBe(5)

        // Query the feed items
        const items = await db
          .select()
          .from(feedItem)
          .where(eq(feedItem.activityId, pubActivity.id))

        expect(items.length).toBe(5)

        const recipientIds = items.map((i) => i.ownerId)
        expect(recipientIds).toContain(followerOnly.id)
        expect(recipientIds).toContain(followerAndLiker.id)
        expect(recipientIds).toContain(likerOnly.id)
        expect(recipientIds).toContain(readLaterOnly.id)
        expect(recipientIds).toContain(likerAndReadLater.id)
        expect(recipientIds).not.toContain(author.id)

        // Idempotency: re-running fanout for the same activity should not duplicate feed items
        await fanoutActivity(db, pubActivity.id)
        const afterSecondRun = await db
          .select()
          .from(feedItem)
          .where(eq(feedItem.activityId, pubActivity.id))

        expect(afterSecondRun.length).toBe(5)
      })

      it('getRankedStories should properly apply Hacker News time decay formula', async () => {
        const author = await createTestUser('author')

        const now = new Date()
        const twoDaysAgo = new Date(now.getTime() - 48 * 3600 * 1000)

        // Older story with high score (10 likes)
        const oldPopularStory = await createTestStory(author.id, {
          title: 'Old Popular Story',
          likeCount: 10,
          createdAt: twoDaysAgo,
        })

        // Fresh story with moderate score (3 likes) published just now
        const freshStory = await createTestStory(author.id, {
          title: 'Fresh Story',
          likeCount: 3,
          createdAt: now,
        })

        const ranked = await getRankedStories({
          db,
          extraWhere: inArray(story.id, [oldPopularStory.id, freshStory.id]),
          limit: 10,
        })

        const oldRank = ranked.find((r) => r.id === oldPopularStory.id)
        const freshRank = ranked.find((r) => r.id === freshStory.id)

        expect(oldRank).toBeDefined()
        expect(freshRank).toBeDefined()

        // Due to 48 hour age decay ((score) / (48 + 2)^1.8), the fresh story ranks higher
        expect(freshRank!.rank).toBeGreaterThan(oldRank!.rank)
      })

      it('PostgreSQL trigram fuzzy search should match stories with typos', async () => {
        const author = await createTestUser('author')

        const uniqueTerm = `ValyrianDragon_${createId().slice(0, 6)}`
        const testStory = await createTestStory(author.id, {
          title: `Chronicles of ${uniqueTerm}`,
          description: 'An epic tale of magic and fire',
        })

        // Query with typo in the term
        const typoQuery = uniqueTerm.slice(0, -2) // e.g. dropped last 2 chars

        const results = await db.transaction(async (tx) => {
          await tx.execute(sql.raw('SET LOCAL pg_trgm.similarity_threshold = 0.3'))
          return tx
            .select({ id: story.id, title: story.title })
            .from(story)
            .where(sql`${story.title} % ${typoQuery}`)
        })

        const match = results.find((r) => r.id === testStory.id)
        expect(match).toBeDefined()
        expect(match?.id).toBe(testStory.id)
      })

      it('PostgreSQL full-text search websearch_to_tsquery should match multiple terms against tsvector', async () => {
        const author = await createTestUser('author')

        const token1 = `mystic_${createId().slice(0, 6)}`
        const token2 = `sorcery_${createId().slice(0, 6)}`

        const testStory = await createTestStory(author.id, {
          title: `The Order of ${token1}`,
          description: `Deep secret ${token2} in the forgotten realm`,
        })

        const matches = await db
          .select({ id: story.id })
          .from(story)
          .where(
            sql`to_tsvector('english', ${story.title} || ' ' || coalesce(${story.description}, '')) @@ websearch_to_tsquery('english', ${`${token1} ${token2}`})`,
          )

        expect(matches.some((m) => m.id === testStory.id)).toBe(true)
      })
    })
  },
)
