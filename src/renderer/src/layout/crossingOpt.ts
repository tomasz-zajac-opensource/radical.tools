/**
 * Geometric layout optimisation: crossing minimisation + node-overdraw reduction.
 *
 * ## Cost function
 *
 * The optimiser minimises a combined cost:
 *
 *   cost = CROSSING_WEIGHT × (edge–edge crossings)
 *        + OVERDRAW_WEIGHT × (edge–node overdraw occurrences)
 *
 * An "overdraw" is counted whenever the centre-to-centre segment of an edge
 * passes through the bounding box of a node that is neither the edge's source
 * nor target, nor an ancestor of either (ancestors are transparent because they
 * visually contain their children).
 *
 * Crossings are weighted higher (3×) because two crossing lines obscure both
 * paths simultaneously; an edge passing over a single block is less harmful.
 *
 * ## Algorithm (greedy pairwise position swaps)
 *
 * For every sibling group (nodes sharing the same parent, or all root nodes):
 *   1. Collect all edges touching the group (intra-group AND escape edges).
 *   2. Evaluate `cost(currentPositions)`.
 *   3. For every ordered pair (a, b) swap their top-left positions, keeping
 *      each node's own dimensions, and accept the swap iff cost decreases.
 *   4. Repeat until no swap helps or pass limit reached (default 10).
 *
 * ## Complexity
 *
 * O(passes × |siblings|² × (|edges|² + |edges| × |nodes|)) per group.
 * For typical C4 diagrams this runs in < 5 ms total.
 *
 * References:
 *   Jünger & Mutzel (1997), "2-Layer Straightline Crossing Minimisation"
 *   Cohen-Sutherland line-rect clipping (segment-rectangle intersection)
 */

import type { C4Node, C4Relation } from '../types/c4'
import { COLLAPSED_WIDTH, COLLAPSED_HEIGHT } from '../types/c4'

// ── Geometry primitives ───────────────────────────────────────────────────────

type Point = { x: number; y: number }
type Rect  = { x: number; y: number; w: number; h: number }

/** Strict counter-clockwise orientation (collinear returns false). */
function ccw(a: Point, b: Point, c: Point): boolean {
  return (c.y - a.y) * (b.x - a.x) > (b.y - a.y) * (c.x - a.x)
}

/**
 * Proper intersection of segments p1–p2 and p3–p4.
 * Returns false when segments only touch at an endpoint (share a node).
 */
function intersects(p1: Point, p2: Point, p3: Point, p4: Point): boolean {
  return ccw(p1, p3, p4) !== ccw(p2, p3, p4) &&
         ccw(p1, p2, p3) !== ccw(p1, p2, p4)
}

/**
 * True if segment p1→p2 passes through rectangle r.
 * The rect is shrunk by 1 px so edges that merely graze the border don't count.
 * Src/tgt nodes are always skipped at the call site so we never get false
 * positives from the endpoints being inside their own bounding boxes.
 */
function segmentIntersectsRect(p1: Point, p2: Point, r: Rect): boolean {
  const x0 = r.x + 1, y0 = r.y + 1
  const x1 = r.x + r.w - 1, y1 = r.y + r.h - 1
  if (x1 <= x0 || y1 <= y0) return false // degenerate rect
  // If either endpoint is inside the rect the segment definitely overlaps it
  if (p1.x > x0 && p1.x < x1 && p1.y > y0 && p1.y < y1) return true
  if (p2.x > x0 && p2.x < x1 && p2.y > y0 && p2.y < y1) return true
  // Otherwise check the segment against each of the 4 rect sides
  const tl: Point = { x: x0, y: y0 }, tr: Point = { x: x1, y: y0 }
  const br: Point = { x: x1, y: y1 }, bl: Point = { x: x0, y: y1 }
  return intersects(p1, p2, tl, tr)  // top edge
      || intersects(p1, p2, tr, br)  // right edge
      || intersects(p1, p2, br, bl)  // bottom edge
      || intersects(p1, p2, bl, tl)  // left edge
}

function centre(r: Rect): Point {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 }
}

// ── Effective dimensions (collapsed nodes are smaller) ────────────────────────

function effectiveDims(n: C4Node): { w: number; h: number } {
  if ((n.type === 'system' || n.type === 'container') && n.collapsed) {
    return { w: COLLAPSED_WIDTH[n.type], h: COLLAPSED_HEIGHT[n.type] }
  }
  return { w: n.width, h: n.height }
}

// ── Cost weights ─────────────────────────────────────────────────────────────

/** A crossing between two edges obscures both paths → penalise more. */
const CROSSING_WEIGHT = 3
/**
 * An edge running over a foreign node block impedes readability but is less
 * harmful than a crossing — the node is still fully visible.
 */
const OVERDRAW_WEIGHT = 1

// ── Combined cost function ────────────────────────────────────────────────────

type EdgePair = { src: string; tgt: string }

/**
 * Combined layout cost: crossing penalty + overdraw penalty.
 *
 * @param pos       Absolute bounding rects for every node (mutated by swaps)
 * @param edges     Edges to evaluate (src/tgt are node ids present in `pos`)
 * @param ancestors Precomputed ancestor id-sets keyed by node id.
 *                  Ancestor nodes are transparent (an edge living inside a
 *                  container naturally passes through the container's rect).
 * @param allIds    All node ids present in `pos` (avoids repeated Object.keys)
 */
function layoutCost(
  pos: Record<string, Rect>,
  edges: EdgePair[],
  ancestors: Record<string, Set<string>>,
  allIds: string[]
): number {
  let crossings = 0
  let overdraws = 0

  for (let i = 0; i < edges.length; i++) {
    const a = edges[i]
    const r1 = pos[a.src], r2 = pos[a.tgt]
    if (!r1 || !r2) continue
    const p1 = centre(r1), p2 = centre(r2)
    const srcAnc = ancestors[a.src] ?? new Set<string>()
    const tgtAnc = ancestors[a.tgt] ?? new Set<string>()

    // Overdraw: does this edge pass through any unrelated node's bounding box?
    for (const nid of allIds) {
      if (nid === a.src || nid === a.tgt) continue
      if (srcAnc.has(nid) || tgtAnc.has(nid)) continue // ancestor is transparent
      const rect = pos[nid]
      if (rect && segmentIntersectsRect(p1, p2, rect)) overdraws++
    }

    // Crossings: does this edge cross any later edge?
    for (let j = i + 1; j < edges.length; j++) {
      const b = edges[j]
      // Edges sharing an endpoint node cannot cross each other
      if (a.src === b.src || a.src === b.tgt || a.tgt === b.src || a.tgt === b.tgt) continue
      const r3 = pos[b.src], r4 = pos[b.tgt]
      if (!r3 || !r4) continue
      if (intersects(p1, p2, centre(r3), centre(r4))) crossings++
    }
  }

  return crossings * CROSSING_WEIGHT + overdraws * OVERDRAW_WEIGHT
}

// ── Optional: full diagram cost (for logging / debugging) ────────────────────

export interface LayoutMetrics {
  crossings: number
  overdraws: number
  weightedCost: number
}

/** Returns detailed crossing/overdraw metrics for the entire diagram. */
export function computeLayoutMetrics(
  c4Nodes: Record<string, C4Node>,
  c4Relations: Record<string, C4Relation>
): LayoutMetrics {
  const abs = buildAbsPos(c4Nodes)
  const allIds = Object.keys(abs)
  const ancestors = buildAncestors(c4Nodes)
  const edges: EdgePair[] = Object.values(c4Relations)
    .map(r => ({ src: r.sourceId, tgt: r.targetId }))
    .filter(e => abs[e.src] && abs[e.tgt])

  let crossings = 0
  let overdraws = 0

  for (let i = 0; i < edges.length; i++) {
    const a = edges[i]
    const r1 = abs[a.src], r2 = abs[a.tgt]
    if (!r1 || !r2) continue
    const p1 = centre(r1), p2 = centre(r2)
    const srcAnc = ancestors[a.src] ?? new Set<string>()
    const tgtAnc = ancestors[a.tgt] ?? new Set<string>()

    for (const nid of allIds) {
      if (nid === a.src || nid === a.tgt) continue
      if (srcAnc.has(nid) || tgtAnc.has(nid)) continue
      const rect = abs[nid]
      if (rect && segmentIntersectsRect(p1, p2, rect)) overdraws++
    }

    for (let j = i + 1; j < edges.length; j++) {
      const b = edges[j]
      if (a.src === b.src || a.src === b.tgt || a.tgt === b.src || a.tgt === b.tgt) continue
      const r3 = abs[b.src], r4 = abs[b.tgt]
      if (!r3 || !r4) continue
      if (intersects(p1, p2, centre(r3), centre(r4))) crossings++
    }
  }

  return {
    crossings,
    overdraws,
    weightedCost: crossings * CROSSING_WEIGHT + overdraws * OVERDRAW_WEIGHT,
  }
}

/** Returns the combined layout cost for the entire diagram. */
export function totalLayoutCost(
  c4Nodes: Record<string, C4Node>,
  c4Relations: Record<string, C4Relation>
): number {
  const abs = buildAbsPos(c4Nodes)
  const allIds = Object.keys(abs)
  const ancestors = buildAncestors(c4Nodes)
  const edges: EdgePair[] = Object.values(c4Relations)
    .map(r => ({ src: r.sourceId, tgt: r.targetId }))
    .filter(e => abs[e.src] && abs[e.tgt])
  return layoutCost(abs, edges, ancestors, allIds)
}

// ── Absolute position builder ─────────────────────────────────────────────────

function buildAbsPos(c4Nodes: Record<string, C4Node>): Record<string, Rect> {
  const memo: Record<string, { x: number; y: number }> = {}

  function absOf(id: string): { x: number; y: number } {
    if (memo[id]) return memo[id]
    const n = c4Nodes[id]
    if (!n) return { x: 0, y: 0 }
    if (!n.parentId) {
      memo[id] = { x: n.x, y: n.y }
    } else {
      const p = absOf(n.parentId)
      memo[id] = { x: p.x + n.x, y: p.y + n.y }
    }
    return memo[id]
  }

  const result: Record<string, Rect> = {}
  for (const n of Object.values(c4Nodes)) {
    const a = absOf(n.id)
    const d = effectiveDims(n)
    result[n.id] = { x: a.x, y: a.y, w: d.w, h: d.h }
  }
  return result
}

// ── Ancestor set builder ──────────────────────────────────────────────────────

/**
 * Precompute the set of ancestor node ids for every node.
 * Ancestors are "transparent" to overdraw detection because an edge that
 * lives inside a container naturally passes through the container's rect.
 */
function buildAncestors(c4Nodes: Record<string, C4Node>): Record<string, Set<string>> {
  const result: Record<string, Set<string>> = {}
  for (const n of Object.values(c4Nodes)) {
    const anc = new Set<string>()
    let cur: C4Node | undefined = n
    while (cur?.parentId) {
      anc.add(cur.parentId)
      cur = c4Nodes[cur.parentId]
    }
    result[n.id] = anc
  }
  return result
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Runs the crossing-minimisation local search and returns a map of
 * `nodeId → { x, y }` with improved **parent-relative** positions.
 * Nodes absent from the returned map are unchanged.
 *
 * Call this after a layout engine has written its positions back into
 * `c4Nodes`, but before the store calls `_sync()`.
 */
export function minimizeCrossings(
  c4Nodes: Record<string, C4Node>,
  c4Relations: Record<string, C4Relation>
): Record<string, { x: number; y: number }> {

  // ── 1. Absolute position map (mutated in-place during swaps) ──────────────
  const abs = buildAbsPos(c4Nodes)
  const allIds = Object.keys(abs)

  // ── 2. Ancestor sets (constant throughout optimisation) ───────────────────
  const ancestors = buildAncestors(c4Nodes)

  // ── 3. Group nodes by shared parent ───────────────────────────────────────
  const groups = new Map<string, string[]>()
  for (const n of Object.values(c4Nodes)) {
    const key = n.parentId ?? ''
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(n.id)
  }

  // ── 3b. Build children map for descendant propagation ─────────────────────
  const childrenOf = new Map<string, string[]>()
  for (const n of Object.values(c4Nodes)) {
    const key = n.parentId ?? ''
    if (!childrenOf.has(key)) childrenOf.set(key, [])
    childrenOf.get(key)!.push(n.id)
  }

  /** Shift all descendants' absolute positions after a parent swap */
  function shiftDescendants(nodeId: string, dx: number, dy: number): void {
    for (const childId of childrenOf.get(nodeId) ?? []) {
      const r = abs[childId]
      if (r) { r.x += dx; r.y += dy }
      shiftDescendants(childId, dx, dy)
    }
  }

  // ── 3c. Compute depth for bottom-up ordering ─────────────────────────────
  function nodeDepth(id: string): number {
    let d = 0
    let cur = c4Nodes[id]
    while (cur?.parentId) { d++; cur = c4Nodes[cur.parentId] }
    return d
  }

  // ── 4. Build edge list ─────────────────────────────────────────────────────
  const allEdges: EdgePair[] = Object.values(c4Relations)
    .map(r => ({ src: r.sourceId, tgt: r.targetId }))
    .filter(e => abs[e.src] && abs[e.tgt])

  const updates: Record<string, { x: number; y: number }> = {}

  // ── 5. Optimise each sibling group independently ──────────────────────────
  //
  // Process bottom-up (deepest groups first) so that when parent groups are
  // processed, children have already been finalised and absolute positions
  // are consistent.
  const sortedGroups = [...groups.entries()]
    .filter(([, ids]) => ids.length >= 2)
    .sort(([keyA], [keyB]) => nodeDepth(keyB) - nodeDepth(keyA))

  for (const [parentKey, ids] of sortedGroups) {
    const groupSet = new Set(ids)

    // Edges where at least one endpoint is in this group (intra + escape).
    const relevant = allEdges.filter(
      e => groupSet.has(e.src) || groupSet.has(e.tgt)
    )
    if (relevant.length === 0) continue

    // For root-level nodes, only swap within the same horizontal band
    // (same Y) so we don't mix persons, systems, and externals.
    let swapGroups: string[][]
    if (parentKey === '') {
      const byY = new Map<number, string[]>()
      for (const id of ids) {
        const y = abs[id] ? Math.round(abs[id].y) : 0
        if (!byY.has(y)) byY.set(y, [])
        byY.get(y)!.push(id)
      }
      swapGroups = [...byY.values()].filter(g => g.length >= 2)
    } else {
      swapGroups = [ids]
    }

    for (const swapIds of swapGroups) {
    // ── Greedy local search ───────────────────────────────────────────────
    let improved = true
    let passes = 10
    while (improved && passes-- > 0) {
      improved = false

      for (let i = 0; i < swapIds.length; i++) {
        for (let j = i + 1; j < swapIds.length; j++) {
          const ia = swapIds[i], ib = swapIds[j]
          const ra = abs[ia], rb = abs[ib]

          const before = layoutCost(abs, relevant, ancestors, allIds)

          // Swap top-left positions; each node retains its own dimensions
          const sx = ra.x, sy = ra.y
          ra.x = rb.x; ra.y = rb.y
          rb.x = sx;   rb.y = sy

          const after = layoutCost(abs, relevant, ancestors, allIds)

          if (after < before) {
            // Accept swap — propagate position deltas to descendants
            // so absolute positions stay consistent for subsequent groups
            improved = true
            const dxA = ra.x - sx        // how much ia moved
            const dyA = ra.y - sy
            const dxB = sx - ra.x        // ib moved the opposite amount (since rb got sx,sy and ra got rb's old pos)
            const dyB = sy - ra.y
            // But wait: rb now has (sx, sy) and ra has the old rb position.
            // ia moved by (rb.old.x - sx, rb.old.y - sy) = (ra.x - sx, ra.y - sy) ✓
            // ib moved by (sx - rb.old.x, sy - rb.old.y) = (sx - ra.x, sy - ra.y) = -dxA, -dyA
            shiftDescendants(ia, dxA, dyA)
            shiftDescendants(ib, -dxA, -dyA)

            const pAbs = parentKey && abs[parentKey]
              ? { x: abs[parentKey].x, y: abs[parentKey].y }
              : { x: 0, y: 0 }
            updates[ia] = { x: ra.x - pAbs.x, y: ra.y - pAbs.y }
            updates[ib] = { x: rb.x - pAbs.x, y: rb.y - pAbs.y }
          } else {
            // Revert swap
            rb.x = ra.x; rb.y = ra.y
            ra.x = sx;   ra.y = sy
          }
        }
      }
    }
    } // end swapGroups loop
  }

  return updates
}
