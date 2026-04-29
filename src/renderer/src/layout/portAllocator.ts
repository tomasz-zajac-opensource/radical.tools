/**
 * Port assignment for orthogonal edges.
 *
 * Without ports, every edge connects to the CENTRE of the chosen side, so
 * N edges entering the same node from the same side overlap into a single
 * "spaghetti" trunk. This module:
 *
 *   1. For each edge, picks its source/target side (same heuristic as before).
 *   2. Groups edges by (nodeId, side).
 *   3. Sorts each group by the perpendicular coordinate of the OTHER endpoint
 *      (top→bottom for vertical sides, left→right for horizontal sides).
 *   4. Distributes the connection points evenly along the side.
 *
 * The result is a Map<edgeId, PortAllocation> consumed by RelationEdge.
 *
 * Cache: keyed on the (nodeInternals, edges) reference pair so React Flow's
 * stable references between renders give us O(1) reuse.
 */
import { Position } from 'reactflow'

interface NodeView {
  id: string
  positionAbsolute?: { x: number; y: number }
  width?: number | null
  height?: number | null
  hidden?: boolean
}

interface EdgeView {
  id: string
  source: string
  target: string
}

export interface PortAllocation {
  sourceSide: Position
  sourcePoint: { x: number; y: number }
  targetSide: Position
  targetPoint: { x: number; y: number }
}

// ─── Side picking (same logic that lived inside RelationEdge) ───────────────

function bestSide(dx: number, dy: number, isTarget: boolean): Position {
  const VERTICAL_BIAS = 1.15
  if (Math.abs(dx) >= Math.abs(dy) * VERTICAL_BIAS) {
    const goingRight = dx > 0
    return goingRight !== isTarget ? Position.Right : Position.Left
  }
  const goingDown = dy > 0
  return goingDown !== isTarget ? Position.Bottom : Position.Top
}

export function pickSides(s: NodeView, t: NodeView): { sSide: Position; tSide: Position } {
  const sax = s.positionAbsolute?.x ?? 0
  const say = s.positionAbsolute?.y ?? 0
  const sw = s.width ?? 0
  const sh = s.height ?? 0
  const tax = t.positionAbsolute?.x ?? 0
  const tay = t.positionAbsolute?.y ?? 0
  const tw = t.width ?? 0
  const th = t.height ?? 0
  const sCx = sax + sw / 2, sCy = say + sh / 2
  const tCx = tax + tw / 2, tCy = tay + th / 2

  const ntx = Math.max(tax, Math.min(tax + tw, sCx))
  const nty = Math.max(tay, Math.min(tay + th, sCy))
  let srcDx = ntx - sCx, srcDy = nty - sCy
  if (srcDx === 0 && srcDy === 0) { srcDx = tCx - sCx; srcDy = tCy - sCy }

  const nsx = Math.max(sax, Math.min(sax + sw, tCx))
  const nsy = Math.max(say, Math.min(say + sh, tCy))
  let tgtDx = tCx - nsx, tgtDy = tCy - nsy
  if (tgtDx === 0 && tgtDy === 0) { tgtDx = tCx - sCx; tgtDy = tCy - sCy }

  return { sSide: bestSide(srcDx, srcDy, false), tSide: bestSide(tgtDx, tgtDy, true) }
}

// ─── Port placement along a side ──────────────────────────────────────────

/**
 * Compute port offsets for N edges sharing the same (node, side).
 * Returns the connection-point coordinate on the side for each edge.
 *
 * Spread keeps a margin from corners so adjacent sides don't overlap.
 * For ≤1 edge we return the centre.
 */
function distributePorts(
  node: NodeView,
  side: Position,
  edges: { edgeId: string; otherCenter: { x: number; y: number } }[]
): Map<string, { x: number; y: number }> {
  const result = new Map<string, { x: number; y: number }>()
  const ax = node.positionAbsolute?.x ?? 0
  const ay = node.positionAbsolute?.y ?? 0
  const w = node.width ?? 0
  const h = node.height ?? 0

  if (edges.length === 0) return result

  const isVertical = side === Position.Top || side === Position.Bottom
  // Sort by perpendicular coord of OTHER endpoint
  const sorted = [...edges].sort((a, b) =>
    isVertical
      ? a.otherCenter.x - b.otherCenter.x
      : a.otherCenter.y - b.otherCenter.y
  )

  const total = isVertical ? w : h
  const MARGIN = Math.min(20, total * 0.2)
  const usable = Math.max(0, total - 2 * MARGIN)

  if (sorted.length === 1) {
    // Centred port for solitary edges
    const e = sorted[0]
    const pos = isVertical ? ax + w / 2 : ay + h / 2
    result.set(e.edgeId, portPoint(node, side, pos))
    return result
  }

  // Evenly spaced: positions at MARGIN + i*(usable / (n-1)) for i in 0..n-1
  const step = usable / (sorted.length - 1)
  for (let i = 0; i < sorted.length; i++) {
    const offset = MARGIN + i * step
    const pos = isVertical ? ax + offset : ay + offset
    result.set(sorted[i].edgeId, portPoint(node, side, pos))
  }
  return result
}

function portPoint(
  node: NodeView,
  side: Position,
  posAlong: number
): { x: number; y: number } {
  const ax = node.positionAbsolute?.x ?? 0
  const ay = node.positionAbsolute?.y ?? 0
  const w = node.width ?? 0
  const h = node.height ?? 0
  switch (side) {
    case Position.Top:    return { x: posAlong, y: ay }
    case Position.Bottom: return { x: posAlong, y: ay + h }
    case Position.Left:   return { x: ax,       y: posAlong }
    case Position.Right:  return { x: ax + w,   y: posAlong }
  }
}

// ─── Public API ────────────────────────────────────────────────────────────

let _cacheNodes: unknown = null
let _cacheEdges: unknown = null
let _cacheResult: Map<string, PortAllocation> | null = null

export function allocatePorts(
  nodeInternals: Map<string, NodeView>,
  edges: EdgeView[]
): Map<string, PortAllocation> {
  if (
    _cacheNodes === nodeInternals &&
    _cacheEdges === edges &&
    _cacheResult
  ) {
    return _cacheResult
  }

  // Phase 1: pick sides for each edge
  type EdgeSides = {
    e: EdgeView
    s: NodeView
    t: NodeView
    sSide: Position
    tSide: Position
  }
  const withSides: EdgeSides[] = []
  for (const e of edges) {
    const s = nodeInternals.get(e.source)
    const t = nodeInternals.get(e.target)
    if (!s || !t || s.hidden || t.hidden) continue
    if (!s.width || !s.height || !t.width || !t.height) continue
    const { sSide, tSide } = pickSides(s, t)
    withSides.push({ e, s, t, sSide, tSide })
  }

  // Phase 2: bucket by (nodeId, side, endpointKind)
  type Bucket = { node: NodeView; side: Position; entries: { edgeId: string; otherCenter: { x: number; y: number } }[] }
  const buckets = new Map<string, Bucket>()
  const key = (id: string, side: Position) => `${id}|${side}`
  const centerOf = (n: NodeView) => ({
    x: (n.positionAbsolute?.x ?? 0) + (n.width ?? 0) / 2,
    y: (n.positionAbsolute?.y ?? 0) + (n.height ?? 0) / 2,
  })

  for (const ws of withSides) {
    const sk = key(ws.e.source, ws.sSide)
    const tk = key(ws.e.target, ws.tSide)
    if (!buckets.has(sk)) buckets.set(sk, { node: ws.s, side: ws.sSide, entries: [] })
    if (!buckets.has(tk)) buckets.set(tk, { node: ws.t, side: ws.tSide, entries: [] })
    buckets.get(sk)!.entries.push({ edgeId: 'S:' + ws.e.id, otherCenter: centerOf(ws.t) })
    buckets.get(tk)!.entries.push({ edgeId: 'T:' + ws.e.id, otherCenter: centerOf(ws.s) })
  }

  // Phase 3: distribute ports per bucket
  const portMap = new Map<string, { x: number; y: number }>()
  for (const b of buckets.values()) {
    const placed = distributePorts(b.node, b.side, b.entries)
    for (const [k, v] of placed) portMap.set(k, v)
  }

  // Phase 4: build result keyed by edge id
  const result = new Map<string, PortAllocation>()
  for (const ws of withSides) {
    const sp = portMap.get('S:' + ws.e.id)
    const tp = portMap.get('T:' + ws.e.id)
    if (!sp || !tp) continue
    result.set(ws.e.id, {
      sourceSide: ws.sSide,
      sourcePoint: sp,
      targetSide: ws.tSide,
      targetPoint: tp,
    })
  }

  _cacheNodes = nodeInternals
  _cacheEdges = edges
  _cacheResult = result
  return result
}
