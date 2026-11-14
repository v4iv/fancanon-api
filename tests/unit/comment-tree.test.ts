import { describe, expect, it } from 'vitest'

interface CommentNode {
  id: string
  parentId: string | null
  content: string
  depth?: number
  replies?: CommentNode[]
}

// Extracted from chapters/comments endpoint logic
export function buildCommentTree(
  comments: CommentNode[],
  parentId: string | null = null,
  depth = 0,
): CommentNode[] {
  return comments
    .filter((c) => c.parentId === parentId)
    .map((c) => ({
      ...c,
      depth,
      replies: buildCommentTree(comments, c.id, depth + 1),
    }))
}

describe('buildCommentTree', () => {
  it('returns empty array when comments list is empty', () => {
    expect(buildCommentTree([])).toEqual([])
  })

  it('builds flat list when all comments are top-level', () => {
    const comments: CommentNode[] = [
      { id: '1', parentId: null, content: 'First' },
      { id: '2', parentId: null, content: 'Second' },
    ]

    const tree = buildCommentTree(comments)
    expect(tree).toHaveLength(2)
    expect(tree[0].depth).toBe(0)
    expect(tree[0].replies).toEqual([])
    expect(tree[1].depth).toBe(0)
  })

  it('nests child replies under their parent with correct depth', () => {
    const comments: CommentNode[] = [
      { id: '1', parentId: null, content: 'Top comment' },
      { id: '2', parentId: '1', content: 'Reply to 1' },
      { id: '3', parentId: '2', content: 'Reply to reply' },
      { id: '4', parentId: null, content: 'Another top' },
    ]

    const tree = buildCommentTree(comments)
    expect(tree).toHaveLength(2)

    // First top-level comment
    const top1 = tree[0]
    expect(top1.id).toBe('1')
    expect(top1.depth).toBe(0)
    expect(top1.replies).toHaveLength(1)

    // Level 1 reply
    const reply1 = top1.replies![0]
    expect(reply1.id).toBe('2')
    expect(reply1.depth).toBe(1)
    expect(reply1.replies).toHaveLength(1)

    // Level 2 reply
    const reply2 = reply1.replies![0]
    expect(reply2.id).toBe('3')
    expect(reply2.depth).toBe(2)
    expect(reply2.replies).toEqual([])

    // Second top-level comment
    const top2 = tree[1]
    expect(top2.id).toBe('4')
    expect(top2.depth).toBe(0)
    expect(top2.replies).toEqual([])
  })

  it('ignores orphaned comments with non-existent parentId', () => {
    const comments: CommentNode[] = [
      { id: '1', parentId: null, content: 'Top comment' },
      { id: '999', parentId: 'non-existent', content: 'Orphan' },
    ]

    const tree = buildCommentTree(comments)
    expect(tree).toHaveLength(1)
    expect(tree[0].id).toBe('1')
    expect(tree[0].replies).toEqual([])
  })
})
