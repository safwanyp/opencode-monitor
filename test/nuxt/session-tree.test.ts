import { describe, expect, it } from 'vitest'

import type { SessionSummary } from '../../shared/types/events.ts'
import {
  buildSessionTree,
  countDescendants,
  filterSessionTree,
  flattenSessionTree,
  sortSessionTree,
} from '../../app/composables/useSessionTree.ts'

const s = (
  id: string,
  parentID?: string,
  overrides: Partial<SessionSummary> = {},
): SessionSummary => ({ id, title: id, parentID, ...overrides })

/** One root, three children, one grandchild. */
function family() {
  return [
    s('root', undefined, { title: 'Main task', cost: 1 }),
    s('c1', 'root', { title: 'Critique A', cost: 0.5, agent: 'panel-a' }),
    s('c2', 'root', { title: 'Worker', cost: 2, agent: 'worker' }),
    s('c3', 'root', { title: 'Critique B', cost: 0.25, agent: 'panel-b' }),
    s('g1', 'c2', { title: 'Research', cost: 0.75, agent: 'research' }),
  ]
}

describe('buildSessionTree', () => {
  it('nests children under their parent', () => {
    const tree = buildSessionTree(family())
    expect(tree).toHaveLength(1)
    expect(tree[0]!.session.id).toBe('root')
    expect(tree[0]!.children.map((c) => c.session.id)).toEqual(['c1', 'c2', 'c3'])
  })

  it('nests more than one level deep', () => {
    const tree = buildSessionTree(family())
    const worker = tree[0]!.children.find((c) => c.session.id === 'c2')
    expect(worker?.children[0]?.session.id).toBe('g1')
    expect(worker?.children[0]?.depth).toBe(2)
  })

  it('treats a session whose parent is missing as a root', () => {
    // The API pages at 50, so a page boundary can split a family. An orphan must
    // still render rather than vanish.
    const tree = buildSessionTree([s('orphan', 'not-in-the-page')])
    expect(tree).toHaveLength(1)
    expect(tree[0]!.session.id).toBe('orphan')
  })

  it('treats a self-parent as a root rather than recursing', () => {
    const tree = buildSessionTree([s('loop', 'loop')])
    expect(tree).toHaveLength(1)
    expect(tree[0]!.children).toHaveLength(0)
  })

  it('survives a cycle between two sessions', () => {
    const tree = buildSessionTree([s('a', 'b'), s('b', 'a')])
    // Neither can be a root by parent lookup, so both are surfaced explicitly.
    // Silently dropping them would lose sessions the API returned.
    const ids = tree.flatMap(function collectIds(n): string[] {
      return [n.session.id, ...n.children.flatMap(collectIds)]
    })
    expect(ids).toContain('a')
    expect(ids).toContain('b')
  })

  it('never loses a session, whatever the parent links say', () => {
    const sessions = [
      s('root'),
      s('child', 'root'),
      s('orphan', 'missing'),
      s('loop-a', 'loop-b'),
      s('loop-b', 'loop-a'),
    ]
    const tree = buildSessionTree(sessions)
    const seen = new Set<string>()
    const walk = (nodes: typeof tree) => {
      for (const node of nodes) {
        seen.add(node.session.id)
        walk(node.children)
      }
    }
    walk(tree)
    expect([...seen].sort()).toEqual(
      ['child', 'loop-a', 'loop-b', 'orphan', 'root'].sort(),
    )
  })

  it('is empty for no sessions', () => {
    expect(buildSessionTree([])).toEqual([])
  })

  it('reports the number of sessions in the live workspace shape', () => {
    // 42 of 50 upstream sessions are subagents; this mirrors that ratio.
    const sessions: SessionSummary[] = [s('r1'), s('r2')]
    for (let i = 0; i < 42; i++) sessions.push(s(`sub${i}`, i % 2 === 0 ? 'r1' : 'r2'))
    const tree = buildSessionTree(sessions)
    expect(tree).toHaveLength(2)
    expect(countDescendants(tree[0]!) + countDescendants(tree[1]!)).toBe(42)
  })
})

describe('countDescendants', () => {
  it('counts the whole subtree, not just direct children', () => {
    const tree = buildSessionTree(family())
    expect(countDescendants(tree[0]!)).toBe(4)
    const worker = tree[0]!.children.find((c) => c.session.id === 'c2')
    expect(countDescendants(worker!)).toBe(1)
  })
})

describe('sortSessionTree', () => {
  it('sorts roots and children independently', () => {
    const tree = sortSessionTree(buildSessionTree(family()), 'cost', 'desc')
    expect(tree[0]!.children.map((c) => c.session.id)).toEqual(['c2', 'c1', 'c3'])
  })

  it('does not move children out of their parent', () => {
    const tree = sortSessionTree(buildSessionTree(family()), 'title', 'asc')
    const worker = tree[0]!.children.find((c) => c.session.id === 'c2')
    expect(worker?.children.map((c) => c.session.id)).toEqual(['g1'])
  })

  it('keeps a deep subtree attached', () => {
    const tree = sortSessionTree(buildSessionTree(family()), 'cost', 'asc')
    expect(countDescendants(tree[0]!)).toBe(4)
  })
})

describe('filterSessionTree', () => {
  it('keeps a parent whose child matched', () => {
    // Dropping the parent would hide the match, which a filter must never do.
    const tree = filterSessionTree(buildSessionTree(family()), (x) => x.id === 'g1')
    expect(tree).toHaveLength(1)
    expect(tree[0]!.session.id).toBe('root')
    expect(tree[0]!.children[0]!.session.id).toBe('c2')
    expect(tree[0]!.children[0]!.children[0]!.session.id).toBe('g1')
  })

  it('drops branches with no surviving session', () => {
    const tree = filterSessionTree(buildSessionTree(family()), (x) => x.id === 'c1')
    expect(tree[0]!.children.map((c) => c.session.id)).toEqual(['c1'])
  })

  it('keeps everything when everything matches', () => {
    const tree = filterSessionTree(buildSessionTree(family()), () => true)
    expect(countDescendants(tree[0]!)).toBe(4)
  })
})

describe('flattenSessionTree', () => {
  const options = (expanded: string[], live: string[] = []) => ({
    expanded: new Set(expanded),
    liveSessions: new Map(live.map((id) => [id, Date.now()])),
  })

  it('shows only roots when nothing is expanded', () => {
    const rows = flattenSessionTree(buildSessionTree(family()), options([]))
    expect(rows).toHaveLength(1)
    expect(rows[0]!.hasChildren).toBe(true)
    expect(rows[0]!.expanded).toBe(false)
  })

  it('shows children when their parent is expanded', () => {
    const rows = flattenSessionTree(buildSessionTree(family()), options(['root']))
    expect(rows.map((r) => r.node.session.id)).toEqual(['root', 'c1', 'c2', 'c3'])
  })

  it('shows grandchildren when the middle level is expanded too', () => {
    const rows = flattenSessionTree(buildSessionTree(family()), options(['root', 'c2']))
    expect(rows.map((r) => r.node.session.id)).toEqual(['root', 'c1', 'c2', 'g1', 'c3'])
  })

  it('expands only what the caller asked for, filter or not', () => {
    // Revealing a matched descendant is the caller's job now: the page expands a
    // search's ancestors once, so a collapse the user makes afterwards sticks.
    // Forcing rows open here is what made "Collapse all" a no-op under a filter.
    const tree = filterSessionTree(buildSessionTree(family()), (x) => x.id === 'g1')

    expect(flattenSessionTree(tree, options([])).map((r) => r.node.session.id)).toEqual([
      'root',
    ])

    // With the ancestors a search would expand, the match is visible.
    expect(
      flattenSessionTree(tree, options(['root', 'c2'])).map((r) => r.node.session.id),
    ).toEqual(['root', 'c2', 'g1'])
  })

  it('aggregates cost and live counts across the subtree', () => {
    const rows = flattenSessionTree(buildSessionTree(family()), options([], ['c1']))
    expect(rows[0]!.subtreeCost).toBeCloseTo(4.5, 5)
    expect(rows[0]!.descendants).toBe(4)
    expect(rows[0]!.liveDescendants).toBe(1)
  })

  it('aggregates tokens across the subtree too', () => {
    const sessions = [
      s('root', undefined, { tokens: { input: 100, output: 0 } }),
      s('child', 'root', { tokens: { input: 200, output: 50 } }),
    ]
    const rows = flattenSessionTree(buildSessionTree(sessions), options([]))
    expect(rows[0]!.subtreeTokens).toBe(350)
  })

  it('makes the root totals additive with the header total', () => {
    // This is the property that decided the design: a parent row showing only
    // its own cost would not sum to the figure in the summary strip.
    const sessions = [
      s('root', undefined, { cost: 1 }),
      s('child', 'root', { cost: 2 }),
      s('grandchild', 'child', { cost: 3 }),
      s('other-root', undefined, { cost: 4 }),
    ]
    const rows = flattenSessionTree(buildSessionTree(sessions), options([]))
    const rootTotal = rows
      .filter((row) => row.node.depth === 0)
      .reduce((sum, row) => sum + row.subtreeCost, 0)
    const everything = sessions.reduce((sum, x) => sum + (x.cost ?? 0), 0)

    expect(rootTotal).toBe(everything)
    expect(rootTotal).toBe(10)
  })

  it('reports the subtree total for a collapsed parent', () => {
    // The collapsed case is the one that was understating spend.
    const rows = flattenSessionTree(buildSessionTree(family()), options([]))
    expect(rows[0]!.expanded).toBe(false)
    expect(rows[0]!.subtreeCost).toBeCloseTo(4.5, 5)
    expect(rows[0]!.node.session.cost).toBe(1)
  })

  it('reports no children for a leaf', () => {
    const rows = flattenSessionTree(buildSessionTree([s('solo')]), options([]))
    expect(rows[0]!.hasChildren).toBe(false)
    expect(rows[0]!.descendants).toBe(0)
  })
})
