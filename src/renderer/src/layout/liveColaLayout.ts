/**
 * Live (dynamic) WebCoLa layout — exact same pattern as the official
 * "smallgroups" example:
 *   https://ialab.it.monash.edu/webcola/examples/smallgroups.html
 *
 * Key: d3adaptor(d3) with .start() (keepRunning=true) starts a d3.timer
 * that calls tick() each frame. When stress < threshold the timer stops.
 * User drag calls resume() to restart the timer.
 */

import { d3adaptor, Layout, InputNode, Group, Link } from 'webcola'
import { dispatch } from 'd3-dispatch'
import { timer } from 'd3-timer'
import { drag as d3drag } from 'd3-drag'
import {
  C4Node,
  C4Relation,
  COLLAPSED_HEIGHT,
  COLLAPSED_WIDTH,
  NODE_SIZES,
  isContainerType,
} from '../types/c4'

// ─── Types ───────────────────────────────────────────────────────────────────

interface ColaNode extends InputNode {
  x: number
  y: number
  width: number
  height: number
  /** Real (non-inflated) dimensions for position conversion */
  realWidth: number
  realHeight: number
  c4id: string
  fixed?: number
  px?: number
  py?: number
}

interface C4Group extends Group {
  c4id: string
  /** Visual shrink applied when emitting bounds (collision uses full padding,
   * but we render a smaller box so sibling group borders don't touch). */
  visualShrink?: number
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function effectiveWidth(n: C4Node): number {
  if (isContainerType(n.type) && n.collapsed)
    return COLLAPSED_WIDTH[n.type]
  return n.width ?? NODE_SIZES[n.type].width
}

function effectiveHeight(n: C4Node): number {
  if (isContainerType(n.type) && n.collapsed)
    return COLLAPSED_HEIGHT[n.type]
  return n.height ?? NODE_SIZES[n.type].height
}

function isVisible(node: C4Node, all: Record<string, C4Node>): boolean {
  if (!node.parentId) return true
  const parent = all[node.parentId]
  if (!parent) return true
  if (parent.collapsed) return false
  return isVisible(parent, all)
}

/** Walk parent chain to compute absolute top-left from relative positions. */
function toAbsoluteTopLeft(n: C4Node, all: Record<string, C4Node>): { x: number; y: number } {
  let x = n.x
  let y = n.y
  let cur = n
  while (cur.parentId) {
    const parent = all[cur.parentId]
    if (!parent) break
    x += parent.x
    y += parent.y
    cur = parent
  }
  return { x, y }
}

// ─── Public interface ────────────────────────────────────────────────────────

export interface LiveColaCallbacks {
  getModel: () => { nodes: Record<string, C4Node>; relations: Record<string, C4Relation> }
  applyPositions: (positions: Record<string, { x: number; y: number; width?: number; height?: number }>) => void
}

export class LiveColaLayout {
  private cola: any = null
  private colaNodes: ColaNode[] = []
  private colaGroups: C4Group[] = []
  private idToNode = new Map<string, ColaNode>()
  private idToGroup = new Map<string, C4Group>()
  private callbacks: LiveColaCallbacks
  private _running = false
  private _bulkDone = false
  private _grabbedId: string | null = null
  private allNodes: Record<string, C4Node> = {}
  /**
   * One-shot seed positions consumed by the next rebuild(). Used when a
   * caller wants a re-appearing node (e.g. children of a just-expanded
   * parent) to start at a specific absolute centre coordinate, overriding
   * the default "spawn near connected neighbours" heuristic. Entries are
   * cleared after they are applied.
   */
  private seedPositions = new Map<string, { x: number; y: number }>()

  constructor(callbacks: LiveColaCallbacks) {
    this.callbacks = callbacks
  }

  /**
   * Provide an absolute-centre seed position for a node, applied on the next
   * rebuild() if the node was not present in the previous cola pass (i.e.
   * a re-appearing child after expand). No-op once consumed.
   */
  seedPosition(id: string, x: number, y: number): void {
    this.seedPositions.set(id, { x, y })
  }

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  /**
   * Start the live layout.
   * @param skipBulk When true, the cola model is initialised from the
   *   current c4Nodes positions WITHOUT running bulk synchronous
   *   iterations (i.e. `rebuild(false)`). Use this when the diagram was
   *   loaded from disk and already has correct positions — running the
   *   110-iteration bulk pass would rearrange everything and overwrite
   *   the persisted layout.
   */
  start(skipBulk = false): void {
    if (this._running) return
    this._running = true
    if (this._bulkDone && this.cola) {
      // Resume an existing layout WITHOUT calling cola.resume(): that
      // method sets alpha=0.1 which immediately runs a synchronous
      // convergence (kick) and visibly shifts nodes. We just re-arm
      // _running so the live tick handler resumes emitting positions
      // when cola is woken up by a drag (liveGrab/liveDrag → dragStart
      // + resume in webcola).
      // No-op otherwise — cola sits idle and positions stay put.
    } else {
      // First start: bulk-arrange only when we don't have saved positions.
      // When skipBulk=true (loaded from disk), we seed from c4Nodes and
      // run 0 initial iterations so cola accepts the stored positions as-is.
      this.rebuild(!skipBulk)
      this._bulkDone = true
    }
  }

  stop(): void {
    this._running = false
    // Halt the d3.timer but keep this.cola + node/group caches intact so
    // a subsequent start() can resume() instead of doing a full rebuild
    // (which would re-seed positions and visibly shift the diagram).
    if (this.cola) {
      try { this.cola.stop() } catch { /* noop */ }
    }
    this._grabbedId = null
  }

  get running(): boolean {
    return this._running
  }

  invalidate(): void {
    if (this._running) this.rebuild(false)
  }

  /**
   * Like invalidate(), but discards cola's cached positions first so the
   * next rebuild seeds itself from the current c4Nodes coordinates instead
   * of carrying over stale ones. Use this whenever the store's positions
   * were replaced wholesale (view switch, milestone load, file load, etc.).
   */
  reset(): void {
    // Drop cached positions; rebuild() will fall back to toAbsoluteTopLeft
    // (which reads from c4Nodes) for every node.
    this.colaNodes = []
    this.idToNode.clear()
    this.colaGroups = []
    this.idToGroup.clear()
    if (this._running) this.rebuild(false)
  }

  // ─── Grab / drag / release ─────────────────────────────────────────────────
  // Replicates exactly what cola.drag does in d3v4adaptor:
  //   start → Layout.dragStart(d); resume()
  //   drag  → Layout.drag(d, pos); resume()
  //   end   → Layout.dragEnd(d)
  //
  // For group nodes (parents), we drag all descendant leaf nodes together.

  /** Collect all leaf ColaNodes that belong to a group (recursively). */
  private groupLeaves(groupId: string): ColaNode[] {
    const g = this.idToGroup.get(groupId)
    if (!g) return []
    const result: ColaNode[] = []
    // Direct leaves
    if (g.leaves) {
      for (const leaf of g.leaves as any[]) {
        const cn = typeof leaf === 'number' ? this.colaNodes[leaf] : leaf
        if (cn) result.push(cn)
      }
    }
    // Recurse into child groups
    if (g.groups) {
      for (const child of g.groups as any[]) {
        const childGroup = typeof child === 'number' ? this.colaGroups[child] : child
        if (childGroup) {
          const childId = (childGroup as C4Group).c4id
          if (childId) result.push(...this.groupLeaves(childId))
        }
      }
    }
    return result
  }

  private _dragStartPositions = new Map<string, { x: number; y: number }>()

  grab(nodeId: string, rfX: number, rfY: number): void {
    this._grabbedId = nodeId
    const cn = this.idToNode.get(nodeId)
    if (cn) {
      Layout.dragStart(cn)
    } else {
      // It's a group — drag all descendant leaves
      const leaves = this.groupLeaves(nodeId)
      this._dragStartPositions.clear()
      for (const leaf of leaves) {
        this._dragStartPositions.set(leaf.c4id, { x: leaf.x, y: leaf.y })
        Layout.dragStart(leaf)
      }
    }
    this.cola?.resume()
  }

  drag(nodeId: string, rfX: number, rfY: number): void {
    const cn = this.idToNode.get(nodeId)
    if (cn) {
      // Convert RF relative top-left → cola absolute center
      // Use cola group bounds (not store positions) for consistency
      const abs = this.rfToAbsCenter(nodeId, rfX, rfY, cn.width, cn.height)
      Layout.drag(cn, abs)
    } else {
      // Group drag: compute delta from group bounds and move all leaves
      const g = this.idToGroup.get(nodeId)
      if (g) {
        const b = (g as any).bounds
        if (b && this._dragStartPositions.size > 0) {
          // Get the first leaf's start position to compute delta
          const firstLeaf = this.groupLeaves(nodeId)[0]
          if (firstLeaf) {
            const startPos = this._dragStartPositions.get(firstLeaf.c4id)
            if (startPos) {
              // The group's bounds.x is the left edge; rfX is the new top-left from ReactFlow
              // Compute delta from the original group bounds position
              const c4n = this.allNodes[nodeId]
              let absX = rfX, absY = rfY
              if (c4n?.parentId) {
                const pg = this.idToGroup.get(c4n.parentId)
                if (pg) {
                  const pb = (pg as any).bounds
                  if (pb) { absX += pb.x; absY += pb.y }
                }
              }
              const dx = absX - (b.x ?? 0)
              const dy = absY - (b.y ?? 0)
              for (const leaf of this.groupLeaves(nodeId)) {
                const sp = this._dragStartPositions.get(leaf.c4id)
                if (sp) {
                  Layout.drag(leaf, { x: sp.x + dx, y: sp.y + dy })
                }
              }
            }
          }
        }
      }
    }
    this.cola?.resume()
  }

  release(nodeId: string): void {
    this._grabbedId = null
    const cn = this.idToNode.get(nodeId)
    if (cn) {
      Layout.dragEnd(cn)
    } else {
      for (const leaf of this.groupLeaves(nodeId)) {
        Layout.dragEnd(leaf)
      }
      this._dragStartPositions.clear()
    }
  }

  // ─── Coordinate conversion (RF ↔ cola) ─────────────────────────────────────

  /** Convert ReactFlow relative top-left to cola absolute center. */
  private rfToAbsCenter(
    nodeId: string, rfX: number, rfY: number, w: number, h: number
  ): { x: number; y: number } {
    let absX = rfX
    let absY = rfY
    // Walk up parent chain using cola group bounds for absolute offset
    const c4n = this.allNodes[nodeId]
    if (c4n?.parentId) {
      const pg = this.idToGroup.get(c4n.parentId)
      if (pg) {
        const b = (pg as any).bounds
        if (b) { absX += b.x; absY += b.y }
      }
    }
    return { x: absX + w / 2, y: absY + h / 2 }
  }

  // ─── Build / rebuild ───────────────────────────────────────────────────────

  private rebuild(firstRun: boolean = false): void {
    if (this.cola) this.cola.stop()

    const { nodes, relations } = this.callbacks.getModel()
    this.allNodes = nodes

    const visibleNodes = Object.values(nodes).filter((n) => isVisible(n, nodes))
    if (visibleNodes.length === 0) {
      this.cola = null
      return
    }

    // Which visible nodes are parents (have visible children)?
    const parentIds = new Set<string>()
    for (const n of visibleNodes) {
      if (n.parentId && nodes[n.parentId] && !nodes[n.parentId].collapsed) {
        parentIds.add(n.parentId)
      }
    }

    // Preserve existing cola positions across rebuilds
    const prevPos = new Map<string, { x: number; y: number }>()
    for (const cn of this.colaNodes) {
      prevPos.set(cn.c4id, { x: cn.x, y: cn.y })
    }

    this.colaNodes = []
    this.idToNode.clear()
    this.colaGroups = []
    this.idToGroup.clear()

    // ── Leaf nodes → cola nodes ─────────────────────────────────────────
    const leafNodes = visibleNodes.filter((n) => !parentIds.has(n.id))

    // Build a quick relation index so brand-new nodes can spawn near a
    // connected neighbour (instead of materialising at the origin and
    // flying across the canvas to find their place).
    const neighbourIds = new Map<string, string[]>()
    for (const rel of Object.values(relations)) {
      if (!neighbourIds.has(rel.sourceId)) neighbourIds.set(rel.sourceId, [])
      if (!neighbourIds.has(rel.targetId)) neighbourIds.set(rel.targetId, [])
      neighbourIds.get(rel.sourceId)!.push(rel.targetId)
      neighbourIds.get(rel.targetId)!.push(rel.sourceId)
    }

    for (const n of leafNodes) {
      const w = effectiveWidth(n)
      const h = effectiveHeight(n)

      const prev = prevPos.get(n.id)
      const seed = this.seedPositions.get(n.id)
      let cx: number, cy: number
      if (prev) {
        cx = prev.x
        cy = prev.y
      } else if (seed) {
        // Caller-provided seed (e.g. expand: children spawn at parent's
        // centre so cola can fan them outward instead of teleporting them
        // to a neighbour-average and animating from there).
        cx = seed.x
        cy = seed.y
        this.seedPositions.delete(n.id)
      } else {
        // New node: try to position near average of its connected
        // neighbours' previous cola positions; fall back to its store
        // position (toAbsoluteTopLeft) when no neighbours have positions.
        const neigh = neighbourIds.get(n.id) ?? []
        let sx = 0, sy = 0, count = 0
        for (const nid of neigh) {
          const p = prevPos.get(nid)
          if (p) { sx += p.x; sy += p.y; count++ }
        }
        if (count > 0) {
          // Offset slightly so it doesn't overlap exactly with a neighbour
          cx = sx / count + (Math.random() - 0.5) * 40
          cy = sy / count + (Math.random() - 0.5) * 40
        } else {
          const abs = toAbsoluteTopLeft(n, nodes)
          cx = abs.x + w / 2
          cy = abs.y + h / 2
        }
      }

      // Inflate dimensions by a margin so avoidOverlaps keeps unlinked
      // siblings apart too (not just nodes connected by links).
      const margin = 80
      const cn: ColaNode = { c4id: n.id, x: cx, y: cy, width: w + margin, height: h + margin, realWidth: w, realHeight: h }
      this.colaNodes.push(cn)
      this.idToNode.set(n.id, cn)
    }

    // ── Links ───────────────────────────────────────────────────────────
    const colaLinks: Link<ColaNode>[] = []
    for (const rel of Object.values(relations)) {
      const src = this.findLeaf(rel.sourceId, visibleNodes)
      const tgt = this.findLeaf(rel.targetId, visibleNodes)
      if (src && tgt && src !== tgt) colaLinks.push({ source: src, target: tgt })
    }

    // ── Build index maps for groups ─────────────────────────────────────
    // webcola requires group leaves/groups as INDICES (numbers), not objects.
    // When leaves are numbers, groups() converts them to objects AND sets
    // .parent = g, which is required for correct rootGroup computation.
    const nodeIndex = new Map<string, number>()
    this.colaNodes.forEach((cn, i) => nodeIndex.set(cn.c4id, i))

    // ── Groups bottom-up (leaf-containers like 'container' first) ──
    // First pass: containers whose children are all leaves (no further nesting
    // among groups). 'container' is a flat container in the C4 metamodel.
    for (const n of visibleNodes) {
      if (!parentIds.has(n.id)) continue
      if (n.type !== 'container') continue
      const leafIndices = leafNodes
        .filter((c) => c.parentId === n.id)
        .map((c) => nodeIndex.get(c.id))
        .filter((i) => i !== undefined) as number[]
      if (leafIndices.length > 0) {
        const PAD = 80
        const VIS = 16
        const g: C4Group = { c4id: n.id, leaves: leafIndices as any, padding: PAD, visualShrink: PAD - VIS }
        this.colaGroups.push(g)
        this.idToGroup.set(n.id, g)
      }
    }

    // Build group index map (container groups have been added above)
    const groupIndex = new Map<string, number>()
    this.colaGroups.forEach((g, i) => groupIndex.set(g.c4id, i))

    // ── Outer containers (system / domain / group) bottom-up by depth ───
    // Systems, domains, and groups can nest. Each parent's group references
    // its children's group indices, so children must be added to colaGroups
    // BEFORE their parent. Sort by ancestor depth descending — deepest first.
    const depthCache = new Map<string, number>()
    const visibleNodeMap = new Map(visibleNodes.map(n => [n.id, n] as const))
    const depthOf = (id: string): number => {
      const cached = depthCache.get(id)
      if (cached !== undefined) return cached
      const n = visibleNodeMap.get(id)
      const d = n?.parentId ? depthOf(n.parentId) + 1 : 0
      depthCache.set(id, d)
      return d
    }
    const outerContainerNodes = visibleNodes
      .filter(n => parentIds.has(n.id) && (n.type === 'system' || n.type === 'domain' || n.type === 'group'))
      .sort((a, b) => depthOf(b.id) - depthOf(a.id))

    for (const n of outerContainerNodes) {
      const childLeafIndices: number[] = []
      const childGroupIndices: number[] = []
      for (const c of visibleNodes.filter((v) => v.parentId === n.id)) {
        const gi = groupIndex.get(c.id)
        if (gi !== undefined) childGroupIndices.push(gi)
        else {
          const ni = nodeIndex.get(c.id)
          if (ni !== undefined) childLeafIndices.push(ni)
        }
      }
      if (childLeafIndices.length + childGroupIndices.length > 0) {
        // Padding scales with nesting depth so deeply-nested systems still
        // have visual breathing room without exploding outer systems.
        const d = depthOf(n.id)
        const PAD = Math.max(60, 100 - d * 12)
        const VIS = Math.max(12, 20 - d * 2)
        const g: C4Group = {
          c4id: n.id,
          leaves: childLeafIndices.length > 0 ? childLeafIndices as any : undefined,
          groups: childGroupIndices.length > 0 ? childGroupIndices as any : undefined,
          padding: PAD,
          visualShrink: PAD - VIS,
        }
        this.colaGroups.push(g)
        groupIndex.set(n.id, this.colaGroups.length - 1)
        this.idToGroup.set(n.id, g)
      }
    }

    // ── Create d3adaptor — EXACTLY like smallgroups ──────────────────────
    //
    //   var cola = cola.d3adaptor(d3)
    //       .linkDistance(100)
    //       .avoidOverlaps(true)
    //       .handleDisconnected(false)
    //       .size([width, height]);
    //   cola.nodes(graph.nodes).links(graph.links).groups(graph.groups).start();
    //   cola.on("tick", function () { … });

    const d3Context = { dispatch, timer, drag: d3drag, event: null as any }
    const layout = d3adaptor(d3Context as any)

    layout
      .nodes(this.colaNodes)
      .links(colaLinks)
      .groups(this.colaGroups)
      .size([1800, 1200])
      .avoidOverlaps(true)
      .handleDisconnected(false)
      .linkDistance((link: any) => {
        // ── A: Hierarchical link distance ────────────────────────────────
        // Distance varies by C4 semantics so the physics produces layouts
        // closer to what the radical layout would give:
        //   • siblings inside the same parent          → short  (tight cluster)
        //   • person → system (entry edges)            → long   (push persons up)
        //   • internal ↔ external                      → longer (push externals away)
        //   • internal ↔ internal across systems       → medium
        const s = link.source as ColaNode
        const t = link.target as ColaNode
        const sn = this.allNodes[s.c4id]
        const tn = this.allNodes[t.c4id]
        const baseAvg = Math.max(
          (s.width + t.width) / 2,
          (s.height + t.height) / 2
        )
        if (sn && tn) {
          // Same direct parent: containers inside a system, components inside container
          if (sn.parentId && sn.parentId === tn.parentId) {
            return baseAvg + 40
          }
          const isPerson = sn.type === 'person' || tn.type === 'person'
          const sExt = !!sn.external
          const tExt = !!tn.external
          // External crosses internal boundary → push apart
          if (sExt !== tExt && !isPerson) return baseAvg + 160
          // Person → system (entry edge)
          if (isPerson) return baseAvg + 120
        }
        return baseAvg + 100
      })

    // ── E: Layer separation constraints ──────────────────────────────────
    // Lock the C4 ordering during continuous physics so the radical layout
    // doesn't get scrambled. Only constrain ROOT-LEVEL nodes (children of a
    // group are positioned by their group bounds — adding constraints to
    // them fights avoidOverlaps inside the group).
    //
    //   persons      → strictly above   internals + externals
    //   internals    → strictly left of externals
    //
    // Using cola separation constraints: right.axis - left.axis >= gap
    // Coordinates are CENTERS of inflated rects, so gap accounts for both
    // halves plus desired padding.
    const PERSON_GAP_PX = 80
    const EXT_GAP_PX = 100
    const personIdx: number[] = []
    const internalIdx: number[] = []
    const externalIdx: number[] = []
    this.colaNodes.forEach((cn, i) => {
      const n = this.allNodes[cn.c4id]
      if (!n || n.parentId) return
      if (n.type === 'person') personIdx.push(i)
      else if (n.external) externalIdx.push(i)
      else internalIdx.push(i)
    })
    const constraints: Array<{
      type: 'separation'
      axis: 'x' | 'y'
      left: number
      right: number
      gap: number
    }> = []
    const halfH = (i: number): number => this.colaNodes[i].height / 2
    const halfW = (i: number): number => this.colaNodes[i].width / 2
    for (const p of personIdx) {
      for (const s of [...internalIdx, ...externalIdx]) {
        constraints.push({
          type: 'separation',
          axis: 'y',
          left: p,
          right: s,
          gap: halfH(p) + halfH(s) + PERSON_GAP_PX,
        })
      }
    }
    for (const i of internalIdx) {
      for (const e of externalIdx) {
        constraints.push({
          type: 'separation',
          axis: 'x',
          left: i,
          right: e,
          gap: halfW(i) + halfW(e) + EXT_GAP_PX,
        })
      }
    }
    if (constraints.length > 0) {
      ;(layout as any).constraints(constraints)
    }

    layout.on('tick', () => {
      if (!this._running) return
      this.emitPositions()
    })

    // First start: heavy bulk iterations to settle the diagram quickly so
    // the user doesn't watch the layout slowly assemble from scratch.
    // Subsequent rebuilds (model edits): NO bulk iterations — let the live
    // d3.timer evolve positions tick-by-tick so changes animate smoothly
    // from current positions to the new equilibrium. Persisting prevPos
    // across rebuilds means newly-added nodes start near their neighbours
    // instead of jumping in from the origin.
    try {
      if (firstRun) {
        ;(layout as any).start(30, 30, 50, 0, true, true)
      } else {
        ;(layout as any).start(0, 0, 0, 0, true, false)
      }
    } catch (err) {
      console.error('[cola] start() failed:', err)
    }

    this.cola = layout

    // Restore grab state if rebuild happened during drag
    if (this._grabbedId) {
      const cn = this.idToNode.get(this._grabbedId)
      if (cn) cn.fixed = (cn.fixed ?? 0) | 2
    }
  }

  /**
   * Resolve a relation endpoint to a ColaNode.
   * If the node is directly a cola leaf, return it.
   * If the node is hidden (parent collapsed), walk UP the parent chain
   * until we find a visible cola leaf (the collapsed ancestor).
   */
  private findLeaf(nodeId: string, _visible: C4Node[]): ColaNode | undefined {
    // Direct match — node is a cola leaf
    const direct = this.idToNode.get(nodeId)
    if (direct) return direct

    // Walk UP the parent chain to find a collapsed ancestor that is a cola leaf
    let cur = this.allNodes[nodeId]
    while (cur?.parentId) {
      const parent = this.allNodes[cur.parentId]
      if (!parent) break
      const pLeaf = this.idToNode.get(parent.id)
      if (pLeaf) return pLeaf
      cur = parent
    }
    return undefined
  }

  // ─── Emit positions to store ───────────────────────────────────────────────
  // Reads absolute positions from cola nodes/groups, converts to RF-relative.

  private emitPositions(): void {
    // 1. Collect absolute top-left positions from cola
    const abs: Record<string, { x: number; y: number; width?: number; height?: number }> = {}

    // While the user is dragging a parent (group), ReactFlow moves the
    // parent + its children visually on its own. If we also emit cola
    // positions for them, RF gets two competing position sources every
    // tick and the parent flickers. So compute the set of ids to skip:
    // the grabbed node itself + (if it's a group) all its descendants.
    const skip = new Set<string>()
    if (this._grabbedId) {
      skip.add(this._grabbedId)
      const grabbedGroup = this.idToGroup.get(this._grabbedId)
      if (grabbedGroup) {
        const collect = (gid: string) => {
          const g = this.idToGroup.get(gid)
          if (!g) return
          if (g.leaves) {
            for (const leaf of g.leaves as any[]) {
              const cn = typeof leaf === 'number' ? this.colaNodes[leaf] : leaf
              if (cn?.c4id) skip.add(cn.c4id)
            }
          }
          if (g.groups) {
            for (const child of g.groups as any[]) {
              const childGroup = typeof child === 'number' ? this.colaGroups[child] : child
              const childId = (childGroup as C4Group)?.c4id
              if (childId) { skip.add(childId); collect(childId) }
            }
          }
        }
        collect(this._grabbedId)
      }
    }

    for (const cn of this.colaNodes) {
      if (skip.has(cn.c4id)) continue
      abs[cn.c4id] = { x: cn.x - cn.realWidth / 2, y: cn.y - cn.realHeight / 2 }
    }
    for (const g of this.colaGroups) {
      if (skip.has(g.c4id)) continue
      const b = (g as any).bounds
      if (b) {
        // Shrink the rendered box vs collision box so sibling groups don't
        // share borders. Collision uses bounds at full `padding`; we render
        // at `padding - visualShrink` ≈ a small visible inner padding.
        const s = g.visualShrink ?? 0
        abs[g.c4id] = {
          x: b.x + s,
          y: b.y + s,
          width: (b.X - b.x) - 2 * s,
          height: (b.Y - b.y) - 2 * s,
        }
      }
    }

    // 2. Convert to RF-relative (subtract parent's absolute position)
    const result: Record<string, { x: number; y: number; width?: number; height?: number }> = {}
    for (const [id, pos] of Object.entries(abs)) {
      const c4n = this.allNodes[id]
      if (c4n?.parentId && abs[c4n.parentId]) {
        const p = abs[c4n.parentId]
        result[id] = { x: pos.x - p.x, y: pos.y - p.y, width: pos.width, height: pos.height }
      } else {
        result[id] = pos
      }
    }

    this.callbacks.applyPositions(result)
  }
}

