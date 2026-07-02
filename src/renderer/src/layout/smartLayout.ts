/**
 * Smart Layout — planarity-aware ensemble with simulated-annealing refinement.
 *
 * Theoretical background
 * ──────────────────────
 * A drawing has zero crossings iff the underlying graph is **planar**
 * (Kuratowski/Wagner). Real architecture diagrams rarely are, so we
 * minimise the *crossing number* — proven NP-hard (Garey & Johnson 1983).
 * The state-of-the-art practical attack is:
 *
 *   1. Run several **structurally different** layout families in parallel
 *      (Sugiyama-layered, force-directed, stress-majorisation, tree).
 *      Each excels on a different graph topology — layered for hierarchies,
 *      stress for sparse near-planar graphs (Gansner et al. 2005), force
 *      for symmetric clusters, tree for arborescences.
 *
 *   2. Score every result by a **geometric crossing oracle** (the project's
 *      `computeLayoutMetrics` already counts straight-line crossings and
 *      edge↔node overdraw — Cohen-Sutherland clipping in `crossingOpt.ts`).
 *
 *   3. Refine the winner with **Davidson-Harel simulated annealing**
 *      (Davidson & Harel 1996) — perturb root-level positions by Gaussian
 *      noise, accept by Metropolis criterion. SA escapes local minima that
 *      greedy sibling-swap cannot.
 *
 *   4. Report a **planarity score** (skewness proxy = crossing-edge ratio)
 *      and the picked algorithm so the user sees why a layout looks the
 *      way it does.
 *
 * References
 *   • Davidson, R., Harel, D. (1996). "Drawing graphs nicely using
 *     simulated annealing". ACM ToG 15(4).
 *   • Gansner, E.R., Koren, Y., North, S. (2005). "Graph drawing by
 *     stress majorization". Graph Drawing 2004.
 *   • Eades, P. (1984). "A heuristic for graph drawing". Congressus
 *     Numerantium 42.
 *   • Sugiyama, K., Tagawa, S., Toda, M. (1981). "Methods for visual
 *     understanding of hierarchical system structures". IEEE SMC.
 *   • Eclipse Layout Kernel (ELK) — algorithms layered/stress/force/mrtree.
 */

import type { LayoutOptions } from 'elkjs'
import { Position } from 'reactflow'
import type { C4Node, C4Relation, PositionMap } from '../types/c4'
import type { Metamodel } from '../types/metamodel'
import { applyRadicalLayout } from './radicalLayout'
import { minimizeCrossings, computeLayoutMetrics, type LayoutMetrics } from './crossingOpt'
import { pickSides } from './portAllocator'

// ─── Composite aesthetic score ────────────────────────────────────────────
//
// Davidson-Harel (1996) cost function adapted to architecture diagrams.
// Six components, each normalised so the weights are commensurable:
//
//   crossings        — straight-line edge crossings (oracle from crossingOpt)
//   overdraws        — edge passing through unrelated node bbox
//   nodeOverlap      — overlap area between sibling pairs / overall, scaled
//                       to mean node area  (catches layouts that visually
//                       collide even if they have 0 crossings)
//   edgeLengthExcess — (edges far longer than the median count more)
//                       penalises spaghetti where one edge spans the canvas
//   aspectPenalty    — bounding-box aspect ratio deviation from sqrt(2);
//                       prevents 5000-px-wide tape layouts that look bad in
//                       any presentation viewport
//   compactness      — total area of bounding box / sum of node areas;
//                       discourages sparseness without coupling to overlap
//
// Weights tuned so that:
//   1 visible crossing  ≈ 100
//   1 unit node overlap ≈ 50
//   1 long edge         ≈ 5
//   bad aspect ratio    ≈ 10–40
//   sparse compactness  ≈ 0–30
// → crossings still dominate, but the SA / ranking has *gradient* even
//   when the crossing count is locally constant.

interface CompositeScore {
  crossings: number
  renderedCrossings: number
  overdraws: number
  renderedOverdraws: number
  stubLoopPenalty: number
  nodeOverlap: number
  edgeLengthExcess: number
  /** Mean edge length expressed in units of mean node dimension. ~3 = tight, >6 = sprawling. */
  edgeLengthMean: number
  /** Longest edge in node-size units. >8 means a single edge spans the canvas. */
  edgeLengthMax: number
  /** Σ over leaf nodes of (1 − distance-from-centroid / max-radius)².
   *  Penalises low-degree nodes sitting near the centre of mass. */
  leafCentrality: number
  aspectPenalty: number
  compactness: number
  symmetryDeficit: number
  composite: number
}

// Empirically-tuned weights, revised after observing real failure modes
// (Person/External-System placed centrally with very long edges through
// the diagram). Two new dominant signals:
//   - edgeLengthMean: catches uniformly-spread layouts the old
//     edgeLengthExcess (outliers only) couldn't see.
//   - leafCentrality: pushes degree-1/2 nodes to the periphery so they
//     stop sitting between two clusters and crossing everything.
const W_CROSS    = 80
const W_OVERDRAW = 12
const W_STUBLOOP = 30
const W_OVERLAP  = 150  // raised from 50 — SA was happy to push leaves *into*
                        //   foreign compound containers if it shortened edges.
                        //   With knee=5 on edgeLengthMax that bias was strong.
const W_LONG     = 5    // edgeLengthExcess (long-tail outliers)
const W_LMEAN    = 25   // edgeLengthMean (global tightness)
const W_LMAX     = 30   // edgeLengthMax (single longest edge in node-sizes) — NEW
                        //   catches diagrams where mean is fine but one edge
                        //   spans the whole canvas (the failure mode in the
                        //   tall-layout screenshot — a few super-long verticals
                        //   between top and bottom system).
const W_LEAF     = 20   // leafCentrality
const W_ASPECT   = 30   // raised from 10 — tall (>2:1) layouts are very hard
                        //   to read in any presentation viewport. Combined with
                        //   the new cubic exponent below this dominates SA's
                        //   choice between portrait and landscape arrangements.
const W_COMPACT  = 8
const W_SYMMETRY = 4

function buildAbsCenters(
  nodes: Record<string, C4Node>,
): Record<string, { x: number; y: number; w: number; h: number; cx: number; cy: number }> {
  const memo: Record<string, { x: number; y: number }> = {}
  const absXY = (id: string): { x: number; y: number } => {
    if (memo[id]) return memo[id]
    const n = nodes[id]
    if (!n) return { x: 0, y: 0 }
    if (!n.parentId) memo[id] = { x: n.x, y: n.y }
    else {
      const p = absXY(n.parentId)
      memo[id] = { x: p.x + n.x, y: p.y + n.y }
    }
    return memo[id]
  }
  const out: Record<string, { x: number; y: number; w: number; h: number; cx: number; cy: number }> = {}
  for (const n of Object.values(nodes)) {
    const a = absXY(n.id)
    out[n.id] = {
      x: a.x, y: a.y, w: n.width, h: n.height,
      cx: a.x + n.width / 2, cy: a.y + n.height / 2,
    }
  }
  return out
}

function buildAncestors(nodes: Record<string, C4Node>): Record<string, Set<string>> {
  const out: Record<string, Set<string>> = {}
  for (const n of Object.values(nodes)) {
    const set = new Set<string>()
    let cur: C4Node | undefined = n
    while (cur?.parentId) {
      set.add(cur.parentId)
      cur = nodes[cur.parentId]
    }
    out[n.id] = set
  }
  return out
}

/**
 * Render-aware edge metrics.
 *
 * Edges are rendered as **cubic Béziers** (see RelationEdge.tsx → buildBezierPath)
 * with control points pulled along each endpoint's exit normal. The chosen
 * exit/entry side comes from pickSides() in portAllocator.ts using the
 * "nearest-point of OTHER box" heuristic. We replicate the exact same
 * geometry here, sample each Bézier on N points, and score the resulting
 * polylines:
 *
 *   - **renderedCrossings**: count segment×segment intersections between
 *     sampled polylines of different edges (excluding edges sharing an
 *     endpoint, which trivially "meet").
 *   - **renderedOverdraws**: sample points landing inside an unrelated
 *     node's bbox — catches Béziers that swing through a third node.
 *   - **stubLoopPenalty**: if the exit-normal at an endpoint points away
 *     from the target (dot product with the source→target vector is
 *     negative), the curve loops back. Heavily penalised because it's
 *     the most visually offensive failure mode.
 */
function borderPoint(
  bx: number, by: number, w: number, h: number, side: Position,
): { x: number; y: number; nx: number; ny: number } {
  // Returns border point + outward unit normal.
  switch (side) {
    case Position.Left:   return { x: bx,         y: by + h / 2, nx: -1, ny: 0 }
    case Position.Right:  return { x: bx + w,     y: by + h / 2, nx:  1, ny: 0 }
    case Position.Top:    return { x: bx + w / 2, y: by,         nx:  0, ny: -1 }
    case Position.Bottom: return { x: bx + w / 2, y: by + h,     nx:  0, ny:  1 }
  }
}

function sampleCubicBezier(
  sx: number, sy: number, c1x: number, c1y: number,
  c2x: number, c2y: number, tx: number, ty: number,
  n: number,
): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = new Array(n + 1)
  for (let i = 0; i <= n; i++) {
    const t = i / n
    const u = 1 - t
    const b0 = u * u * u
    const b1 = 3 * u * u * t
    const b2 = 3 * u * t * t
    const b3 = t * t * t
    out[i] = {
      x: b0 * sx + b1 * c1x + b2 * c2x + b3 * tx,
      y: b0 * sy + b1 * c1y + b2 * c2y + b3 * ty,
    }
  }
  return out
}

function segmentsCross(
  ax: number, ay: number, bx: number, by: number,
  cx: number, cy: number, dx: number, dy: number,
): boolean {
  const d1 = (cx - ax) * (by - ay) - (cy - ay) * (bx - ax)
  const d2 = (dx - ax) * (by - ay) - (dy - ay) * (bx - ax)
  const d3 = (ax - cx) * (dy - cy) - (ay - cy) * (dx - cx)
  const d4 = (bx - cx) * (dy - cy) - (by - cy) * (dx - cx)
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
         ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
}

function pointInBox(
  px: number, py: number,
  bx: number, by: number, bw: number, bh: number,
  pad = 0,
): boolean {
  return px >= bx - pad && px <= bx + bw + pad
      && py >= by - pad && py <= by + bh + pad
}

interface RenderMetrics {
  renderedCrossings: number
  renderedOverdraws: number
  stubLoopPenalty: number
}

function computeRenderAwareEdgeMetrics(
  nodes: Record<string, C4Node>,
  relations: Record<string, C4Relation>,
  abs: Record<string, { x: number; y: number; w: number; h: number; cx: number; cy: number }>,
  ancestors: Record<string, Set<string>>,
): RenderMetrics {
  const edges = Object.values(relations).filter((r) => abs[r.sourceId] && abs[r.targetId])
  // 16 segments per edge — captures Bézier curvature with enough resolution
  // to detect when a curve grazes a narrow node (e.g. a Database cylinder).
  // 8 was occasionally letting overdraw through.
  const SAMPLES = 16
  // Pre-build all sample polylines + endpoints.
  const polys: { samples: { x: number; y: number }[]; sId: string; tId: string }[] = []
  let stubLoopPenalty = 0

  for (const e of edges) {
    const sn = abs[e.sourceId], tn = abs[e.targetId]
    // Replicate exactly what portAllocator.pickSides + RelationEdge does.
    const view = (n: typeof sn, id: string) => ({
      id, positionAbsolute: { x: n.x, y: n.y }, width: n.w, height: n.h,
    })
    const { sSide, tSide } = pickSides(view(sn, e.sourceId), view(tn, e.targetId))
    const sb = borderPoint(sn.x, sn.y, sn.w, sn.h, sSide)
    const tb = borderPoint(tn.x, tn.y, tn.w, tn.h, tSide)
    const dist = Math.hypot(tb.x - sb.x, tb.y - sb.y)
    const pull = Math.min(180, Math.max(40, dist * 0.5))
    const c1x = sb.x + sb.nx * pull, c1y = sb.y + sb.ny * pull
    const c2x = tb.x + tb.nx * pull, c2y = tb.y + tb.ny * pull

    // Stub-loop penalty: exit normal vs source→target direction.
    // dot < 0 means the curve initially shoots *away* from the target.
    if (dist > 0) {
      const ux = (tb.x - sb.x) / dist, uy = (tb.y - sb.y) / dist
      const dotS = sb.nx * ux + sb.ny * uy           // source-side
      const dotT = -(tb.nx * ux + tb.ny * uy)        // target-side (incoming)
      // Convert dot ∈ [-1, 1] to penalty: only negative values count,
      // and squared so a sharp loop is much worse than a gentle backstep.
      if (dotS < 0) stubLoopPenalty += dotS * dotS
      if (dotT < 0) stubLoopPenalty += dotT * dotT
    }

    polys.push({
      samples: sampleCubicBezier(sb.x, sb.y, c1x, c1y, c2x, c2y, tb.x, tb.y, SAMPLES),
      sId: e.sourceId,
      tId: e.targetId,
    })
  }

  // Crossings on actual sampled polylines.
  let renderedCrossings = 0
  for (let i = 0; i < polys.length; i++) {
    const A = polys[i]
    for (let j = i + 1; j < polys.length; j++) {
      const B = polys[j]
      // Edges sharing an endpoint trivially "meet" — don't count those.
      if (A.sId === B.sId || A.sId === B.tId || A.tId === B.sId || A.tId === B.tId) continue
      let crossed = false
      // Inner double loop — break early once we found one crossing per pair.
      // (One "crossing" between two edges is the same visual artefact whether
      //  the polylines tangentially intersect 1 or 3 times.)
      for (let a = 0; a < A.samples.length - 1 && !crossed; a++) {
        const p = A.samples[a], q = A.samples[a + 1]
        for (let b = 0; b < B.samples.length - 1; b++) {
          const r = B.samples[b], s = B.samples[b + 1]
          if (segmentsCross(p.x, p.y, q.x, q.y, r.x, r.y, s.x, s.y)) {
            crossed = true
            break
          }
        }
      }
      if (crossed) renderedCrossings++
    }
  }

  // Overdraws: sample points landing in unrelated bboxes.
  // We tolerate the first/last sample (which is on the source/target border).
  const ids = Object.keys(abs)
  let renderedOverdraws = 0
  for (const P of polys) {
    const seen = new Set<string>()
    for (let i = 1; i < P.samples.length - 1; i++) {
      const pt = P.samples[i]
      for (const id of ids) {
        if (id === P.sId || id === P.tId) continue
        // Skip ancestors of source/target — the edge is inside a parent box.
        if (ancestors[P.sId]?.has(id) || ancestors[P.tId]?.has(id)) continue
        if (seen.has(id)) continue
        const r = abs[id]
        // Skip parent-of-someone if the sample is also in some descendant box;
        // we still penalise once per (edge, container) pair to avoid over-counting.
        if (pointInBox(pt.x, pt.y, r.x, r.y, r.w, r.h, -2)) {
          renderedOverdraws++
          seen.add(id)
        }
      }
    }
  }

  return { renderedCrossings, renderedOverdraws, stubLoopPenalty }
}

export function computeCompositeScore(
  nodes: Record<string, C4Node>,
  relations: Record<string, C4Relation>,
): CompositeScore {
  const base = computeLayoutMetrics(nodes, relations)
  const abs = buildAbsCenters(nodes)
  const ancestors = buildAncestors(nodes)
  const ids = Object.keys(abs)

  // ── 0. Render-aware edge metrics (Bézier-sampled, matches what user sees) ─
  const render = computeRenderAwareEdgeMetrics(nodes, relations, abs, ancestors)


  // ── 1. Pairwise sibling node overlap (area, normalised to mean area) ──
  let overlapArea = 0
  let totalArea = 0
  for (const r of Object.values(abs)) totalArea += r.w * r.h
  const meanArea = totalArea / Math.max(ids.length, 1)
  for (let i = 0; i < ids.length; i++) {
    const a = abs[ids[i]]
    for (let j = i + 1; j < ids.length; j++) {
      const b = abs[ids[j]]
      // Skip ancestor/descendant pairs — a child is *expected* to overlap its parent.
      if (ancestors[ids[i]]?.has(ids[j])) continue
      if (ancestors[ids[j]]?.has(ids[i])) continue
      const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
      const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
      if (ox > 0 && oy > 0) overlapArea += ox * oy
    }
  }
  const nodeOverlap = meanArea > 0 ? overlapArea / meanArea : 0

  // ── 2. Edge-length excess: edges far longer than median count ──────────
  const edges = Object.values(relations).filter((r) => abs[r.sourceId] && abs[r.targetId])
  const lengths = edges.map((r) => {
    const a = abs[r.sourceId]
    const b = abs[r.targetId]
    return Math.hypot(a.cx - b.cx, a.cy - b.cy)
  }).sort((x, y) => x - y)
  const median = lengths.length > 0 ? lengths[Math.floor(lengths.length / 2)] : 0
  let lengthExcess = 0
  if (median > 0) {
    for (const len of lengths) {
      const ratio = len / median
      if (ratio > 1.8) lengthExcess += (ratio - 1.8) ** 2
    }
  }

  // ── 2b. Mean edge length normalised to mean node dimension ───────────
  // Davidson-Harel uses total edge length as a primary cost. The
  // "excess" metric above only catches outliers, so a uniformly-spread
  // layout (every edge 3× too long) scores zero there. This catches it.
  let meanDimForLen = 0
  for (const r of Object.values(abs)) meanDimForLen += (r.w + r.h) / 2
  meanDimForLen = ids.length > 0 ? meanDimForLen / ids.length : 1
  const meanLen = lengths.length > 0
    ? lengths.reduce((s, l) => s + l, 0) / lengths.length
    : 0
  // Express mean edge length in "node sizes". Below 3 is tight (good),
  // above 5 is spread, above 8 is bad. Quadratic above the threshold.
  const lenInNodes = meanDimForLen > 0 ? meanLen / meanDimForLen : 0
  const edgeLengthMean = Math.max(0, lenInNodes - 3) ** 2

  // ── 2d. Edge-length MAX in node sizes ─────────────────────────────────
  // Mean is misleading when many short intra-container edges drag it down
  // while a handful of cross-system verticals span the whole canvas (the
  // failure mode in the tall-layout screenshot). Penalise the longest
  // edge separately, with a knee at 8 node-sizes.
  const maxLen = lengths.length > 0 ? lengths[lengths.length - 1] : 0
  const maxInNodes = meanDimForLen > 0 ? maxLen / meanDimForLen : 0
  const edgeLengthMax = Math.max(0, maxInNodes - 5) ** 2

  // ── 2c. Leaf centrality ─ low-degree nodes should sit on the periphery ─
  // Compute degree from relations. Compound-children of a low-degree leaf
  // do *not* inherit its degree; this is intentional — a Container with no
  // outside edges but full of components is internally rich, not a leaf.
  const degree: Record<string, number> = {}
  for (const id of ids) degree[id] = 0
  for (const r of Object.values(relations)) {
    if (degree[r.sourceId] !== undefined) degree[r.sourceId]++
    if (degree[r.targetId] !== undefined) degree[r.targetId]++
  }
  // Centroid + max radius for normalisation.
  let cmX = 0, cmY = 0
  for (const id of ids) { cmX += abs[id].cx; cmY += abs[id].cy }
  cmX /= Math.max(ids.length, 1); cmY /= Math.max(ids.length, 1)
  let maxR = 0
  for (const id of ids) {
    const dx = abs[id].cx - cmX, dy = abs[id].cy - cmY
    const d = Math.hypot(dx, dy)
    if (d > maxR) maxR = d
  }
  let leafCentrality = 0
  if (maxR > 0) {
    for (const id of ids) {
      const deg = degree[id]
      // Only score "truly external" leaves — degree 1 or 2.
      if (deg < 1 || deg > 2) continue
      // Skip nodes that are children of a compound — they sit where their
      // parent puts them, not where the algorithm chose.
      if (nodes[id]?.parentId) continue
      const dx = abs[id].cx - cmX, dy = abs[id].cy - cmY
      const d = Math.hypot(dx, dy)
      // 1.0 at centre, 0.0 on the periphery. Square so it really hurts
      // when External-System sits between two clusters.
      const central = 1 - d / maxR
      // Higher penalty for degree-1 (pure leaves like Person actor).
      const degWeight = deg === 1 ? 1.0 : 0.5
      leafCentrality += degWeight * central * central
    }
  }

  // ── 3. Aspect ratio penalty (favour ~sqrt(2)) ──────────────────────────
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const r of Object.values(abs)) {
    if (r.x < minX) minX = r.x
    if (r.y < minY) minY = r.y
    if (r.x + r.w > maxX) maxX = r.x + r.w
    if (r.y + r.h > maxY) maxY = r.y + r.h
  }
  const bbW = maxX - minX, bbH = maxY - minY
  let aspectPenalty = 0
  if (bbW > 0 && bbH > 0) {
    const ar = Math.max(bbW / bbH, bbH / bbW)
    const TARGET = Math.SQRT2  // ≈ 1.414, golden-ish
    // Cubic instead of quadratic — a 2.5:1 portrait layout (the screenshot
    // failure mode) was scoring ar-target ≈ 1.1, squared ≈ 1.2, basically
    // negligible. Cubed ≈ 1.3 × W_ASPECT(30) = 40, which finally dominates
    // the swap between a tall single-column layout and a square one.
    aspectPenalty = Math.max(0, ar - TARGET) ** 3
  }

  // ── 4. Compactness: bbox area / sum of node areas ─────────────────────
  let compactness = 0
  if (bbW > 0 && bbH > 0 && totalArea > 0) {
    const ratio = (bbW * bbH) / totalArea
    // Below 4 is excellent (near-tight packing). Above 12 is sprawling.
    compactness = Math.max(0, ratio - 4)
  }

  const symDeficit = symmetryDeficitFn(abs, ids)
  // Normalise symmetry to mean node dimension so it scales sensibly.
  let meanDim = 0
  for (const r of Object.values(abs)) meanDim += (r.w + r.h) / 2
  meanDim = ids.length > 0 ? meanDim / ids.length : 1
  const symNorm = meanDim > 0 ? symDeficit / meanDim : 0

  const composite =
      render.renderedCrossings * W_CROSS
    + render.renderedOverdraws * W_OVERDRAW
    + render.stubLoopPenalty   * W_STUBLOOP
    + nodeOverlap              * W_OVERLAP
    + nodeOverlap * nodeOverlap * W_OVERLAP * 5  // quadratic shock — any overlap > ~30%
                                                  // dwarfs every aesthetic gain. Keeps SA
                                                  // from shoving leaves into compounds.
    + lengthExcess             * W_LONG
    + edgeLengthMean           * W_LMEAN
    + edgeLengthMax            * W_LMAX
    + leafCentrality           * W_LEAF
    + aspectPenalty            * W_ASPECT
    + compactness              * W_COMPACT
    + symNorm                  * W_SYMMETRY

  return {
    crossings: base.crossings,
    renderedCrossings: render.renderedCrossings,
    overdraws: base.overdraws,
    renderedOverdraws: render.renderedOverdraws,
    stubLoopPenalty: render.stubLoopPenalty,
    nodeOverlap,
    edgeLengthExcess: lengthExcess,
    edgeLengthMean,
    edgeLengthMax,
    leafCentrality,
    aspectPenalty,
    compactness,
    symmetryDeficit: symNorm,
    composite,
  }
}

// Renamed inner function to avoid collision with the (now-exported) field name.
function symmetryDeficitFn(
  abs: Record<string, { cx: number; cy: number }>,
  ids: string[],
): number {
  if (ids.length < 4) return 0
  let cx = 0, cy = 0
  for (const id of ids) { cx += abs[id].cx; cy += abs[id].cy }
  cx /= ids.length; cy /= ids.length
  const computeAxis = (flipX: boolean): number => {
    let total = 0
    let count = 0
    for (const id of ids) {
      const a = abs[id]
      const ra = flipX
        ? { x: 2 * cx - a.cx, y: a.cy }
        : { x: a.cx, y: 2 * cy - a.cy }
      let best = Infinity
      for (const id2 of ids) {
        if (id2 === id) continue
        const b = abs[id2]
        const d = Math.hypot(ra.x - b.cx, ra.y - b.cy)
        if (d < best) best = d
      }
      total += best
      count++
    }
    return count > 0 ? total / count : 0
  }
  return Math.min(computeAxis(true), computeAxis(false))
}


// ─── Shared spacing baseline ──────────────────────────────────────────────

const COMMON_SPACING: LayoutOptions = {
  'elk.spacing.nodeNode': '60',
  'elk.layered.spacing.nodeNodeBetweenLayers': '80',
  'elk.spacing.edgeNode': '20',
  'elk.spacing.edgeEdge': '10',
  'elk.layered.unnecessaryBendpoints': 'true',
  'elk.layered.compaction.postCompaction.strategy': 'EDGE_LENGTH',
  'elk.padding': '[top=40, right=30, bottom=30, left=30]',
  'elk.separateConnectedComponents': 'true',
  'elk.spacing.componentComponent': '80',
  'elk.layered.thoroughness': '50',
  'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
  'elk.layered.crossingMinimization.greedySwitch.type': 'TWO_SIDED',
}

const CHILD_SPACING: LayoutOptions = {
  ...COMMON_SPACING,
  'elk.spacing.nodeNode': '30',
  'elk.layered.spacing.nodeNodeBetweenLayers': '50',
  'elk.spacing.edgeNode': '12',
  'elk.spacing.edgeEdge': '8',
  'elk.padding': '[top=40, right=20, bottom=20, left=20]',
  'elk.spacing.componentComponent': '40',
}

function elkLayered(
  direction: 'DOWN' | 'RIGHT',
  placement: 'BRANDES_KOEPF' | 'NETWORK_SIMPLEX',
  modelOrder: boolean,
  layering: 'NETWORK_SIMPLEX' | 'LONGEST_PATH' | 'COFFMAN_GRAHAM' | 'MIN_WIDTH' = 'NETWORK_SIMPLEX',
): LayoutOptions {
  return {
    ...COMMON_SPACING,
    'elk.algorithm': 'layered',
    'elk.direction': direction,
    'elk.layered.layering.strategy': layering,
    'elk.layered.nodePlacement.strategy': placement,
    'elk.layered.considerModelOrder.strategy': modelOrder ? 'NODES_AND_EDGES' : 'NONE',
    // Let ELK shape the bounding box (matches our composite aspectPenalty).
    'elk.aspectRatio': '1.4',
  }
}

function elkLayeredChild(
  direction: 'DOWN' | 'RIGHT',
  placement: 'BRANDES_KOEPF' | 'NETWORK_SIMPLEX',
): LayoutOptions {
  return {
    ...CHILD_SPACING,
    'elk.algorithm': 'layered',
    'elk.direction': direction,
    'elk.layered.nodePlacement.strategy': placement,
    'elk.layered.considerModelOrder.strategy': 'NONE',
  }
}

/**
 * Stress-majorisation layout (Gansner et al. 2005). Treats every edge as
 * a spring whose ideal length is its graph-theoretic distance, then
 * minimises a stress functional. Excellent for sparse near-planar graphs
 * — often produces zero crossings on series-parallel structures.
 */
function elkStress(): LayoutOptions {
  return {
    'elk.algorithm': 'stress',
    'elk.stress.desiredEdgeLength': '180',
    'elk.stress.epsilon': '0.0001',
    'elk.stress.iterationLimit': '600',
    'elk.spacing.nodeNode': '60',
    'elk.padding': '[top=40, right=30, bottom=30, left=30]',
    'elk.separateConnectedComponents': 'true',
    'elk.spacing.componentComponent': '80',
  }
}

/**
 * Eades-style force-directed layout. Nodes repel by Coulomb, edges
 * attract by Hooke. Uncovers symmetric / clustered topologies that
 * Sugiyama linearises into a flat row.
 */
function elkForce(): LayoutOptions {
  return {
    'elk.algorithm': 'force',
    'elk.force.iterations': '400',
    'elk.force.repulsivePower': '0',
    'elk.force.temperature': '0.001',
    'elk.spacing.nodeNode': '70',
    'elk.padding': '[top=40, right=30, bottom=30, left=30]',
    'elk.separateConnectedComponents': 'true',
    'elk.spacing.componentComponent': '80',
  }
}

/**
 * Mr.Tree — multi-rooted tree layout, Reingold-Tilford-ish. Wins outright
 * when the relation graph is an arborescence (≥ 90 % of edges form a
 * spanning tree). On general graphs it produces garbage, so the ensemble
 * will reject it via crossing count.
 */
function elkMrTree(): LayoutOptions {
  return {
    'elk.algorithm': 'mrtree',
    'elk.spacing.nodeNode': '60',
    'elk.padding': '[top=40, right=30, bottom=30, left=30]',
    'elk.separateConnectedComponents': 'true',
    'elk.spacing.componentComponent': '80',
  }
}

// ─── Metamodel-derived containment rank ───────────────────────────────────

function maxContainmentDepth(mm?: Metamodel): number {
  if (!mm) return 1
  const types = Object.values(mm.nodeTypes)
  if (types.length === 0) return 0
  const depthOf = (id: string, seen: Set<string>): number => {
    if (seen.has(id)) return 0
    seen.add(id)
    const t = mm.nodeTypes[id]
    if (!t) return 0
    const parents = t.allowedParents ?? []
    if (parents.length === 0) return 0
    let max = 0
    for (const p of parents) {
      const d = depthOf(p, seen) + 1
      if (d > max) max = d
    }
    return max
  }
  let max = 0
  for (const t of types) {
    const d = depthOf(t.id, new Set())
    if (d > max) max = d
  }
  return max
}

// ─── Planarity / skewness proxy ───────────────────────────────────────────
//
// True planarity testing (Boyer-Myrvold, O(n)) and exact skewness are
// expensive and not actionable for the user. We surface a fast geometric
// proxy: the *crossing-edge ratio* — fraction of edges that participate
// in ≥ 1 crossing in the current straight-line drawing. For a planar
// drawing this is 0; for K5 it is 1.0. This is what the user actually
// perceives as "messy".

export interface PlanarityScore {
  /** Number of edges that cross at least one other edge. */
  crossingEdges: number
  /** Total edges considered (those whose endpoints are positioned). */
  totalEdges: number
  /** crossingEdges / totalEdges, ∈ [0, 1]. */
  ratio: number
  /** Verdict label ('planar' | 'near-planar' | 'tangled'). */
  verdict: 'planar' | 'near-planar' | 'tangled'
}

function computePlanarityScore(
  nodes: Record<string, C4Node>,
  relations: Record<string, C4Relation>,
): PlanarityScore {
  const memo: Record<string, { x: number; y: number }> = {}
  const absXY = (id: string): { x: number; y: number } => {
    if (memo[id]) return memo[id]
    const n = nodes[id]
    if (!n) return { x: 0, y: 0 }
    if (!n.parentId) memo[id] = { x: n.x, y: n.y }
    else {
      const p = absXY(n.parentId)
      memo[id] = { x: p.x + n.x, y: p.y + n.y }
    }
    return memo[id]
  }
  const abs: Record<string, { cx: number; cy: number }> = {}
  for (const n of Object.values(nodes)) {
    const a = absXY(n.id)
    abs[n.id] = { cx: a.x + n.width / 2, cy: a.y + n.height / 2 }
  }

  const ccw = (
    ax: number, ay: number,
    bx: number, by: number,
    cx: number, cy: number,
  ): boolean => (cy - ay) * (bx - ax) > (by - ay) * (cx - ax)

  const edges = Object.values(relations).filter((r) => abs[r.sourceId] && abs[r.targetId])
  const crossed = new Set<string>()

  for (let i = 0; i < edges.length; i++) {
    const a = edges[i]
    const a1 = abs[a.sourceId]
    const a2 = abs[a.targetId]
    for (let j = i + 1; j < edges.length; j++) {
      const b = edges[j]
      if (a.sourceId === b.sourceId || a.sourceId === b.targetId
       || a.targetId === b.sourceId || a.targetId === b.targetId) continue
      const b1 = abs[b.sourceId]
      const b2 = abs[b.targetId]
      const cross =
        ccw(a1.cx, a1.cy, b1.cx, b1.cy, b2.cx, b2.cy) !==
          ccw(a2.cx, a2.cy, b1.cx, b1.cy, b2.cx, b2.cy) &&
        ccw(a1.cx, a1.cy, a2.cx, a2.cy, b1.cx, b1.cy) !==
          ccw(a1.cx, a1.cy, a2.cx, a2.cy, b2.cx, b2.cy)
      if (cross) {
        crossed.add(a.id)
        crossed.add(b.id)
      }
    }
  }

  const total = edges.length
  const ratio = total === 0 ? 0 : crossed.size / total
  const verdict: PlanarityScore['verdict'] =
    crossed.size === 0 ? 'planar' : ratio < 0.15 ? 'near-planar' : 'tangled'

  return { crossingEdges: crossed.size, totalEdges: total, ratio, verdict }
}

// ─── Simulated-annealing position refinement ──────────────────────────────
//
// Davidson-Harel 1996. After the ensemble winner is chosen, perturb each
// root-level node's position by Gaussian noise (subtree shifts together
// because root-relative children inherit the parent's translation
// implicitly — we only mutate root-level (x, y)). Accept the new
// arrangement with Metropolis probability exp(-ΔE / T); cool T
// geometrically.
//
// Why this matters: ELK's layered already runs sibling-swap per layer,
// but it cannot move a node *between layers* or shift one root by 200 px
// to clear a crossing. SA can — and it escapes the local minima where
// greedy sibling-swap (crossingOpt.ts) gets stuck.

interface SARefinement {
  positions: PositionMap
  before: number
  after: number
  iterations: number
}

// ─── Fast SA energy: precomputed context + incremental abs ──────────────
//
// SA evaluates energy thousands of times per chain. The original
// proxy implementation rebuilt ancestors / abs / edge-list / mean-area
// on every call (and internally `computeLayoutMetrics` rebuilt them again
// — double work). All of these are *invariant* during SA (topology +
// node dimensions never change — only positions). Hoisting them into a
// context cuts per-eval cost roughly in half and removes per-call
// allocations.
//
// Additional incremental win: when SA perturbs a single root, only that
// root's *subtree* changes absolute position. We shift those entries in
// `ctx.abs` in-place by (dx, dy) and revert on rejection — no full rebuild.
//
// Net effect: ~3–5× more SA iterations in the same wall-clock budget.

interface AbsRect {
  x: number; y: number; w: number; h: number; cx: number; cy: number
}

interface EnergyContext {
  ids: string[]                         // all node ids (stable order)
  edgesSrc: string[]                    // parallel arrays = no per-call .filter()
  edgesTgt: string[]
  edgeCount: number
  ancestors: Record<string, Set<string>>
  descendants: Record<string, string[]> // closure of children, for incremental shifts
  meanDim: number                       // constant — node W/H never change
  meanArea: number                      // constant
  abs: Record<string, AbsRect>          // mutable buffer, reused across evals
}

function buildDescendants(nodes: Record<string, C4Node>): Record<string, string[]> {
  const children: Record<string, string[]> = {}
  for (const n of Object.values(nodes)) {
    if (n.parentId) (children[n.parentId] ??= []).push(n.id)
  }
  const descendants: Record<string, string[]> = {}
  const collect = (id: string, out: string[]): void => {
    out.push(id)
    const kids = children[id]
    if (kids) for (const c of kids) collect(c, out)
  }
  for (const id of Object.keys(nodes)) {
    const out: string[] = []
    collect(id, out)
    descendants[id] = out
  }
  return descendants
}

function buildEnergyContext(
  nodes: Record<string, C4Node>,
  relations: Record<string, C4Relation>,
): EnergyContext {
  const ids = Object.keys(nodes)
  const ancestors = buildAncestors(nodes)
  const descendants = buildDescendants(nodes)

  let totalArea = 0
  let meanDimSum = 0
  for (const id of ids) {
    const n = nodes[id]
    totalArea += n.width * n.height
    meanDimSum += (n.width + n.height) / 2
  }
  const meanArea = totalArea / Math.max(ids.length, 1)
  const meanDim = ids.length > 0 ? meanDimSum / ids.length : 1

  const edgesSrc: string[] = []
  const edgesTgt: string[] = []
  for (const r of Object.values(relations)) {
    if (nodes[r.sourceId] && nodes[r.targetId]) {
      edgesSrc.push(r.sourceId)
      edgesTgt.push(r.targetId)
    }
  }

  const abs: Record<string, AbsRect> = {}
  for (const id of ids) {
    const n = nodes[id]
    abs[id] = { x: 0, y: 0, w: n.width, h: n.height, cx: 0, cy: 0 }
  }

  return {
    ids,
    edgesSrc, edgesTgt, edgeCount: edgesSrc.length,
    ancestors, descendants,
    meanDim, meanArea,
    abs,
  }
}

/** Full abs rebuild from current `work` positions. O(N + ΣdepthChain). */
function recomputeAbs(work: Record<string, C4Node>, ctx: EnergyContext): void {
  const visited = new Set<string>()
  const visit = (id: string): void => {
    if (visited.has(id)) return
    const n = work[id]
    if (!n) { visited.add(id); return }
    const a = ctx.abs[id]
    if (!a) { visited.add(id); return }
    if (!n.parentId) {
      a.x = n.x; a.y = n.y
    } else {
      visit(n.parentId)
      const p = ctx.abs[n.parentId]
      if (p) { a.x = p.x + n.x; a.y = p.y + n.y }
      else { a.x = n.x; a.y = n.y }
    }
    a.cx = a.x + a.w / 2
    a.cy = a.y + a.h / 2
    visited.add(id)
  }
  for (const id of ctx.ids) visit(id)
}

/** Shift a node's whole subtree in `ctx.abs` by (dx, dy). O(|subtree|). */
function shiftSubtreeAbs(rootId: string, dx: number, dy: number, ctx: EnergyContext): void {
  const sub = ctx.descendants[rootId]
  if (!sub) return
  for (const id of sub) {
    const a = ctx.abs[id]
    if (a) { a.x += dx; a.y += dy; a.cx += dx; a.cy += dy }
  }
}

// Geometry primitives inlined to avoid Point/Rect object allocations
// inside the hot loop. Mirrors crossingOpt.ts: strict CCW intersection,
// rect shrunk by 1 px so grazing edges don't count as overdraw.
function _segCrossXY(
  ax: number, ay: number, bx: number, by: number,
  cx: number, cy: number, dx: number, dy: number,
): boolean {
  const o1 = (dy - cy) * (bx - cx) - (by - cy) * (dx - cx) > 0
  const o2 = (dy - cy) * (ax - cx) - (ay - cy) * (dx - cx) > 0
  if (o1 === o2) return false
  const o3 = (by - ay) * (cx - ax) - (cy - ay) * (bx - ax) > 0
  const o4 = (by - ay) * (dx - ax) - (dy - ay) * (bx - ax) > 0
  return o3 !== o4
}

function _segHitsRect(
  px: number, py: number, qx: number, qy: number,
  rx: number, ry: number, rw: number, rh: number,
): boolean {
  const x0 = rx + 1, y0 = ry + 1
  const x1 = rx + rw - 1, y1 = ry + rh - 1
  if (x1 <= x0 || y1 <= y0) return false
  if (px > x0 && px < x1 && py > y0 && py < y1) return true
  if (qx > x0 && qx < x1 && qy > y0 && qy < y1) return true
  // Liang-Barsky-style: clip segment against rect.
  let t0 = 0, t1 = 1
  const ddx = qx - px, ddy = qy - py
  const ps = [-ddx, ddx, -ddy, ddy]
  const qs = [px - x0, x1 - px, py - y0, y1 - py]
  for (let i = 0; i < 4; i++) {
    if (ps[i] === 0) {
      if (qs[i] < 0) return false
    } else {
      const t = qs[i] / ps[i]
      if (ps[i] < 0) { if (t > t1) return false; if (t > t0) t0 = t }
      else            { if (t < t0) return false; if (t < t1) t1 = t }
    }
  }
  return true
}

/**
 * Context-based energy proxy used inside the SA inner loop.
 *
 * Hot inner loop — avoids:
 *   - rebuilding ancestors / abs / edge-list / mean-area / mean-dim
 *   - calls to computeLayoutMetrics (which would rebuild them again)
 *   - Object.values / Object.keys allocations
 *   - Math.hypot (sqrt is amortised — total length only)
 *
 * Caller MUST keep `ctx.abs` in sync with `work` (via recomputeAbs once,
 * then shiftSubtreeAbs for incremental moves).
 */
function proxyEnergyCtx(ctx: EnergyContext): number {
  const { ids, edgesSrc, edgesTgt, edgeCount, ancestors, meanDim, meanArea, abs } = ctx
  const N = ids.length

  // Crossings + overdraws.
  let crossings = 0
  let overdraws = 0
  for (let i = 0; i < edgeCount; i++) {
    const a_src = edgesSrc[i], a_tgt = edgesTgt[i]
    const r1 = abs[a_src], r2 = abs[a_tgt]
    const p1x = r1.cx, p1y = r1.cy
    const p2x = r2.cx, p2y = r2.cy
    const srcAnc = ancestors[a_src]
    const tgtAnc = ancestors[a_tgt]

    for (let k = 0; k < N; k++) {
      const nid = ids[k]
      if (nid === a_src || nid === a_tgt) continue
      if (srcAnc && srcAnc.has(nid)) continue
      if (tgtAnc && tgtAnc.has(nid)) continue
      const r = abs[nid]
      if (_segHitsRect(p1x, p1y, p2x, p2y, r.x, r.y, r.w, r.h)) overdraws++
    }

    for (let j = i + 1; j < edgeCount; j++) {
      const b_src = edgesSrc[j], b_tgt = edgesTgt[j]
      if (a_src === b_src || a_src === b_tgt || a_tgt === b_src || a_tgt === b_tgt) continue
      const r3 = abs[b_src], r4 = abs[b_tgt]
      if (_segCrossXY(p1x, p1y, p2x, p2y, r3.cx, r3.cy, r4.cx, r4.cy)) crossings++
    }
  }

  // Pairwise sibling overlap (skip ancestor/descendant pairs).
  let overlapArea = 0
  for (let i = 0; i < N; i++) {
    const id_i = ids[i]
    const a = abs[id_i]
    const anc_i = ancestors[id_i]
    const ax2 = a.x + a.w
    const ay2 = a.y + a.h
    for (let j = i + 1; j < N; j++) {
      const id_j = ids[j]
      if (anc_i && anc_i.has(id_j)) continue
      const anc_j = ancestors[id_j]
      if (anc_j && anc_j.has(id_i)) continue
      const b = abs[id_j]
      const ox = (ax2 < b.x + b.w ? ax2 : b.x + b.w) - (a.x > b.x ? a.x : b.x)
      if (ox <= 0) continue
      const oy = (ay2 < b.y + b.h ? ay2 : b.y + b.h) - (a.y > b.y ? a.y : b.y)
      if (oy <= 0) continue
      overlapArea += ox * oy
    }
  }
  const overlap = meanArea > 0 ? overlapArea / meanArea : 0

  // Edge length stats (squared lengths first; sqrt only for final mean+max).
  let totalLen = 0
  let maxLenSq = 0
  for (let i = 0; i < edgeCount; i++) {
    const a = abs[edgesSrc[i]], b = abs[edgesTgt[i]]
    const dx = a.cx - b.cx, dy = a.cy - b.cy
    const lenSq = dx * dx + dy * dy
    totalLen += Math.sqrt(lenSq)
    if (lenSq > maxLenSq) maxLenSq = lenSq
  }
  const meanLen = edgeCount > 0 ? totalLen / edgeCount : 0
  const maxLen = Math.sqrt(maxLenSq)
  const lenInNodes = meanDim > 0 ? meanLen / meanDim : 0
  const maxInNodes = meanDim > 0 ? maxLen / meanDim : 0
  const edgeLengthMean = Math.max(0, lenInNodes - 3) ** 2
  const edgeLengthMax = Math.max(0, maxInNodes - 5) ** 2

  // Aspect penalty.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (let i = 0; i < N; i++) {
    const r = abs[ids[i]]
    if (r.x < minX) minX = r.x
    if (r.y < minY) minY = r.y
    const rx2 = r.x + r.w, ry2 = r.y + r.h
    if (rx2 > maxX) maxX = rx2
    if (ry2 > maxY) maxY = ry2
  }
  const bbW = maxX - minX, bbH = maxY - minY
  let aspectPenalty = 0
  if (bbW > 0 && bbH > 0) {
    const ar = bbW > bbH ? bbW / bbH : bbH / bbW
    aspectPenalty = Math.max(0, ar - Math.SQRT2) ** 3
  }

  const aestheticBoost = crossings === 0 ? 2 : 1

  return crossings * W_CROSS
       + overdraws * W_OVERDRAW
       + overlap * W_OVERLAP
       + overlap * overlap * W_OVERLAP * 5
       + edgeLengthMean * W_LMEAN  * aestheticBoost
       + edgeLengthMax  * W_LMAX   * aestheticBoost
       + aspectPenalty  * W_ASPECT * aestheticBoost
}

/**
 * Yields control back to the browser event loop so the UI can paint the
 * layout spinner and process input events between SA restarts.
 *
 * Uses `scheduler.yield()` (Chrome 129+ / Electron 32+) when available —
 * it re-queues as a high-priority task with near-zero overhead. Falls back
 * to `setTimeout(0)` (~1 ms in non-throttled Electron) on older runtimes.
 */
function yieldToUI(): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const _sched = (globalThis as any).scheduler
  if (_sched != null && typeof _sched.yield === 'function') {
    return _sched.yield() as Promise<void>
  }
  return new Promise<void>((resolve) => setTimeout(resolve, 0))
}

async function refineWithSimulatedAnnealing(
  nodes: Record<string, C4Node>,
  relations: Record<string, C4Relation>,
  positions: PositionMap,
  rootIds: string[],
  budgetMs = 250,
  options: { energyFn?: (n: Record<string, C4Node>, r: Record<string, C4Relation>) => number; initialTempFactor?: number } = {},
): Promise<SARefinement> {
  if (rootIds.length < 2) {
    const m = computeCompositeScore(nodes, relations)
    return { positions, before: m.composite, after: m.composite, iterations: 0 }
  }

  const work: Record<string, C4Node> = {}
  for (const [id, n] of Object.entries(nodes)) {
    const p = positions[id]
    work[id] = p
      ? { ...n, x: p.x, y: p.y, width: p.width ?? n.width, height: p.height ?? n.height }
      : { ...n }
  }

  // SA energy: by default the cheap proxy (now context-based, ~3-5× faster
  // per evaluation than a fresh-allocating proxy). Phase C passes a custom
  // energyFn (full render-aware composite) and falls back to the slow path
  // because the composite sampling can't share our incremental abs buffer
  // cleanly.
  const customEnergy = options.energyFn
  const ctx = customEnergy ? null : buildEnergyContext(nodes, relations)
  const energy = (): number => {
    if (customEnergy) return customEnergy(work, relations)
    recomputeAbs(work, ctx!) // initial / post-restore full sync
    return proxyEnergyCtx(ctx!)
  }
  // Fast incremental version: caller already kept ctx.abs in sync.
  const energyIncremental = (): number => {
    if (customEnergy) return customEnergy(work, relations)
    return proxyEnergyCtx(ctx!)
  }
  const before = energy()
  let curCost = before
  let bestCost = before
  const bestSnapshot: Record<string, { x: number; y: number }> = {}
  for (const id of rootIds) bestSnapshot[id] = { x: work[id].x, y: work[id].y }

  // Temperature schedule. Start with a perturbation near 8 % of bbox span so
  // the first sweeps can swap two roots; cool to a few px so the final
  // sweeps polish positions. `initialTempFactor` lets the polish phase
  // start at a much lower T (gentle fine-tuning, no large jumps).
  const tempScale = options.initialTempFactor ?? 1
  const bbox = computeRootBBox(work, rootIds)
  const span = Math.max(bbox.w, bbox.h, 200)

  // Snapshot of the input positions — restart 0 starts here for diversity
  // (restarts 1+ start from the best basin found so far). Without this every
  // restart converges to the same local minimum and the multi-restart loop
  // is wasted work.
  const initialSnapshot: Record<string, { x: number; y: number }> = {}
  for (const id of rootIds) initialSnapshot[id] = { x: work[id].x, y: work[id].y }

  const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now())

  // Multi-restart SA with diversified seeding + reheat-on-stagnation.
  //   • Restart 0 → starts from the input (preserves ELK/winner intent).
  //   • Restart k>0 → starts from best basin perturbed by initial T (escapes
  //     to a neighbouring basin while retaining the structural backbone).
  //   • Inside each chain: when no improvement for STAGNATION_LIMIT sweeps,
  //     reheat T to 60 % of initial. Davidson-Harel "kick" — recovers SA
  //     when it gets trapped in a bad minimum after greedy descent.
  const RESTARTS = 4
  const perRun = budgetMs / RESTARTS
  let totalIter = 0

  for (let restart = 0; restart < RESTARTS; restart++) {
    // Seed positions: restart 0 = input, restart k>0 = best so far.
    const seed = restart === 0 ? initialSnapshot : bestSnapshot
    for (const id of rootIds) {
      work[id].x = seed[id].x
      work[id].y = seed[id].y
    }
    if (ctx) recomputeAbs(work, ctx)
    curCost = restart === 0 ? before : bestCost
    // For restart 0 the seed equals the input; recompute to be safe in case
    // `before` was computed against an out-of-sync abs buffer.
    if (restart === 0 && ctx) curCost = proxyEnergyCtx(ctx)

    // Initial temperature: restart 0 modest, later restarts hotter so they
    // can leap out of the seed's basin.
    const T0 = span * (0.06 + 0.04 * restart) * tempScale  // 6/10/14/18 % × scale
    let T = T0
    const T_END = 3
    const cooling = 0.95
    const t0 = now()

    while (now() - t0 < perRun && T > T_END) {
      // One sweep = one perturbation per root node, plus one swap.
      // Mixing translation + swap follows Davidson-Harel (1996) — pure
      // translation SA gets stuck because swapping two roots is many
      // small Gaussian steps away.
      for (const id of rootIds) {
        const n = work[id]
        const oldX = n.x
        const oldY = n.y
        const dx = gaussian() * T
        const dy = gaussian() * T
        n.x += dx
        n.y += dy
        if (ctx) shiftSubtreeAbs(id, dx, dy, ctx)
        const cost = energyIncremental()
        const dE = cost - curCost
        if (dE < 0 || Math.random() < Math.exp(-dE / Math.max(T, 0.5))) {
          curCost = cost
          if (cost < bestCost) {
            bestCost = cost
            for (const rid of rootIds) bestSnapshot[rid] = { x: work[rid].x, y: work[rid].y }
          }
        } else {
          n.x = oldX
          n.y = oldY
          if (ctx) shiftSubtreeAbs(id, -dx, -dy, ctx)
        }
        totalIter++
      }
      // Discrete swap move once per sweep (large neighbourhood jump).
      // Bias toward swapping spatially-nearby roots — random global swaps
      // are almost always destructive and rejected. Nearby swaps are more
      // likely to be accepted (small absolute cost change) and effective at
      // unsticking from a bad basin.
      if (rootIds.length >= 2) {
        const i = Math.floor(Math.random() * rootIds.length)
        let j = i
        // 3 candidate picks, choose the one closest to i. O(1) extra cost
        // and noticeably improves swap acceptance ratio in practice.
        let bestDist = Infinity
        const a = work[rootIds[i]]
        for (let trial = 0; trial < 3; trial++) {
          let cand = Math.floor(Math.random() * rootIds.length)
          if (cand === i) cand = (cand + 1) % rootIds.length
          const c = work[rootIds[cand]]
          const d = (c.x - a.x) ** 2 + (c.y - a.y) ** 2
          if (d < bestDist) { bestDist = d; j = cand }
        }
        const idA = rootIds[i], idB = rootIds[j]
        const aa = work[idA]
        const bb = work[idB]
        const ax = aa.x, ay = aa.y
        const bx = bb.x, by = bb.y
        const dxA = bx - ax, dyA = by - ay
        aa.x = bx; aa.y = by
        bb.x = ax; bb.y = ay
        if (ctx) {
          shiftSubtreeAbs(idA, dxA, dyA, ctx)
          shiftSubtreeAbs(idB, -dxA, -dyA, ctx)
        }
        const cost = energyIncremental()
        const dE = cost - curCost
        // Swap is a large jump; tighten the temperature for uphill acceptance.
        if (dE < 0 || Math.random() < Math.exp(-dE / Math.max(T * 0.5, 0.5))) {
          curCost = cost
          if (cost < bestCost) {
            bestCost = cost
            for (const rid of rootIds) bestSnapshot[rid] = { x: work[rid].x, y: work[rid].y }
          }
        } else {
          aa.x = ax; aa.y = ay
          bb.x = bx; bb.y = by
          if (ctx) {
            shiftSubtreeAbs(idA, -dxA, -dyA, ctx)
            shiftSubtreeAbs(idB, dxA, dyA, ctx)
          }
        }
        totalIter++
      }
      T *= cooling
    }
    // Yield between SA restarts so the event loop can paint the spinner
    // and handle input. Each restart is ~perRun ms of sync CPU work.
    await yieldToUI()
  }

  // Restore best positions and emit them.
  for (const id of rootIds) {
    work[id].x = bestSnapshot[id].x
    work[id].y = bestSnapshot[id].y
  }
  const out: PositionMap = { ...positions }
  for (const id of rootIds) {
    const prev = positions[id] ?? { x: 0, y: 0 }
    out[id] = { ...prev, x: bestSnapshot[id].x, y: bestSnapshot[id].y }
  }
  return { positions: out, before, after: bestCost, iterations: totalIter }
}

function computeRootBBox(
  nodes: Record<string, C4Node>,
  rootIds: string[],
): { w: number; h: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const id of rootIds) {
    const n = nodes[id]
    if (!n) continue
    if (n.x < minX) minX = n.x
    if (n.y < minY) minY = n.y
    if (n.x + n.width > maxX) maxX = n.x + n.width
    if (n.y + n.height > maxY) maxY = n.y + n.height
  }
  if (!isFinite(minX)) return { w: 0, h: 0 }
  return { w: maxX - minX, h: maxY - minY }
}

/** Box-Muller transform — N(0, 1). */
function gaussian(): number {
  let u = 0, v = 0
  while (u === 0) u = Math.random()
  while (v === 0) v = Math.random()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

/**
 * Per-compound SA pass (#1).
 *
 * Root-only SA cannot rearrange children inside a compound — if ELK packed
 * the components of a Container suboptimally, no amount of root shuffling
 * fixes it. This walks every parent with ≥ 2 children and runs a small SA
 * on those children's (parent-relative) positions. Energy is the same
 * proxy, evaluated globally — children moves still affect global crossings,
 * which is exactly what we want.
 *
 * Budget is split evenly across compound groups so a diagram with many
 * containers doesn't blow the wall-clock target.
 */
async function refinePerCompound(
  nodes: Record<string, C4Node>,
  relations: Record<string, C4Relation>,
  positions: PositionMap,
  budgetMs: number,
): Promise<SARefinement> {
  const byParent: Record<string, string[]> = {}
  for (const n of Object.values(nodes)) {
    if (n.parentId) (byParent[n.parentId] ??= []).push(n.id)
  }
  const groups = Object.values(byParent).filter((g) => g.length >= 2)
  if (groups.length === 0) {
    return { positions, before: 0, after: 0, iterations: 0 }
  }
  const perGroup = Math.max(60, budgetMs / groups.length)
  let pos = positions
  let before = 0
  let after = 0
  let iterations = 0
  for (let i = 0; i < groups.length; i++) {
    const childIds = groups[i]
    const result = await refineWithSimulatedAnnealing(nodes, relations, pos, childIds, perGroup)
    if (i === 0) before = result.before
    after = result.after
    iterations += result.iterations
    pos = result.positions
  }
  return { positions: pos, before, after, iterations }
}

/**
 * Re-fit every compound parent to the bounding box of its (possibly moved)
 * children. SA per-compound rearranges children in parent-relative space
 * but does NOT enforce that they stay inside the parent's original bbox —
 * children can drift outside, leaving the parent visually empty while
 * components float in the void next to it. This pass restores the
 * "container hugs its children" invariant.
 *
 * For each parent (deepest first):
 *   1. Compute child-bbox in parent-relative coords.
 *   2. Translate every child by (-bboxMinX + padX, -bboxMinY + padY) so the
 *      bbox starts at the padding offset.
 *   3. Set parent width/height to bboxW + 2·padX (resp. height + topPad + padY).
 *
 * Padding mirrors the values used by ELK / fitParentToChildren in the store.
 */
const PARENT_PAD_X = 16
const PARENT_PAD_TOP = 120  // header (30) + 2-line label (~52) + breathing room
const PARENT_PAD_BOTTOM = 16

function fitParentsToChildren(
  nodes: Record<string, C4Node>,
  positions: PositionMap,
): PositionMap {
  // Build child list per parent.
  const byParent: Record<string, string[]> = {}
  for (const n of Object.values(nodes)) {
    if (n.parentId) (byParent[n.parentId] ??= []).push(n.id)
  }
  const parentIds = Object.keys(byParent)
  if (parentIds.length === 0) return positions

  // Sort parents deepest-first so a container is fitted before its system.
  const depthOf = (id: string): number => {
    let d = 0, cur: C4Node | undefined = nodes[id]
    while (cur?.parentId) { d++; cur = nodes[cur.parentId] }
    return d
  }
  parentIds.sort((a, b) => depthOf(b) - depthOf(a))

  const out: PositionMap = { ...positions }
  const px = (id: string): { x: number; y: number; w: number; h: number } => {
    const p = out[id]
    const n = nodes[id]
    return {
      x: p?.x ?? n.x,
      y: p?.y ?? n.y,
      w: p?.width ?? n.width,
      h: p?.height ?? n.height,
    }
  }

  for (const pid of parentIds) {
    const childIds = byParent[pid]
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const cid of childIds) {
      const c = px(cid)
      if (c.x < minX) minX = c.x
      if (c.y < minY) minY = c.y
      if (c.x + c.w > maxX) maxX = c.x + c.w
      if (c.y + c.h > maxY) maxY = c.y + c.h
    }
    if (!isFinite(minX)) continue

    // Shift children so they start at (PARENT_PAD_X, PARENT_PAD_TOP).
    const dx = PARENT_PAD_X - minX
    const dy = PARENT_PAD_TOP - minY
    for (const cid of childIds) {
      const c = px(cid)
      out[cid] = { x: c.x + dx, y: c.y + dy, width: c.w, height: c.h }
    }

    // Resize parent to fit shifted children.
    const newW = (maxX - minX) + 2 * PARENT_PAD_X
    const newH = (maxY - minY) + PARENT_PAD_TOP + PARENT_PAD_BOTTOM
    const p = px(pid)
    out[pid] = { x: p.x, y: p.y, width: newW, height: newH }
  }
  return out
}

// ─── Candidate runner ─────────────────────────────────────────────────────

export interface SmartLayoutCandidate {
  name: string
  metrics: LayoutMetrics
  /** Full composite breakdown — used for ranking + diagnostics. */
  score: CompositeScore
  positions: PositionMap
}

export interface SmartLayoutResult {
  winner: SmartLayoutCandidate
  candidates: SmartLayoutCandidate[]
  /** Metrics of the input layout (before any change) — for the UI badge. */
  baseline: LayoutMetrics
  /** Planarity verdict of the winning layout. */
  planarity: PlanarityScore
  /** SA refinement statistics (cost before vs. after annealing). */
  refinement: { before: number; after: number; iterations: number }
}

function projectPositions(nodes: Record<string, C4Node>, positions: PositionMap): Record<string, C4Node> {
  const out: Record<string, C4Node> = {}
  for (const [id, n] of Object.entries(nodes)) {
    const p = positions[id]
    out[id] = p
      ? { ...n, x: p.x, y: p.y, width: p.width ?? n.width, height: p.height ?? n.height }
      : { ...n }
  }
  return out
}

async function runCandidate(
  name: string,
  nodes: Record<string, C4Node>,
  relations: Record<string, C4Relation>,
  positionsPromise: Promise<PositionMap> | PositionMap,
): Promise<SmartLayoutCandidate | null> {
  try {
    const positions = await positionsPromise
    if (Object.keys(positions).length === 0) return null
    // Score after geometric crossing minimisation so all candidates compete fairly.
    const projected = projectPositions(nodes, positions)
    const swap = minimizeCrossings(projected, relations)
    if (Object.keys(swap).length > 0) {
      for (const [id, p] of Object.entries(swap)) {
        const n = projected[id]
        if (n) { n.x = p.x; n.y = p.y }
        const prev = positions[id]
        if (prev) positions[id] = { ...prev, x: p.x, y: p.y }
      }
    }
    const metrics = computeLayoutMetrics(projected, relations)
    const score = computeCompositeScore(projected, relations)
    return { name, positions, metrics, score }
  } catch (err) {
    console.warn(`[smartLayout] candidate ${name} failed:`, err)
    return null
  }
}

/**
 * Result of the ELK candidate-generation phase.
 *
 * `done: true`  — all candidates failed; `result` is a baseline fallback and
 *                 the SA phase should be skipped.
 * `done: false` — ranked candidates are ready; pass `valid / rootIds / baseline`
 *                 to `runSmartLayoutSAPhase` (or the SA Web Worker).
 */
export type ELKPhaseResult =
  | { done: true; result: SmartLayoutResult }
  | { done: false; valid: SmartLayoutCandidate[]; rootIds: string[]; baseline: LayoutMetrics }

/**
 * ELK candidate-generation phase — always runs on the main thread.
 *
 * elk-worker.min.js is a standalone Web Worker script and cannot be imported
 * inside another worker, so this phase must never be called from inside the
 * SA worker. The result is either an early-exit baseline (`done: true`) or
 * the ranked candidate set ready for `runSmartLayoutSAPhase` (`done: false`).
 */
export async function runSmartLayoutELKPhase(
  nodes: Record<string, C4Node>,
  relations: Record<string, C4Relation>,
  metamodel?: Metamodel,
): Promise<ELKPhaseResult> {
  // Dynamic import so ELK (with its elk-worker.min.js CJS dependency) is NOT
  // bundled into the Web Worker chunk — it's code-split and fetched only when
  // this function is called from the main thread.
  const { applyElkLayout } = await import('./elkLayout')
  const baseline = computeLayoutMetrics(nodes, relations)
  const depth = maxContainmentDepth(metamodel)
  const mmDirection: 'DOWN' | 'RIGHT' = depth >= 2 ? 'RIGHT' : 'DOWN'

  // Ten structurally different candidates run in parallel.
  // stress / force / mrtree may degrade on compound graphs — runCandidate
  // swallows failures so the remaining set still wins.
  const candidates = await Promise.all([
    runCandidate(
      'Layered TB · Brandes-Köpf · model-order',
      nodes, relations,
      applyElkLayout(nodes, relations, {
        rootOptions: elkLayered('DOWN', 'BRANDES_KOEPF', true),
        childOptions: elkLayeredChild('RIGHT', 'BRANDES_KOEPF'),
      }),
    ),
    runCandidate(
      'Layered LR · Brandes-Köpf · model-order',
      nodes, relations,
      applyElkLayout(nodes, relations, {
        rootOptions: elkLayered('RIGHT', 'BRANDES_KOEPF', true),
        childOptions: elkLayeredChild('DOWN', 'BRANDES_KOEPF'),
      }),
    ),
    runCandidate(
      'Layered TB · NetworkSimplex',
      nodes, relations,
      applyElkLayout(nodes, relations, {
        rootOptions: elkLayered('DOWN', 'NETWORK_SIMPLEX', false),
        childOptions: elkLayeredChild('RIGHT', 'NETWORK_SIMPLEX'),
      }),
    ),
    runCandidate(
      'Layered TB · Longest-Path · Brandes-Köpf',
      nodes, relations,
      applyElkLayout(nodes, relations, {
        rootOptions: elkLayered('DOWN', 'BRANDES_KOEPF', true, 'LONGEST_PATH'),
        childOptions: elkLayeredChild('RIGHT', 'BRANDES_KOEPF'),
      }),
    ),
    runCandidate(
      'Layered TB · MinWidth · Brandes-Köpf',
      nodes, relations,
      applyElkLayout(nodes, relations, {
        rootOptions: elkLayered('DOWN', 'BRANDES_KOEPF', true, 'MIN_WIDTH'),
        childOptions: elkLayeredChild('RIGHT', 'BRANDES_KOEPF'),
      }),
    ),
    runCandidate(
      `Metamodel-aware (root ${mmDirection}, Brandes-Köpf)`,
      nodes, relations,
      applyElkLayout(nodes, relations, {
        rootOptions: elkLayered(mmDirection, 'BRANDES_KOEPF', true),
        childOptions: elkLayeredChild(mmDirection === 'DOWN' ? 'RIGHT' : 'DOWN', 'BRANDES_KOEPF'),
      }),
    ),
    runCandidate(
      'Stress majorisation (Gansner)',
      nodes, relations,
      applyElkLayout(nodes, relations, {
        rootOptions: elkStress(),
        childOptions: elkLayeredChild('RIGHT', 'BRANDES_KOEPF'),
      }),
    ),
    runCandidate(
      'Force-directed (Eades)',
      nodes, relations,
      applyElkLayout(nodes, relations, {
        rootOptions: elkForce(),
        childOptions: elkLayeredChild('RIGHT', 'BRANDES_KOEPF'),
      }),
    ),
    runCandidate(
      'Mr.Tree (Reingold-Tilford)',
      nodes, relations,
      applyElkLayout(nodes, relations, {
        rootOptions: elkMrTree(),
        childOptions: elkLayeredChild('RIGHT', 'BRANDES_KOEPF'),
      }),
    ),
    runCandidate(
      'Radical (semantic C4)',
      nodes, relations,
      applyRadicalLayout(nodes, relations),
    ),
  ])

  const valid = candidates.filter((c): c is SmartLayoutCandidate => c !== null)
  if (valid.length === 0) {
    const baselineScore = computeCompositeScore(nodes, relations)
    return {
      done: true,
      result: {
        baseline,
        winner: { name: 'baseline', metrics: baseline, score: baselineScore, positions: {} },
        candidates: [],
        planarity: computePlanarityScore(nodes, relations),
        refinement: { before: baselineScore.composite, after: baselineScore.composite, iterations: 0 },
      },
    }
  }

  // Composite ranking — crossings dominate (W=100) but the layout still
  // gets penalised for node overlap, edge-length spaghetti, and bad aspect
  // ratio. This matches what users *perceive* as messy far better than
  // raw crossing count alone.
  valid.sort((a, b) => a.score.composite - b.score.composite)

  const rootIds = Object.values(nodes).filter((n) => !n.parentId).map((n) => n.id)
  return { done: false, valid, rootIds, baseline }
}

export async function runSmartLayoutCore(
  nodes: Record<string, C4Node>,
  relations: Record<string, C4Relation>,
  metamodel?: Metamodel,
): Promise<SmartLayoutResult> {
  const elkResult = await runSmartLayoutELKPhase(nodes, relations, metamodel)
  if (elkResult.done) return elkResult.result
  return runSmartLayoutSAPhase(nodes, relations, elkResult.valid, elkResult.rootIds, elkResult.baseline)
}

/**
 * SA-only refinement phase — runs phases A / B / C of the smart layout
 * pipeline on pre-computed ELK candidates.
 *
 * Separated from runSmartLayoutCore so that it can be executed in a Web
 * Worker that does NOT include ELK (elk-worker.min.js is a standalone worker
 * script that cannot be imported inside another worker). The ELK candidate
 * generation always runs on the main thread; this function handles the
 * CPU-intensive SA refinement off-thread.
 */
export async function runSmartLayoutSAPhase(
  nodes: Record<string, C4Node>,
  relations: Record<string, C4Relation>,
  valid: SmartLayoutCandidate[],  // sorted ascending by composite score
  rootIds: string[],
  baseline: LayoutMetrics,
): Promise<SmartLayoutResult> {
  // Phase A multi-start: refine the top-K ELK candidates independently and
  // pick whichever Phase A leaves in the best basin.
  const PHASEA_K = Math.min(2, valid.length)
  const phaseABudget = 400
  let phaseA = await refineWithSimulatedAnnealing(nodes, relations, valid[0].positions, rootIds, phaseABudget)
  let winner = valid[0]
  for (let k = 1; k < PHASEA_K; k++) {
    const alt = await refineWithSimulatedAnnealing(nodes, relations, valid[k].positions, rootIds, phaseABudget)
    if (alt.after < phaseA.after) {
      phaseA = alt
      winner = valid[k]
    }
  }
  // Refit parents in case root SA loosened sibling spacing.
  const fittedA = fitParentsToChildren(nodes, phaseA.positions)
  const phaseB = await refinePerCompound(nodes, relations, fittedA, 200)
  // Critical: per-compound SA mutates child positions in parent-relative
  // space WITHOUT enforcing they stay inside the parent. Refit so containers
  // hug their (possibly drifted) children before the final polish.
  const fittedB = fitParentsToChildren(nodes, phaseB.positions)
  const phaseC = await refineWithSimulatedAnnealing(
    nodes, relations, fittedB, rootIds, 200,
    {
      energyFn: (n, r) => computeCompositeScore(n, r).composite,
      initialTempFactor: 0.4, // gentle fine-tuning, no large jumps
    },
  )
  const finalPositions = fitParentsToChildren(nodes, phaseC.positions)
  const sa: SARefinement = {
    positions: finalPositions,
    before: phaseA.before,
    after: phaseC.after,
    iterations: phaseA.iterations + phaseB.iterations + phaseC.iterations,
  }

  const refined = projectPositions(nodes, sa.positions)
  const refinedMetrics = computeLayoutMetrics(refined, relations)
  const refinedScore = computeCompositeScore(refined, relations)
  const finalWinner: SmartLayoutCandidate = {
    name: winner.name,
    positions: sa.positions,
    metrics: refinedMetrics,
    score: refinedScore,
  }
  const planarity = computePlanarityScore(refined, relations)

  return {
    baseline,
    winner: finalWinner,
    candidates: valid,
    planarity,
    refinement: { before: sa.before, after: sa.after, iterations: sa.iterations },
  }
}


