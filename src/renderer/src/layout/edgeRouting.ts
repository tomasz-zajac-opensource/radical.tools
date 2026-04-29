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

/** Build SVG path string. If 3+ points, smooth the polyline with a
 * cubic bezier through interior corners; otherwise emit a single bezier
 * curve from first→last with control points pulled along the exit sides. */
function buildSvgPath(pts: Pt[]): string {
  if (pts.length < 2) return ''
  if (pts.length === 2) {
    // Straight line — caller will use buildBezierPath for endpoints
    return `M${pts[0].x},${pts[0].y}L${pts[1].x},${pts[1].y}`
  }
  // Catmull-Rom-like smoothing: replace each interior corner with a
  // quadratic-style rounded turn using cubic beziers.
  const RADIUS = 24
  let d = `M${pts[0].x},${pts[0].y}`
  for (let i = 1; i < pts.length - 1; i++) {
    const prev = pts[i - 1]
    const cur = pts[i]
    const next = pts[i + 1]
    const d1 = Math.hypot(cur.x - prev.x, cur.y - prev.y)
    const d2 = Math.hypot(next.x - cur.x, next.y - cur.y)
    const r = Math.min(RADIUS, d1 / 2, d2 / 2)
    if (r < 1) { d += `L${cur.x},${cur.y}`; continue }
    const t1 = { x: cur.x - (cur.x - prev.x) * (r / d1), y: cur.y - (cur.y - prev.y) * (r / d1) }
    const t2 = { x: cur.x + (next.x - cur.x) * (r / d2), y: cur.y + (next.y - cur.y) * (r / d2) }
    d += `L${t1.x},${t1.y}Q${cur.x},${cur.y} ${t2.x},${t2.y}`
  }
  const last = pts[pts.length - 1]
  d += `L${last.x},${last.y}`
  return d
}

/** Build a cubic bezier with control points pulled along the exit sides. */
function buildBezierPath(
  s: Pt, sSide: Position, t: Pt, tSide: Position
): string {
  const dist = Math.hypot(t.x - s.x, t.y - s.y)
  // Control-point pull: half the endpoint distance, capped so very long
  // edges don't loop wildly and very short ones still get a visible bend.
  const pull = Math.min(180, Math.max(40, dist * 0.5))
  const c1 = extendPt(s.x, s.y, sSide, pull)
  const c2 = extendPt(t.x, t.y, tSide, pull)
  return `M${s.x},${s.y}C${c1.x},${c1.y} ${c2.x},${c2.y} ${t.x},${t.y}`
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
  _obstacles: RoutingObstacle[],
): { path: string; labelX: number; labelY: number } {
  // Curved edges: a single cubic bezier with control points pulled along
  // each side's exit normal. The handle-side tangent makes the arrowhead
  // align cleanly with the chosen side and gives a natural flow.
  //
  // We intentionally don't run A* obstacle avoidance here — orthogonal
  // routing fights against curve aesthetics. Crossings are minimised by
  // the upstream layout (radical/cola) instead.
  const path = buildBezierPath(
    { x: sx, y: sy }, srcSide,
    { x: tx, y: ty }, tgtSide
  )
  // Bezier midpoint for labels: De Casteljau at t=0.5
  const dist = Math.hypot(tx - sx, ty - sy)
  const pull = Math.min(180, Math.max(40, dist * 0.5))
  const c1 = extendPt(sx, sy, srcSide, pull)
  const c2 = extendPt(tx, ty, tgtSide, pull)
  const labelX = 0.125 * sx + 0.375 * c1.x + 0.375 * c2.x + 0.125 * tx
  const labelY = 0.125 * sy + 0.375 * c1.y + 0.375 * c2.y + 0.125 * ty
  return { path, labelX, labelY }
}
