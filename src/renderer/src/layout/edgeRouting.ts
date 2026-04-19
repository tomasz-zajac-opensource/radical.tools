/**
 * Orthogonal edge routing with obstacle avoidance.
 * Uses A* pathfinding on a coarse grid to find paths around diagram nodes.
 */
import { Position } from 'reactflow'

// ── Types ─────────────────────────────────────────────────────────────

export interface RoutingObstacle {
  x: number
  y: number
  w: number
  h: number
}

interface Pt {
  x: number
  y: number
}

// ── Constants ─────────────────────────────────────────────────────────

const CELL = 15        // grid cell size (px) — finer grid = better obstacle avoidance
const OBS_PAD = 20     // padding around obstacles on the grid (wider = routes further around)
const EXIT_DIST = 20   // extension from node border for A* start/end cell
const TURN_PENALTY = 2 // A* penalty for changing direction (lower = more willing to detour)

// ── Helpers ───────────────────────────────────────────────────────────

function extendPt(x: number, y: number, side: Position, dist: number): Pt {
  switch (side) {
    case Position.Top:    return { x, y: y - dist }
    case Position.Bottom: return { x, y: y + dist }
    case Position.Left:   return { x: x - dist, y }
    case Position.Right:  return { x: x + dist, y }
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

/** Is srcSide a vertical exit (Top/Bottom)? */
function isVertical(side: Position): boolean {
  return side === Position.Top || side === Position.Bottom
}

// ── A* Pathfinding ────────────────────────────────────────────────────

function astarSearch(
  sc: number, sr: number, tc: number, tr: number,
  cols: number, rows: number, blocked: Uint8Array,
): [number, number][] | null {
  const total = cols * rows
  const idx = (c: number, r: number) => r * cols + c
  const startI = idx(sc, sr)
  const endI = idx(tc, tr)

  const gScore = new Float32Array(total).fill(Infinity)
  const parent = new Int32Array(total).fill(-1)
  const closed = new Uint8Array(total)
  const dir = new Int8Array(total).fill(-1)

  gScore[startI] = 0

  const heapF: number[] = []
  const heapI: number[] = []

  function push(f: number, i: number) {
    let pos = heapF.length
    heapF.push(f); heapI.push(i)
    while (pos > 0) {
      const p = (pos - 1) >> 1
      if (heapF[pos] < heapF[p]) {
        ;[heapF[pos], heapF[p]] = [heapF[p], heapF[pos]]
        ;[heapI[pos], heapI[p]] = [heapI[p], heapI[pos]]
        pos = p
      } else break
    }
  }

  function pop(): number {
    const top = heapI[0]
    const n = heapF.length - 1
    if (n > 0) {
      heapF[0] = heapF[n]; heapI[0] = heapI[n]
      heapF.length = n; heapI.length = n
      let pos = 0
      while (true) {
        let s = pos
        const l = 2 * pos + 1, r = 2 * pos + 2
        if (l < n && heapF[l] < heapF[s]) s = l
        if (r < n && heapF[r] < heapF[s]) s = r
        if (s !== pos) {
          ;[heapF[pos], heapF[s]] = [heapF[s], heapF[pos]]
          ;[heapI[pos], heapI[s]] = [heapI[s], heapI[pos]]
          pos = s
        } else break
      }
    } else {
      heapF.length = 0; heapI.length = 0
    }
    return top
  }

  const h = (c: number, r: number) => Math.abs(tc - c) + Math.abs(tr - r)
  push(h(sc, sr), startI)

  const DIRS: [number, number, number][] = [[1, 0, 0], [-1, 0, 1], [0, 1, 2], [0, -1, 3]]

  while (heapF.length > 0) {
    const ci = pop()
    if (ci === endI) break
    if (closed[ci]) continue
    closed[ci] = 1

    const cc = ci % cols
    const cr = (ci - cc) / cols
    const cg = gScore[ci]
    const cd = dir[ci]

    for (const [dc, dr, d] of DIRS) {
      const nc = cc + dc
      const nr = cr + dr
      if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) continue
      const ni = idx(nc, nr)
      if (closed[ni] || (blocked[ni] && ni !== endI)) continue

      const turn = (cd >= 0 && cd !== d) ? TURN_PENALTY : 0
      const ng = cg + 1 + turn
      if (ng < gScore[ni]) {
        gScore[ni] = ng
        parent[ni] = ci
        dir[ni] = d
        push(ng + h(nc, nr), ni)
      }
    }
  }

  if (gScore[endI] === Infinity) return null

  const path: [number, number][] = []
  let k = endI
  while (k !== -1 && k !== startI) {
    path.push([k % cols, Math.floor(k / cols)])
    k = parent[k]
  }
  path.push([sc, sr])
  path.reverse()
  return path
}

// ── Path processing ───────────────────────────────────────────────────

/** Remove collinear intermediate points */
function simplifyPath(pts: Pt[]): Pt[] {
  if (pts.length <= 2) return pts
  const out = [pts[0]]
  for (let i = 1; i < pts.length - 1; i++) {
    const a = out[out.length - 1], b = pts[i], c = pts[i + 1]
    if (!((a.x === b.x && b.x === c.x) || (a.y === b.y && b.y === c.y)))
      out.push(b)
  }
  out.push(pts[pts.length - 1])
  return out
}

/**
 * Build an orthogonal L-shaped stub from border to the first/last grid point.
 * For vertical exit (Top/Bottom): first go vertically to grid Y, then horizontally.
 * For horizontal exit (Left/Right): first go horizontally to grid X, then vertically.
 */
function stubToGrid(border: Pt, grid: Pt, side: Position): Pt[] {
  if (border.x === grid.x && border.y === grid.y) return []
  if (border.x === grid.x || border.y === grid.y) return [] // already aligned, L not needed
  if (isVertical(side)) {
    return [{ x: border.x, y: grid.y }] // vertical first, then horizontal
  } else {
    return [{ x: grid.x, y: border.y }] // horizontal first, then vertical
  }
}

/** Build SVG path string with smooth Catmull-Rom spline (converted to cubic beziers) */
function buildSvgPath(pts: Pt[]): string {
  if (pts.length < 2) return ''
  if (pts.length === 2) {
    return `M${pts[0].x},${pts[0].y}L${pts[1].x},${pts[1].y}`
  }

  // Catmull-Rom to cubic bezier conversion (alpha=0, uniform parameterization)
  // For n points, produce n-1 cubic segments. Duplicate first/last for end tangents.
  const all = [pts[0], ...pts, pts[pts.length - 1]]
  let p = `M${pts[0].x},${pts[0].y}`

  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = all[i]
    const p1 = all[i + 1]
    const p2 = all[i + 2]
    const p3 = all[i + 3]

    // Convert Catmull-Rom segment (p0,p1,p2,p3) → cubic bezier control points
    const c1x = p1.x + (p2.x - p0.x) / 6
    const c1y = p1.y + (p2.y - p0.y) / 6
    const c2x = p2.x - (p3.x - p1.x) / 6
    const c2y = p2.y - (p3.y - p1.y) / 6

    p += `C${c1x},${c1y},${c2x},${c2y},${p2.x},${p2.y}`
  }
  return p
}

/** Compute midpoint along polyline by arc length */
function polyMidpoint(pts: Pt[]): Pt {
  if (pts.length < 2) return pts[0] ?? { x: 0, y: 0 }
  let total = 0
  for (let i = 1; i < pts.length; i++)
    total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
  let rem = total / 2
  for (let i = 1; i < pts.length; i++) {
    const seg = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
    if (rem <= seg && seg > 0) {
      const t = rem / seg
      return {
        x: pts[i - 1].x + t * (pts[i].x - pts[i - 1].x),
        y: pts[i - 1].y + t * (pts[i].y - pts[i - 1].y),
      }
    }
    rem -= seg
  }
  return pts[pts.length - 1]
}

// ── Main export ───────────────────────────────────────────────────────

export function computeRoutedEdge(
  sx: number, sy: number, srcSide: Position,
  tx: number, ty: number, tgtSide: Position,
  obstacles: RoutingObstacle[],
): { path: string; labelX: number; labelY: number } {
  const src: Pt = { x: sx, y: sy }
  const tgt: Pt = { x: tx, y: ty }

  if (obstacles.length === 0) return makeFallbackPath(src, tgt, srcSide, tgtSide)

  // Always use clean cubic bezier — direction-aware control points
  return makeFallbackPath(src, tgt, srcSide, tgtSide)
}

/** Simple smooth bezier path without obstacle avoidance */
function makeFallbackPath(
  src: Pt, tgt: Pt, srcSide: Position, tgtSide: Position,
): { path: string; labelX: number; labelY: number } {
  // Compute control points based on exit directions for a smooth cubic bezier
  const dist = Math.hypot(tgt.x - src.x, tgt.y - src.y)
  const tension = Math.max(50, dist * 0.4)

  let c1: Pt, c2: Pt
  switch (srcSide) {
    case Position.Top:    c1 = { x: src.x, y: src.y - tension }; break
    case Position.Bottom: c1 = { x: src.x, y: src.y + tension }; break
    case Position.Left:   c1 = { x: src.x - tension, y: src.y }; break
    case Position.Right:  c1 = { x: src.x + tension, y: src.y }; break
  }
  switch (tgtSide) {
    case Position.Top:    c2 = { x: tgt.x, y: tgt.y - tension }; break
    case Position.Bottom: c2 = { x: tgt.x, y: tgt.y + tension }; break
    case Position.Left:   c2 = { x: tgt.x - tension, y: tgt.y }; break
    case Position.Right:  c2 = { x: tgt.x + tension, y: tgt.y }; break
  }

  const path = `M${src.x},${src.y}C${c1.x},${c1.y},${c2.x},${c2.y},${tgt.x},${tgt.y}`
  const labelX = (src.x + tgt.x) / 2
  const labelY = (src.y + tgt.y) / 2
  return { path, labelX, labelY }
}
