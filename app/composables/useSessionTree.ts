import type { SessionSummary } from '#shared/types/events'
import { billableTokens } from '#shared/utils/format'

import type { SessionSortKey, SortDirection } from './useSessionSort'
import { sortSessions } from './useSessionSort'

/**
 * The session tree.
 *
 * Most sessions are subagents: 42 of 50 in the live workspace, nesting two levels
 * deep and up to eleven wide. A flat list therefore reads as a wall of
 * near-identical rows, and the sessions the user actually started are lost among
 * them.
 *
 * The hierarchy comes from `parentID`, which is present on the upstream payload
 * but absent from any sample taken from a root session.
 */

export interface SessionNode {
  session: SessionSummary
  children: SessionNode[]
  depth: number
}

/**
 * Build the tree, treating a session whose parent is absent as a root.
 *
 * Absent parents are normal rather than exceptional: the API pages at 50 and a
 * page boundary can split a family, so an orphan must render as a top-level row
 * instead of disappearing.
 */
export function buildSessionTree(sessions: SessionSummary[]): SessionNode[] {
  const byId = new Map(sessions.map((session) => [session.id, session]))
  const childrenOf = new Map<string, SessionSummary[]>()
  const roots: SessionSummary[] = []
  const visited = new Set<string>()

  for (const session of sessions) {
    const parent = session.parentID
    if (!parent || !byId.has(parent) || parent === session.id) {
      roots.push(session)
      continue
    }
    const list = childrenOf.get(parent)
    if (list) list.push(session)
    else childrenOf.set(parent, [session])
  }

  function attach(session: SessionSummary, depth: number, seen: Set<string>): SessionNode {
    // `seen` guards against a cycle in the data, which would otherwise recurse
    // until the stack ran out.
    visited.add(session.id)
    const nextSeen = new Set(seen).add(session.id)
    const children = (childrenOf.get(session.id) ?? [])
      .filter((child) => !nextSeen.has(child.id))
      .map((child) => attach(child, depth + 1, nextSeen))
    return { session, children, depth }
  }

  const tree = roots.map((root) => attach(root, 0, new Set()))

  // Anything unreachable from a root would otherwise vanish. That happens with a
  // cycle, where no member can be a root by parent lookup, and the sessions
  // would silently disappear from the list rather than merely look odd.
  for (const session of sessions) {
    if (visited.has(session.id)) continue
    tree.push(attach(session, 0, new Set([session.id])))
  }

  return tree
}

/** Sorts every level of the tree by the same column, so siblings stay together. */
export function sortSessionTree(
  nodes: SessionNode[],
  key: SessionSortKey,
  direction: SortDirection,
): SessionNode[] {
  if (nodes.length === 0) return []

  const byId = new Map(nodes.map((node) => [node.session.id, node]))
  const ordered = sortSessions(
    nodes.map((node) => node.session),
    key,
    direction,
  )

  return ordered.map((session) => {
    const node = byId.get(session.id) as SessionNode
    return { ...node, children: sortSessionTree(node.children, key, direction) }
  })
}

/**
 * Keeps a node when it matches, or when any descendant does.
 *
 * Dropping a parent whose child matched would hide the match, which is the one
 * thing a filter must never do.
 */
export function filterSessionTree(
  nodes: SessionNode[],
  matches: (session: SessionSummary) => boolean,
): SessionNode[] {
  const out: SessionNode[] = []

  for (const node of nodes) {
    const children = filterSessionTree(node.children, matches)
    if (matches(node.session) || children.length > 0) {
      out.push({ ...node, children })
    }
  }

  return out
}

export interface FlatSessionRow {
  node: SessionNode
  hasChildren: boolean
  expanded: boolean
  /** Aggregate across the subtree, so a collapsed parent still says something. */
  descendants: number
  /**
   * Cost and tokens for the whole subtree, including this session.
   *
   * Shown in place of the session's own figures whenever it has children: a
   * parent that spawned 64 subagents reads as cheap next to its children
   * otherwise, and the column stops being additive with the header total.
   */
  subtreeCost: number
  subtreeTokens: number
  liveDescendants: number
}

export interface FlattenOptions {
  expanded: Set<string>
  /** When a filter is active every surviving ancestor is shown open. */
  forceOpen: boolean
  liveSessions: Map<string, number>
}

export function countDescendants(node: SessionNode): number {
  return node.children.reduce(
    (total, child) => total + 1 + countDescendants(child),
    0,
  )
}

export function flattenSessionTree(
  nodes: SessionNode[],
  options: FlattenOptions,
): FlatSessionRow[] {
  const out: FlatSessionRow[] = []

  const walk = (level: SessionNode[]) => {
    for (const node of level) {
      const hasChildren = node.children.length > 0
      const expanded = hasChildren && (options.forceOpen || options.expanded.has(node.session.id))

      const subtree = [node, ...collect(node)]
      out.push({
        node,
        hasChildren,
        expanded,
        descendants: countDescendants(node),
        subtreeCost: subtree.reduce((sum, s) => sum + (s.session.cost ?? 0), 0),
        subtreeTokens: subtree.reduce(
          (sum, s) => sum + (billableTokens(s.session.tokens) ?? 0),
          0,
        ),
        liveDescendants: subtree.filter((s) => options.liveSessions.has(s.session.id)).length,
      })

      if (expanded) walk(node.children)
    }
  }

  walk(nodes)
  return out
}

function collect(node: SessionNode): SessionNode[] {
  return node.children.flatMap((child) => [child, ...collect(child)])
}
