import { eq } from 'drizzle-orm'

import type { Database } from '@/lib/db'
import { category, fandom, like, readLater } from '@/lib/db/schema'

type DbTransaction = Parameters<Parameters<Database['transaction']>[0]>[0]

export async function getOrCreateOriginalContentFandom(tx: DbTransaction): Promise<string> {
  let categoryRow = await tx.query.category.findFirst({
    where: eq(category.slug, 'others'),
    columns: { id: true },
  })

  if (!categoryRow) {
    const [created] = await tx
      .insert(category)
      .values({
        name: 'Others',
        description: 'All other fanfictions.',
        slug: 'others',
      })
      .onConflictDoNothing()
      .returning({ id: category.id })
    categoryRow =
      created ??
      (await tx.query.category.findFirst({
        where: eq(category.slug, 'others'),
        columns: { id: true },
      }))!
  }

  let fandomRow = await tx.query.fandom.findFirst({
    where: eq(fandom.slug, 'original-content'),
    columns: { id: true },
  })

  if (!fandomRow) {
    const [created] = await tx
      .insert(fandom)
      .values({
        name: 'Original Content',
        description: 'Original content created by the community.',
        slug: 'original-content',
        categoryId: categoryRow.id,
      })
      .onConflictDoNothing()
      .returning({ id: fandom.id })
    fandomRow =
      created ??
      (await tx.query.fandom.findFirst({
        where: eq(fandom.slug, 'original-content'),
        columns: { id: true },
      }))!
  }

  return fandomRow.id
}

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
  }
}
