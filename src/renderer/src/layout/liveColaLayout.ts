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
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function effectiveWidth(n: C4Node): number {
  if ((n.type === 'system' || n.type === 'container') && n.collapsed)
    return COLLAPSED_WIDTH[n.type]
  return n.width ?? NODE_SIZES[n.type].width
}

function effectiveHeight(n: C4Node): number {
  if ((n.type === 'system' || n.type === 'container') && n.collapsed)
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
  private _grabbedId: string | null = null
  private allNodes: Record<string, C4Node> = {}

  constructor(callbacks: LiveColaCallbacks) {
    this.callbacks = callbacks
  }

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  start(): void {
    if (this._running) return
    this._running = true
    this.rebuild()
  }

  stop(): void {
    this._running = false
    if (this.cola) { this.cola.stop(); this.cola = null }
    this.colaNodes = []
    this.colaGroups = []
    this.idToNode.clear()
    this.idToGroup.clear()
    this._grabbedId = null
  }

  get running(): boolean {
    return this._running
  }

  invalidate(): void {
    if (this._running) this.rebuild()
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

  private rebuild(): void {
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

    for (const n of leafNodes) {
      const w = effectiveWidth(n)
      const h = effectiveHeight(n)

      const prev = prevPos.get(n.id)
      let cx: number, cy: number
      if (prev) {
        cx = prev.x
        cy = prev.y
      } else {
        const abs = toAbsoluteTopLeft(n, nodes)
        cx = abs.x + w / 2
        cy = abs.y + h / 2
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

    // ── Groups bottom-up (containers then systems) ──────────────────────
    for (const n of visibleNodes) {
      if (!parentIds.has(n.id) || n.type !== 'container') continue
      const leafIndices = leafNodes
        .filter((c) => c.parentId === n.id)
        .map((c) => nodeIndex.get(c.id))
        .filter((i) => i !== undefined) as number[]
      if (leafIndices.length > 0) {
        const g: C4Group = { c4id: n.id, leaves: leafIndices as any, padding: 100 }
        this.colaGroups.push(g)
        this.idToGroup.set(n.id, g)
      }
    }

    // Build group index map (container groups have been added above)
    const groupIndex = new Map<string, number>()
    this.colaGroups.forEach((g, i) => groupIndex.set(g.c4id, i))

    for (const n of visibleNodes) {
      if (!parentIds.has(n.id) || n.type !== 'system') continue
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
        const g: C4Group = {
          c4id: n.id,
          leaves: childLeafIndices.length > 0 ? childLeafIndices as any : undefined,
          groups: childGroupIndices.length > 0 ? childGroupIndices as any : undefined,
          padding: 120,
        }
        this.colaGroups.push(g)
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
        // Compute ideal distance based on the two endpoint node sizes.
        // This keeps nodes separated proportionally to their dimensions
        // instead of a single fixed value that's too big for small nodes
        // or too small for large nodes.
        const s = link.source as ColaNode
        const t = link.target as ColaNode
        const avgW = (s.width + t.width) / 2
        const avgH = (s.height + t.height) / 2
        return Math.max(avgW, avgH) + 200
      })

    layout.on('tick', () => {
      if (!this._running) return
      this.emitPositions()
    })

    // Like smallgroups: .start() — keepRunning=true starts the d3.timer.
    // The timer fires tick() each frame. When stress < threshold → stops.
    try {
      layout.start()
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

    for (const cn of this.colaNodes) {
      if (cn.c4id === this._grabbedId) continue
      abs[cn.c4id] = { x: cn.x - cn.realWidth / 2, y: cn.y - cn.realHeight / 2 }
    }
    for (const g of this.colaGroups) {
      const b = (g as any).bounds
      if (b) {
        abs[g.c4id] = { x: b.x, y: b.y, width: b.X - b.x, height: b.Y - b.y }
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

