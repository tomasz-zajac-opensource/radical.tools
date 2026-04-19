import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import {
  Node,
  Edge,
  NodeChange,
  EdgeChange,
  applyNodeChanges,
  applyEdgeChanges,
  MarkerType,
  Connection,
} from 'reactflow'
import {
  C4Node,
  C4Relation,
  C4NodeRFData,
  C4EdgeRFData,
  DiagramData,
  DiagramView,
  DiagramSnapshot,
  NodePosition,
  NODE_SIZES,
  COLLAPSED_HEIGHT,
  COLLAPSED_WIDTH,
} from '../types/c4'
import { applyElkLayout } from '../layout/elkLayout'
import { applyColaLayout } from '../layout/colaLayout'
import { applyRadicalLayout } from '../layout/radicalLayout'
import { applyReferenceLayout } from '../layout/referenceLayout'
import { minimizeCrossings } from '../layout/crossingOpt'
import { LiveColaLayout } from '../layout/liveColaLayout'

// ─── helpers ────────────────────────────────────────────────────────────────

function uid(): string {
  return crypto.randomUUID()
}

// ─── Undo / Redo history ────────────────────────────────────────────────────

interface HistoryEntry {
  c4Nodes: Record<string, C4Node>
  c4Relations: Record<string, C4Relation>
}

const MAX_HISTORY = 100
const _undoStack: HistoryEntry[] = []
const _redoStack: HistoryEntry[] = []

function _captureState(state: DiagramStore): HistoryEntry {
  return {
    c4Nodes: JSON.parse(JSON.stringify(state.c4Nodes)),
    c4Relations: JSON.parse(JSON.stringify(state.c4Relations)),
  }
}

function _pushUndo(state: DiagramStore): void {
  _undoStack.push(_captureState(state))
  if (_undoStack.length > MAX_HISTORY) _undoStack.shift()
  _redoStack.length = 0 // clear redo on new change
}

/** Snapshot all node positions from c4Nodes into a positions map */
function snapshotPositions(nodes: Record<string, C4Node>): Record<string, NodePosition> {
  const result: Record<string, NodePosition> = {}
  for (const [id, n] of Object.entries(nodes)) {
    result[id] = { x: n.x, y: n.y, width: n.width, height: n.height }
  }
  return result
}

/** Apply a positions map onto c4Nodes (mutates in-place, use inside immer set) */
function applyPositions(nodes: Record<string, C4Node>, positions: Record<string, NodePosition>): void {
  for (const [id, pos] of Object.entries(positions)) {
    const n = nodes[id]
    if (n) { n.x = pos.x; n.y = pos.y; n.width = pos.width; n.height = pos.height }
  }
}

/** Compute the effective set of node IDs for a view: explicit nodeIds + all their ancestors */
function computeViewNodeSet(view: DiagramView | undefined, nodes: Record<string, C4Node>): Set<string> | undefined {
  if (!view) return undefined
  const result = new Set<string>()
  for (const id of view.nodeIds) {
    let cur = id
    while (cur && nodes[cur]) {
      result.add(cur)
      cur = nodes[cur].parentId ?? ''
    }
  }
  return result
}

/**
 * Compute which nodes should be treated as collapsed in a view.
 * A parent (system/container) is view-collapsed if:
 * - it has children in the full model, AND
 * - none of those children are in the view filter, AND
 * - it is not already collapsed on the model.
 * Returns empty set when no view filter is active.
 */
function computeViewCollapsedSet(
  viewFilter: Set<string> | undefined,
  allNodes: Record<string, C4Node>
): Set<string> {
  const result = new Set<string>()
  if (!viewFilter) return result

  // Which parents have at least one child in the view?
  const parentHasViewChild = new Set<string>()
  for (const n of Object.values(allNodes)) {
    if (n.parentId && viewFilter.has(n.id)) parentHasViewChild.add(n.parentId)
  }

  for (const [id, n] of Object.entries(allNodes)) {
    if (!viewFilter.has(id)) continue
    if (n.type !== 'system' && n.type !== 'container') continue
    if (n.collapsed) continue // already collapsed on the model
    if (parentHasViewChild.has(id)) continue // has visible children

    // Check it actually has children in the full model
    const hasChildInModel = Object.values(allNodes).some(c => c.parentId === id)
    if (hasChildInModel) result.add(id)
  }
  return result
}

/** Is the node effectively collapsed (model-collapsed OR view-collapsed)? */
function isEffectivelyCollapsed(
  node: C4Node,
  viewCollapsedSet?: Set<string>
): boolean {
  return node.collapsed || (viewCollapsedSet?.has(node.id) ?? false)
}

/** Return the subset of nodes/relations visible in the active view (or all if no view). */
function filterForView(
  allNodes: Record<string, C4Node>,
  allRelations: Record<string, C4Relation>,
  viewFilter: Set<string> | undefined,
  viewCollapsedSet?: Set<string>
): { nodes: Record<string, C4Node>; relations: Record<string, C4Relation> } {
  if (!viewFilter) return { nodes: allNodes, relations: allRelations }
  const nodes: Record<string, C4Node> = {}
  for (const [id, n] of Object.entries(allNodes)) {
    if (viewFilter.has(id)) {
      nodes[id] = viewCollapsedSet?.has(id) ? { ...n, collapsed: true } : n
    }
  }

  const relations: Record<string, C4Relation> = {}
  for (const [id, r] of Object.entries(allRelations)) {
    if (viewFilter.has(r.sourceId) && viewFilter.has(r.targetId)) relations[id] = r
  }
  return { nodes, relations }
}

/**
 * Walk up the parent chain. Returns true if the node is hidden because
 * one of its ancestors is collapsed (model or view-collapsed).
 */
function isNodeHidden(
  nodeId: string,
  nodes: Record<string, C4Node>,
  viewCollapsedSet?: Set<string>
): boolean {
  const node = nodes[nodeId]
  if (!node || !node.parentId) return false
  const parent = nodes[node.parentId]
  if (!parent) return false
  if (isEffectivelyCollapsed(parent, viewCollapsedSet)) return true
  return isNodeHidden(node.parentId, nodes, viewCollapsedSet)
}

/**
 * Returns the id of the deepest visible ancestor for a given node.
 * If the node itself is visible, returns nodeId unchanged.
 */
function getVisibleAncestor(
  nodeId: string,
  nodes: Record<string, C4Node>,
  viewCollapsedSet?: Set<string>
): string {
  if (!isNodeHidden(nodeId, nodes, viewCollapsedSet)) return nodeId
  const node = nodes[nodeId]
  if (!node || !node.parentId) return nodeId
  return getVisibleAncestor(node.parentId, nodes, viewCollapsedSet)
}

/**
 * View-aware version: walks up until the node is both visible (not collapsed)
 * AND present in the view filter. Used by deriveRFEdges to aggregate children
 * edges onto their view-visible parent.
 */
function getViewVisibleAncestor(
  nodeId: string,
  nodes: Record<string, C4Node>,
  viewFilter: Set<string> | undefined,
  viewCollapsedSet?: Set<string>
): string {
  // Without a view filter, fall back to normal collapse logic
  if (!viewFilter) return getVisibleAncestor(nodeId, nodes, viewCollapsedSet)
  // Walk up until we find a node in the view that isn't hidden
  let cur = nodeId
  while (cur) {
    if (viewFilter.has(cur) && !isNodeHidden(cur, nodes, viewCollapsedSet)) return cur
    const node = nodes[cur]
    if (!node?.parentId) break
    cur = node.parentId
  }
  // Fallback: return whatever getVisibleAncestor gives
  return getVisibleAncestor(nodeId, nodes, viewCollapsedSet)
}

/** Return all descendant node ids (children, grandchildren, …) */
function getDescendants(nodeId: string, nodes: Record<string, C4Node>): string[] {
  const result: string[] = []
  function walk(id: string) {
    for (const n of Object.values(nodes)) {
      if (n.parentId === id) {
        result.push(n.id)
        walk(n.id)
      }
    }
  }
  walk(nodeId)
  return result
}

/** Effective rendered height of a node (respects collapse + view collapse). */
function effectiveNodeHeight(n: C4Node, viewCollapsedSet?: Set<string>): number {
  if ((n.type === 'system' || n.type === 'container') && isEffectivelyCollapsed(n, viewCollapsedSet)) {
    return COLLAPSED_HEIGHT[n.type]
  }
  return n.height
}

/** Effective rendered width of a node (respects collapse + view collapse). */
function effectiveNodeWidth(n: C4Node, viewCollapsedSet?: Set<string>): number {
  if ((n.type === 'system' || n.type === 'container') && isEffectivelyCollapsed(n, viewCollapsedSet)) {
    return COLLAPSED_WIDTH[n.type]
  }
  return n.width
}

/**
 * Multi-pass sibling overlap separation.
 * The dragged node stays fixed; siblings on the same parent level are pushed
 * apart until there are no more overlaps or max iterations are reached.
 * Returns a map of id → new {x, y} for nodes that actually moved.
 */
const COLLISION_MARGIN = 10

function separateSiblings(
  draggedId: string,
  nodes: Record<string, C4Node>
): Record<string, { x: number; y: number }> {
  const dragged = nodes[draggedId]
  if (!dragged) return {}

  // Visible siblings at the same parent level
  const siblings = Object.values(nodes).filter(
    (n) => n.parentId === dragged.parentId && !isNodeHidden(n.id, nodes)
  )
  if (siblings.length < 2) return {}

  // Working copy of mutable positions
  const pos: Record<string, { x: number; y: number; w: number; h: number }> = {}
  for (const n of siblings) {
    pos[n.id] = { x: n.x, y: n.y, w: effectiveNodeWidth(n), h: effectiveNodeHeight(n) }
  }

  const hasParent = !!dragged.parentId

  for (let pass = 0; pass < 20; pass++) {
    let anyOverlap = false

    for (let i = 0; i < siblings.length; i++) {
      for (let j = i + 1; j < siblings.length; j++) {
        const a = siblings[i]
        const b = siblings[j]
        const pa = pos[a.id]
        const pb = pos[b.id]

        const ox = Math.min(pa.x + pa.w, pb.x + pb.w) - Math.max(pa.x, pb.x) + COLLISION_MARGIN
        const oy = Math.min(pa.y + pa.h, pb.y + pb.h) - Math.max(pa.y, pb.y) + COLLISION_MARGIN

        if (ox > 0 && oy > 0) {
          anyOverlap = true
          const fixA = a.id === draggedId
          const fixB = b.id === draggedId

          if (ox <= oy) {
            const dir = pa.x < pb.x ? 1 : -1
            if (fixA) {
              pb.x += dir * ox
              // If pushed past parent boundary, split: clamp sibling, push dragged
              if (hasParent && pb.x < 0) {
                pa.x += -pb.x  // push dragged by the overflow amount
                pb.x = 0
              }
            } else if (fixB) {
              pa.x -= dir * ox
              if (hasParent && pa.x < 0) {
                pb.x += -pa.x
                pa.x = 0
              }
            } else {
              pa.x -= dir * ox / 2
              pb.x += dir * ox / 2
              if (hasParent) {
                if (pa.x < 0) { pb.x += -pa.x; pa.x = 0 }
                if (pb.x < 0) { pa.x += -pb.x; pb.x = 0 }
              }
            }
          } else {
            const dir = pa.y < pb.y ? 1 : -1
            if (fixA) {
              pb.y += dir * oy
              if (hasParent && pb.y < 0) {
                pa.y += -pb.y
                pb.y = 0
              }
            } else if (fixB) {
              pa.y -= dir * oy
              if (hasParent && pa.y < 0) {
                pb.y += -pa.y
                pa.y = 0
              }
            } else {
              pa.y -= dir * oy / 2
              pb.y += dir * oy / 2
              if (hasParent) {
                if (pa.y < 0) { pb.y += -pa.y; pa.y = 0 }
                if (pb.y < 0) { pa.y += -pb.y; pb.y = 0 }
              }
            }
          }
        }
      }
    }

    if (!anyOverlap) break
  }

  // ── Final sweep: resolve chain overlaps among non-dragged siblings ────────
  // The pairwise solver can fail when 3+ elements form a chain (C pushes B
  // into A). A linear sweep guarantees no overlaps between non-dragged nodes.
  if (hasParent) {
    const nonDragged = siblings.filter(s => s.id !== draggedId)

    // Horizontal sweep (left → right): only for elements on the same row
    nonDragged.sort((a, b) => pos[a.id].x - pos[b.id].x)
    for (let k = 0; k < nonDragged.length; k++) {
      const p = pos[nonDragged[k].id]
      if (p.x < 0) p.x = 0
      if (k > 0) {
        const prev = pos[nonDragged[k - 1].id]
        // Only adjust if they actually overlap vertically (same row)
        const vyOverlap = Math.min(prev.y + prev.h, p.y + p.h) - Math.max(prev.y, p.y)
        if (vyOverlap > 0) {
          const minX = prev.x + prev.w + COLLISION_MARGIN
          if (p.x < minX) p.x = minX
        }
      }
    }

    // Vertical sweep (top → bottom): only for elements in the same column
    nonDragged.sort((a, b) => pos[a.id].y - pos[b.id].y)
    for (let k = 0; k < nonDragged.length; k++) {
      const p = pos[nonDragged[k].id]
      if (p.y < 0) p.y = 0
      if (k > 0) {
        const prev = pos[nonDragged[k - 1].id]
        // Only adjust if they actually overlap horizontally (same column)
        const vxOverlap = Math.min(prev.x + prev.w, p.x + p.w) - Math.max(prev.x, p.x)
        if (vxOverlap > 0) {
          const minY = prev.y + prev.h + COLLISION_MARGIN
          if (p.y < minY) p.y = minY
        }
      }
    }
  }

  // Return only nodes that actually moved
  const result: Record<string, { x: number; y: number }> = {}
  for (const sib of siblings) {
    if (pos[sib.id].x !== sib.x || pos[sib.id].y !== sib.y) {
      result[sib.id] = { x: pos[sib.id].x, y: pos[sib.id].y }
    }
  }
  return result
}

// ─── RF state derivation ─────────────────────────────────────────────────────

function deriveRFNodes(
  nodes: Record<string, C4Node>,
  viewFilter?: Set<string>,
  viewCollapsedSet?: Set<string>
): Node<C4NodeRFData>[] {
  const rfNodes: Node<C4NodeRFData>[] = []

  // Sort so parents appear before children (React Flow requirement)
  const sorted = Object.values(nodes)
    .filter((n) => !viewFilter || viewFilter.has(n.id))
    .sort((a, b) => {
    if (!a.parentId && b.parentId) return -1
    if (a.parentId && !b.parentId) return 1
    // container before component
    if (a.type === 'system' && b.type !== 'system') return -1
    if (a.type !== 'system' && b.type === 'system') return 1
    if ((a.type === 'container' || a.type === 'database') && b.type === 'component') return -1
    if (a.type === 'component' && (b.type === 'container' || b.type === 'database')) return 1
    return 0
  })

  // Pre-compute which nodes have children (in the full model)
  const parentSet = new Set(Object.values(nodes).map((n) => n.parentId).filter(Boolean))

  for (const n of sorted) {
    const hidden = isNodeHidden(n.id, nodes, viewCollapsedSet)
    const hasChildren = parentSet.has(n.id)
    const collapsed = isEffectivelyCollapsed(n, viewCollapsedSet)
    const effHeight =
      (n.type === 'system' || n.type === 'container') && collapsed
        ? COLLAPSED_HEIGHT[n.type]
        : n.height
    const effWidth =
      (n.type === 'system' || n.type === 'container') && collapsed
        ? COLLAPSED_WIDTH[n.type]
        : n.width

    rfNodes.push({
      id: n.id,
      type: n.type,
      position: { x: n.x, y: n.y },
      parentNode: n.parentId,
      extent: undefined,
      expandParent: false,
      hidden,
      selectable: !hidden,
      draggable: !hidden,
      data: {
        c4id: n.id,
        type: n.type,
        label: n.label,
        description: n.description,
        technology: n.technology,
        parentId: n.parentId,
        collapsed,
        external: n.external,
        width: effWidth,
        height: effHeight,
        hasChildren,
      },
      style: {
        width: effWidth,
        height: effHeight,
      },
      width: effWidth,
      height: effHeight,
      zIndex: n.type === 'system' ? 0 : n.type === 'container' ? 1 : 2,
    })
  }
  return rfNodes
}

function deriveRFEdges(
  nodes: Record<string, C4Node>,
  relations: Record<string, C4Relation>,
  viewFilter?: Set<string>,
  viewCollapsedSet?: Set<string>
): Edge<C4EdgeRFData>[] {
  const rfEdges: Edge<C4EdgeRFData>[] = []
  // Track virtual edges already emitted to avoid duplicates
  const seen = new Set<string>()

  for (const rel of Object.values(relations)) {
    if (!nodes[rel.sourceId] || !nodes[rel.targetId]) continue

    const visSource = getViewVisibleAncestor(rel.sourceId, nodes, viewFilter, viewCollapsedSet)
    const visTarget = getViewVisibleAncestor(rel.targetId, nodes, viewFilter, viewCollapsedSet)

    if (visSource === visTarget) continue // collapsed to same ancestor → self-loop, skip

    // If filtering by view, both endpoints must be in the view
    if (viewFilter && (!viewFilter.has(visSource) || !viewFilter.has(visTarget))) continue

    const key = `${visSource}→${visTarget}`
    const isVirtual = visSource !== rel.sourceId || visTarget !== rel.targetId

    if (seen.has(key)) {
      // Append label to existing edge instead of duplicating
      const existing = rfEdges.find(
        (e) => e.source === visSource && e.target === visTarget
      )
      if (existing && rel.label) {
        existing.label = existing.label ? `${existing.label}\n${rel.label}` : rel.label
      }
      continue
    }
    seen.add(key)

    // Edge must render above the parent containers of its endpoints so it's
    // not hidden behind them. Compute zIndex as max node zIndex + 1.
    const nodeZIndexMap: Record<string, number> = {
      person: 0, system: 0, container: 1, component: 2,
    }
    const srcType = nodes[visSource]?.type ?? 'person'
    const tgtType = nodes[visTarget]?.type ?? 'person'
    const edgeZIndex =
      Math.max(nodeZIndexMap[srcType] ?? 0, nodeZIndexMap[tgtType] ?? 0) + 1

    rfEdges.push({
      id: isVirtual ? `virtual-${key}` : rel.id,
      source: visSource,
      target: visTarget,
      type: 'c4relation',
      animated: false,
      zIndex: edgeZIndex,
      markerEnd: { type: MarkerType.ArrowClosed, color: '#94a3b8' },
      style: { stroke: '#94a3b8', strokeWidth: 1.5 },
      label: rel.label,
      data: {
        originalSourceId: rel.sourceId,
        originalTargetId: rel.targetId,
        label: rel.label,
        technology: rel.technology,
        isVirtual,
      },
    })
  }
  return rfEdges
}

// ─── Sample diagram ──────────────────────────────────────────────────────────

function buildSampleDiagram(): { nodes: Record<string, C4Node>; relations: Record<string, C4Relation> } {
  const nodes: Record<string, C4Node> = {}
  const relations: Record<string, C4Relation> = {}

  const add = (n: C4Node) => { nodes[n.id] = n }
  const rel = (r: C4Relation) => { relations[r.id] = r }

  // ── 1 system + 3 containers (minimal reference model) ─────────────────────
  add({ id: 'sys1', type: 'system', label: 'Platform', description: 'Main system', collapsed: false, x: 200, y: 100, width: 800, height: 500 })

  add({ id: 'ctn1', type: 'container', label: 'Frontend',   technology: 'React',    description: 'Web UI',        parentId: 'sys1', collapsed: false, x:  30, y:  60, ...NODE_SIZES.container })
  add({ id: 'ctn2', type: 'container', label: 'API',        technology: 'Node.js',  description: 'REST API',      parentId: 'sys1', collapsed: false, x: 280, y:  60, ...NODE_SIZES.container })
  add({ id: 'ctn3', type: 'container', label: 'Database',   technology: 'Postgres', description: 'Data storage',  parentId: 'sys1', collapsed: false, x: 530, y:  60, ...NODE_SIZES.container })

  // Relations: Frontend → API → Database
  rel({ id: 'r01', sourceId: 'ctn1', targetId: 'ctn2', label: 'Calls', technology: 'HTTPS' })
  rel({ id: 'r02', sourceId: 'ctn2', targetId: 'ctn3', label: 'Reads/writes', technology: 'SQL' })

  return { nodes, relations }
}

// ─── Store interface ─────────────────────────────────────────────────────────

interface DiagramStore {
  // ── raw C4 model ──
  c4Nodes: Record<string, C4Node>
  c4Relations: Record<string, C4Relation>

  // ── views ──
  views: Record<string, DiagramView>
  activeViewId: string | null
  /** Positions for the "All" (default) view */
  defaultPositions: Record<string, NodePosition>

  // ── derived React Flow state ──
  rfNodes: Node<C4NodeRFData>[]
  rfEdges: Edge<C4EdgeRFData>[]

  // ── UI state ──
  selectedNodeId: string | null
  selectedEdgeId: string | null
  layoutMode: 'elk' | 'cola' | 'radical'
  isLayoutRunning: boolean
  liveLayoutActive: boolean

  // ── connect mode ──
  connectSource: string | null
  connectionModifier: 'shift' | 'ctrl' | 'alt' | 'meta'

  // ── actions: nodes ──
  addNode: (node: Omit<C4Node, 'id'>) => string
  updateNode: (id: string, updates: Partial<Omit<C4Node, 'id'>>) => void
  removeNode: (id: string) => void
  toggleCollapse: (id: string) => void

  // ── actions: relations ──
  addRelation: (rel: Omit<C4Relation, 'id'>) => void
  updateRelation: (id: string, updates: Partial<Omit<C4Relation, 'id'>>) => void
  removeRelation: (id: string) => void
  onConnect: (connection: Connection) => void

  // ── actions: selection ──
  selectNode: (id: string | null) => void
  selectEdge: (id: string | null) => void

  // ── actions: views ──
  addView: (name: string) => string
  removeView: (id: string) => void
  renameView: (id: string, name: string) => void
  setActiveView: (id: string | null) => void
  addNodeToView: (viewId: string, nodeId: string) => void
  removeNodeFromView: (viewId: string, nodeId: string) => void

  // ── actions: React Flow sync ──
  onNodesChange: (changes: NodeChange[]) => void
  onEdgesChange: (changes: EdgeChange[]) => void
  fitParentToChildren: (parentId: string, viewFilter?: Set<string>, viewCollapsedSet?: Set<string>) => void
  resolveOverlaps: (draggedId: string) => void

  // ── actions: layout ──
  runElkLayout: () => Promise<void>
  runColaLayout: () => void
  runRadicalLayout: () => void
  runReferenceLayout: () => void
  setLayoutMode: (mode: 'elk' | 'cola' | 'radical') => void
  startLiveLayout: () => void
  stopLiveLayout: () => void
  liveGrab: (nodeId: string, x: number, y: number) => void
  liveDrag: (nodeId: string, x: number, y: number) => void
  liveRelease: (nodeId: string) => void
  setConnectionModifier: (mod: 'shift' | 'ctrl' | 'alt' | 'meta') => void
  startConnection: (sourceId: string) => void
  cancelConnection: () => void

  // ── actions: diagram I/O ──
  newDiagram: () => void
  loadDiagram: (data: DiagramData) => void
  saveDiagram: () => DiagramData
  resetDiagram: () => void

  // ── actions: undo / redo ──
  undo: () => void
  redo: () => void
  canUndo: boolean
  canRedo: boolean

  // ── actions: snapshots (versions) ──
  snapshots: DiagramSnapshot[]
  createSnapshot: (name: string) => string
  restoreSnapshot: (id: string) => void
  removeSnapshot: (id: string) => void
  renameSnapshot: (id: string, name: string) => void

  // ── actions: viewport ──
  autoFitActive: boolean
  setFitViewFn: (fn: (() => void) | null, instantFn?: (() => void) | null) => void
  fitAll: () => void
  toggleAutoFit: () => void

  // ── internal ──
  _sync: () => void
  _pushUndo: () => void
  _resizeParentsBottomUp: (viewFilter?: Set<string>, viewCollapsedSet?: Set<string>) => void
}

// ─── Live layout singleton (not serialisable → kept outside store) ───────────

let _liveLayout: LiveColaLayout | null = null
let _fitViewFn: (() => void) | null = null
let _fitViewInstantFn: (() => void) | null = null

// Use window to survive HMR module reloads
const _getAutoFitTimer = (): ReturnType<typeof setInterval> | null =>
  (window as any).__radicalAutoFitTimer ?? null
const _setAutoFitTimer = (t: ReturnType<typeof setInterval> | null) => {
  (window as any).__radicalAutoFitTimer = t
}

// ─── Store implementation ────────────────────────────────────────────────────

export const useDiagramStore = create<DiagramStore>()(
  immer((set, get) => {
    const sample = buildSampleDiagram()

    return {
      c4Nodes: sample.nodes,
      c4Relations: sample.relations,
      views: {},
      activeViewId: null,
      defaultPositions: snapshotPositions(sample.nodes),
      rfNodes: deriveRFNodes(sample.nodes),
      rfEdges: deriveRFEdges(sample.nodes, sample.relations),
      selectedNodeId: null,
      selectedEdgeId: null,
      layoutMode: 'radical',
      isLayoutRunning: false,
      liveLayoutActive: true,
      connectSource: null,
      connectionModifier: 'alt' as const,
      autoFitActive: false,
      canUndo: false,
      canRedo: false,
      snapshots: [],

      // ── sync helper ──────────────────────────────────────────────────────
      _sync() {
        set((state) => {
          const view = state.activeViewId ? state.views[state.activeViewId] : undefined
          const filter = computeViewNodeSet(view as DiagramView | undefined, state.c4Nodes as Record<string, C4Node>)
          const vcs = computeViewCollapsedSet(filter, state.c4Nodes as Record<string, C4Node>)
          state.rfNodes = deriveRFNodes(state.c4Nodes as Record<string, C4Node>, filter, vcs) as any
          state.rfEdges = deriveRFEdges(state.c4Nodes as Record<string, C4Node>, state.c4Relations as Record<string, C4Relation>, filter, vcs) as any
        })
      },

      /** Push current state to undo stack and sync canUndo/canRedo flags */
      _pushUndo() {
        _pushUndo(get())
        set((state) => { state.canUndo = true; state.canRedo = false })
      },

      // ── nodes ────────────────────────────────────────────────────────────
      addNode(node) {
        get()._pushUndo()
        const id = uid()
        set((state) => {
          state.c4Nodes[id] = { id, ...node }
          // Auto-add to active view
          if (state.activeViewId && state.views[state.activeViewId]) {
            state.views[state.activeViewId].nodeIds.push(id)
          }
        })
        get()._sync()
        _liveLayout?.invalidate()
        return id
      },

      updateNode(id, updates) {
        get()._pushUndo()
        set((state) => {
          if (!state.c4Nodes[id]) return
          Object.assign(state.c4Nodes[id], updates)
        })
        get()._sync()
        _liveLayout?.invalidate()
      },

      removeNode(id) {
        get()._pushUndo()
        set((state) => {
          // Remove node and all its descendants
          const toRemove = new Set([id, ...getDescendants(id, state.c4Nodes)])
          for (const nid of toRemove) delete state.c4Nodes[nid]
          // Remove relations touching removed nodes
          for (const [rid, rel] of Object.entries(state.c4Relations)) {
            if (toRemove.has(rel.sourceId) || toRemove.has(rel.targetId)) {
              delete state.c4Relations[rid]
            }
          }
          // Remove from all views
          for (const view of Object.values(state.views)) {
            view.nodeIds = view.nodeIds.filter((nid) => !toRemove.has(nid))
          }
        })
        get()._sync()
        _liveLayout?.invalidate()
      },

      toggleCollapse(id) {
        get()._pushUndo()
        set((state) => {
          const node = state.c4Nodes[id]
          if (!node) return
          node.collapsed = !node.collapsed
        })
        get()._sync()

        // Walk up the ancestor chain:
        // At each level: separate siblings of current node, then refit the parent.
        // This propagates size changes upward so grandparent containers also shrink/grow.
        let currentId: string | undefined = id
        while (currentId) {
          const overlapUpdates = separateSiblings(currentId, get().c4Nodes)
          if (Object.keys(overlapUpdates).length > 0) {
            set((state) => {
              for (const [sid, pos] of Object.entries(overlapUpdates)) {
                const n = state.c4Nodes[sid]
                if (n) { n.x = pos.x; n.y = pos.y }
              }
            })
          }

          const current: C4Node | undefined = get().c4Nodes[currentId]
          if (current?.parentId) {
            get().fitParentToChildren(current.parentId)
            currentId = current.parentId
          } else {
            break
          }
        }

        get()._sync()
        _liveLayout?.invalidate()
      },

      // ── relations ────────────────────────────────────────────────────────
      addRelation(rel) {
        get()._pushUndo()
        const id = uid()
        set((state) => {
          state.c4Relations[id] = { id, ...rel }
        })
        get()._sync()
        _liveLayout?.invalidate()
      },

      updateRelation(id, updates) {
        get()._pushUndo()
        set((state) => {
          if (!state.c4Relations[id]) return
          Object.assign(state.c4Relations[id], updates)
        })
        get()._sync()
      },

      removeRelation(id) {
        get()._pushUndo()
        set((state) => {
          delete state.c4Relations[id]
        })
        get()._sync()
        _liveLayout?.invalidate()
      },

      onConnect(connection) {
        if (!connection.source || !connection.target) return
        if (connection.source === connection.target) return
        get().addRelation({ sourceId: connection.source, targetId: connection.target })
      },

      // ── selection ────────────────────────────────────────────────────────
      selectNode(id) {
        set((state) => {
          state.selectedNodeId = id
          if (id) state.selectedEdgeId = null
        })
      },

      selectEdge(id) {
        set((state) => {
          state.selectedEdgeId = id
          if (id) state.selectedNodeId = null
        })
      },

      // ── views ────────────────────────────────────────────────────────────
      addView(name) {
        const id = uid()
        set((state) => {
          state.views[id] = { id, name, nodeIds: [], positions: {} }
        })
        return id
      },
      removeView(id) {
        set((state) => {
          delete state.views[id]
          if (state.activeViewId === id) {
            // Restore default positions before switching away
            applyPositions(state.c4Nodes as Record<string, C4Node>, state.defaultPositions as Record<string, NodePosition>)
            state.activeViewId = null
          }
        })
        get()._sync()
      },
      renameView(id, name) {
        set((state) => {
          if (state.views[id]) state.views[id].name = name
        })
      },
      setActiveView(newId) {
        const { activeViewId, c4Nodes } = get()
        if (newId === activeViewId) return

        // 1. Snapshot current positions from c4Nodes
        const currentPos = snapshotPositions(c4Nodes)

        set((state) => {
          // 2. Save to outgoing context
          if (activeViewId === null) {
            state.defaultPositions = currentPos as any
          } else if (state.views[activeViewId]) {
            state.views[activeViewId].positions = currentPos as any
          }

          // 3. Load from incoming context
          let incoming: Record<string, NodePosition> | undefined
          if (newId === null) {
            incoming = state.defaultPositions as Record<string, NodePosition>
          } else {
            const view = state.views[newId]
            if (view && Object.keys(view.positions).length > 0) {
              incoming = view.positions as Record<string, NodePosition>
            }
            // New view with no positions yet → keep current positions
          }

          if (incoming) {
            applyPositions(state.c4Nodes as Record<string, C4Node>, incoming)
          }

          state.activeViewId = newId
        })
        get()._sync()
      },
      addNodeToView(viewId, nodeId) {
        set((state) => {
          const view = state.views[viewId]
          if (view && !view.nodeIds.includes(nodeId)) view.nodeIds.push(nodeId)
        })
        get()._sync()
      },
      removeNodeFromView(viewId, nodeId) {
        set((state) => {
          const view = state.views[viewId]
          if (view) view.nodeIds = view.nodeIds.filter((id) => id !== nodeId)
        })
        get()._sync()
      },

      // ── React Flow sync ──────────────────────────────────────────────────
      onNodesChange(changes) {
        set((state) => {
          // During live layout, Cola controls non-dragged node positions.
          // But we MUST let ReactFlow's own drag position changes through
          // so the user sees immediate feedback (no 1-frame delay via Cola).
          // Filter out dimension changes from Cola — rfNodes get those via applyPositions.
          const effectiveChanges = state.liveLayoutActive
            ? changes.filter((c) => c.type !== 'dimensions')
            : changes
          state.rfNodes = applyNodeChanges(effectiveChanges, state.rfNodes) as any

          for (const change of changes) {
            if (change.type === 'select' && change.id) {
              if (change.selected) state.selectedNodeId = change.id
            }
          }
        })
      },

      onEdgesChange(changes) {
        set((state) => {
          state.rfEdges = applyEdgeChanges(changes, state.rfEdges) as any
          for (const change of changes) {
            if (change.type === 'select' && change.id && change.selected) {
              state.selectedEdgeId = change.id
            }
          }
        })
      },

      resolveOverlaps(draggedId) {
        // 1. Separate direct siblings of the dragged node
        const siblingUpdates = separateSiblings(draggedId, get().c4Nodes)
        if (Object.keys(siblingUpdates).length > 0) {
          set((state) => {
            for (const [id, pos] of Object.entries(siblingUpdates)) {
              const n = state.c4Nodes[id]
              if (n) { n.x = pos.x; n.y = pos.y }
            }
          })
        }
        // 2. Walk up ancestors: refit parent, then separate parent's siblings
        let curId: string | undefined = get().c4Nodes[draggedId]?.parentId ?? undefined
        while (curId) {
          get().fitParentToChildren(curId)
          const updates = separateSiblings(curId, get().c4Nodes)
          if (Object.keys(updates).length > 0) {
            set((state) => {
              for (const [id, pos] of Object.entries(updates)) {
                const n = state.c4Nodes[id]
                if (n) { n.x = pos.x; n.y = pos.y }
              }
            })
          }
          curId = get().c4Nodes[curId]?.parentId ?? undefined
        }
        get()._sync()
      },

      fitParentToChildren(parentId, viewFilter, viewCollapsedSet) {
        const { c4Nodes } = get()
        const parent = c4Nodes[parentId]
        if (!parent || (parent.type !== 'system' && parent.type !== 'container')) return
        // Don't resize a collapsed node (model-collapsed or view-collapsed)
        if (isEffectivelyCollapsed(parent, viewCollapsedSet)) return

        let children = Object.values(c4Nodes).filter((c) => c.parentId === parentId)
        // When a view filter is active, only consider children in the view
        if (viewFilter) children = children.filter((c) => viewFilter.has(c.id))
        if (children.length === 0) return

        // Padding matching ELK CHILD_OPTIONS (direction RIGHT, same for both levels)
        const padRight  = parent.type === 'system' ? 30 : 20
        const padBottom = parent.type === 'system' ? 30 : 20

        let maxRight = 0
        let maxBottom = 0
        for (const child of children) {
          const h = effectiveNodeHeight(child, viewCollapsedSet)
          const w = effectiveNodeWidth(child, viewCollapsedSet)
          maxRight  = Math.max(maxRight,  child.x + w)
          maxBottom = Math.max(maxBottom, child.y + h)
        }

        const newW = Math.max(maxRight + padRight, NODE_SIZES[parent.type].width)
        const newH = Math.max(maxBottom + padBottom, NODE_SIZES[parent.type].height)

        set((state) => {
          const n = state.c4Nodes[parentId]
          if (!n) return
          n.width = newW
          n.height = newH
          const rfIdx = state.rfNodes.findIndex((rn) => rn.id === parentId)
          if (rfIdx !== -1) {
            ;(state.rfNodes[rfIdx] as any).style = {
              ...(state.rfNodes[rfIdx].style ?? {}),
              width: newW,
              height: newH,
            }
            ;(state.rfNodes[rfIdx] as any).width = newW
            ;(state.rfNodes[rfIdx] as any).height = newH
          }
        })
      },

      // ── layout ───────────────────────────────────────────────────────────

      /** Resize every parent container bottom-up after children have moved. */
      _resizeParentsBottomUp(viewFilter, viewCollapsedSet) {
        const allNodes = Object.values(get().c4Nodes)
        // Only process parents that are in the view (or all if no filter)
        const relevantNodes = viewFilter
          ? allNodes.filter((n) => viewFilter.has(n.id))
          : allNodes
        const parentIds = [...new Set(
          relevantNodes.filter((n) => n.parentId).map((n) => n.parentId!)
        )]
        const nodeDepth = (id: string): number => {
          const n = get().c4Nodes[id]
          return n?.parentId ? 1 + nodeDepth(n.parentId) : 0
        }
        parentIds.sort((a, b) => nodeDepth(b) - nodeDepth(a)) // deepest first
        for (const pid of parentIds) {
          get().fitParentToChildren(pid, viewFilter, viewCollapsedSet)
        }
      },

      async runElkLayout() {
        set((state) => { state.isLayoutRunning = true })
        try {
          const state = get()
          const view = state.activeViewId ? state.views[state.activeViewId] : undefined
          const vf = computeViewNodeSet(view, state.c4Nodes)
          const vcs = computeViewCollapsedSet(vf, state.c4Nodes)
          const { nodes: c4Nodes, relations: c4Relations } = filterForView(state.c4Nodes, state.c4Relations, vf, vcs)
          const positions = await applyElkLayout(c4Nodes, c4Relations)
          set((state) => {
            for (const [id, pos] of Object.entries(positions)) {
              const node = state.c4Nodes[id]
              if (!node) continue
              node.x = pos.x
              node.y = pos.y
              if (pos.width)  node.width  = pos.width
              if (pos.height) node.height = pos.height
            }
          })

          // ── Crossing minimisation post-process ──────────────────────────
          const { nodes: viewNodes, relations: viewRels } = filterForView(get().c4Nodes, get().c4Relations, vf, vcs)
          const crossOpt = minimizeCrossings(viewNodes, viewRels)
          if (Object.keys(crossOpt).length > 0) {
            set((state) => {
              for (const [id, pos] of Object.entries(crossOpt)) {
                const n = state.c4Nodes[id]
                if (n) { n.x = pos.x; n.y = pos.y }
              }
            })
            // Swapping children positions can move large nodes past their
            // parent boundary — resize every parent to fit after the swap.
            get()._resizeParentsBottomUp(vf, vcs)
          }

          get()._sync()

          // ── Post-layout collision safety pass ───────────────────────────
          const { nodes: safetyNodes } = filterForView(get().c4Nodes, get().c4Relations, vf, vcs)
          const rootIds = Object.values(safetyNodes)
            .filter((n) => !n.parentId)
            .map((n) => n.id)
          for (const id of rootIds) {
            const updates = separateSiblings(id, safetyNodes)
            if (Object.keys(updates).length > 0) {
              set((state) => {
                for (const [sid, pos] of Object.entries(updates)) {
                  const n = state.c4Nodes[sid]
                  if (n) { n.x = pos.x; n.y = pos.y }
                }
              })
            }
          }
          if (rootIds.length > 0) get()._sync()
        } finally {
          set((state) => { state.isLayoutRunning = false })
        }
      },

      runColaLayout() {
        set((state) => { state.isLayoutRunning = true })
        try {
          const state = get()
          const view = state.activeViewId ? state.views[state.activeViewId] : undefined
          const vf = computeViewNodeSet(view, state.c4Nodes)
          const vcs = computeViewCollapsedSet(vf, state.c4Nodes)
          const { nodes: c4Nodes, relations: c4Relations } = filterForView(state.c4Nodes, state.c4Relations, vf, vcs)
          const positions = applyColaLayout(c4Nodes, c4Relations)
          set((state) => {
            for (const [id, pos] of Object.entries(positions)) {
              const node = state.c4Nodes[id]
              if (!node) continue
              node.x = pos.x
              node.y = pos.y
            }
          })

          // Cola only positions nodes — resize parent containers bottom-up
          get()._resizeParentsBottomUp(vf, vcs)

          // ── Crossing minimisation post-process ──────────────────────────
          const { nodes: viewNodes, relations: viewRels } = filterForView(get().c4Nodes, get().c4Relations, vf, vcs)
          const crossOpt = minimizeCrossings(viewNodes, viewRels)
          if (Object.keys(crossOpt).length > 0) {
            set((state) => {
              for (const [id, pos] of Object.entries(crossOpt)) {
                const n = state.c4Nodes[id]
                if (n) { n.x = pos.x; n.y = pos.y }
              }
            })
            // Swapping children can overflow parents — resize again.
            get()._resizeParentsBottomUp(vf, vcs)
          }

          get()._sync()
        } finally {
          set((state) => { state.isLayoutRunning = false })
        }
      },

      runRadicalLayout() {
        set((state) => { state.isLayoutRunning = true })
        try {
          const state = get()
          const view = state.activeViewId ? state.views[state.activeViewId] : undefined
          const vf = computeViewNodeSet(view, state.c4Nodes)
          const vcs = computeViewCollapsedSet(vf, state.c4Nodes)
          const { nodes: c4Nodes, relations: c4Relations } = filterForView(state.c4Nodes, state.c4Relations, vf, vcs)
          const positions = applyRadicalLayout(c4Nodes, c4Relations)
          set((state) => {
            for (const [id, pos] of Object.entries(positions)) {
              const node = state.c4Nodes[id]
              if (!node) continue
              node.x = pos.x
              node.y = pos.y
              if (pos.width)  node.width  = pos.width
              if (pos.height) node.height = pos.height
            }
          })

          // Resize parents bottom-up for any compound nodes not sized by radical
          get()._resizeParentsBottomUp(vf, vcs)
          get()._sync()

          // Crossing minimisation: swap siblings to reduce edge crossings/overlaps
          const { nodes: viewNodes, relations: viewRels } = filterForView(get().c4Nodes, get().c4Relations, vf, vcs)
          const crossOpt = minimizeCrossings(viewNodes, viewRels)
          if (Object.keys(crossOpt).length > 0) {
            set((state) => {
              for (const [id, pos] of Object.entries(crossOpt)) {
                const n = state.c4Nodes[id]
                if (n) { n.x = pos.x; n.y = pos.y }
              }
            })
            get()._resizeParentsBottomUp(vf, vcs)
            get()._sync()
          }

          // Post-layout collision safety
          const { nodes: safetyNodes } = filterForView(get().c4Nodes, get().c4Relations, vf, vcs)
          const rootIds = Object.values(safetyNodes)
            .filter((n) => !n.parentId)
            .map((n) => n.id)
          for (const id of rootIds) {
            const updates = separateSiblings(id, safetyNodes)
            if (Object.keys(updates).length > 0) {
              set((state) => {
                for (const [sid, pos] of Object.entries(updates)) {
                  const n = state.c4Nodes[sid]
                  if (n) { n.x = pos.x; n.y = pos.y }
                }
              })
            }
          }
          if (rootIds.length > 0) get()._sync()
        } finally {
          set((state) => { state.isLayoutRunning = false })
        }
      },

      runReferenceLayout() {
        set((state) => { state.isLayoutRunning = true })
        try {
          const state = get()
          const view = state.activeViewId ? state.views[state.activeViewId] : undefined
          const vf = computeViewNodeSet(view, state.c4Nodes)
          const vcs = computeViewCollapsedSet(vf, state.c4Nodes)
          const { nodes: c4Nodes } = filterForView(state.c4Nodes, state.c4Relations, vf, vcs)
          const positions = applyReferenceLayout(c4Nodes)
          set((state) => {
            for (const [id, pos] of Object.entries(positions)) {
              const node = state.c4Nodes[id]
              if (!node) continue
              node.x = pos.x
              node.y = pos.y
              if (pos.width)  node.width  = pos.width
              if (pos.height) node.height = pos.height
            }
          })
          get()._resizeParentsBottomUp(vf, vcs)
          get()._sync()
        } finally {
          set((state) => { state.isLayoutRunning = false })
        }
      },

      setLayoutMode(mode) {
        set((state) => { state.layoutMode = mode })
      },

      startLiveLayout() {
        if (_liveLayout?.running) return
        _liveLayout = new LiveColaLayout({
          getModel: () => {
            const state = get()
            const view = state.activeViewId ? state.views[state.activeViewId] : undefined
            const vf = computeViewNodeSet(view as DiagramView | undefined, state.c4Nodes as Record<string, C4Node>)
            const vcs = computeViewCollapsedSet(vf, state.c4Nodes as Record<string, C4Node>)
            return filterForView(
              state.c4Nodes as Record<string, C4Node>,
              state.c4Relations as Record<string, C4Relation>,
              vf,
              vcs
            )
          },
          applyPositions: (positions) => {
            set((state) => {
              // Update c4Nodes (source of truth) and patch rfNodes positions
              // in-place. Avoids full _sync() re-derive which would rebuild
              // all rfNodes/rfEdges arrays every animation frame.
              for (const [id, pos] of Object.entries(positions)) {
                const node = state.c4Nodes[id]
                if (!node) continue
                node.x = pos.x
                node.y = pos.y
                if (pos.width != null)  node.width  = pos.width
                if (pos.height != null) node.height = pos.height
              }
              // Patch rfNodes positions directly (O(n) but no new array refs)
              for (const rfNode of state.rfNodes) {
                const pos = positions[rfNode.id]
                if (!pos) continue
                rfNode.position = { x: pos.x, y: pos.y }
                if (pos.width != null || pos.height != null) {
                  const data = rfNode.data as C4NodeRFData
                  if (pos.width != null) {
                    data.width = pos.width
                    rfNode.width = pos.width
                    if (!rfNode.style) rfNode.style = {}
                    ;(rfNode.style as any).width = pos.width
                  }
                  if (pos.height != null) {
                    data.height = pos.height
                    rfNode.height = pos.height
                    if (!rfNode.style) rfNode.style = {}
                    ;(rfNode.style as any).height = pos.height
                  }
                }
              }
            })
          },
        })
        _liveLayout.start()
        set((state) => { state.liveLayoutActive = true })
      },

      stopLiveLayout() {
        if (_liveLayout) {
          _liveLayout.stop()
          _liveLayout = null
        }
        set((state) => { state.liveLayoutActive = false })
      },

      liveGrab(nodeId, x, y) {
        _liveLayout?.grab(nodeId, x, y)
      },

      liveDrag(nodeId, x, y) {
        _liveLayout?.drag(nodeId, x, y)
      },

      liveRelease(nodeId) {
        _liveLayout?.release(nodeId)
      },

      setConnectionModifier(mod) {
        set((state) => { state.connectionModifier = mod })
      },

      startConnection(sourceId) {
        set((state) => { state.connectSource = sourceId })
      },

      cancelConnection() {
        set((state) => { state.connectSource = null })
      },

      // ── undo / redo ─────────────────────────────────────────────────────
      undo() {
        if (_undoStack.length === 0) return
        const entry = _undoStack.pop()!
        // push current state to redo
        _redoStack.push(_captureState(get()))
        set((state) => {
          state.c4Nodes = entry.c4Nodes as any
          state.c4Relations = entry.c4Relations as any
          state.canUndo = _undoStack.length > 0
          state.canRedo = true
        })
        get()._sync()
        _liveLayout?.invalidate()
      },

      redo() {
        if (_redoStack.length === 0) return
        const entry = _redoStack.pop()!
        // push current state to undo
        _undoStack.push(_captureState(get()))
        set((state) => {
          state.c4Nodes = entry.c4Nodes as any
          state.c4Relations = entry.c4Relations as any
          state.canUndo = true
          state.canRedo = _redoStack.length > 0
        })
        get()._sync()
        _liveLayout?.invalidate()
      },

      // ── snapshots (versions) ────────────────────────────────────────────
      createSnapshot(name) {
        const id = uid()
        const snap: DiagramSnapshot = {
          id,
          name,
          timestamp: Date.now(),
          nodes: JSON.parse(JSON.stringify(get().c4Nodes)),
          relations: JSON.parse(JSON.stringify(get().c4Relations)),
        }
        set((state) => { state.snapshots.push(snap as any) })
        return id
      },

      restoreSnapshot(id) {
        const snap = get().snapshots.find(s => s.id === id)
        if (!snap) return
        _pushUndo(get())
        set((state) => {
          state.c4Nodes = JSON.parse(JSON.stringify(snap.nodes)) as any
          state.c4Relations = JSON.parse(JSON.stringify(snap.relations)) as any
          state.canUndo = _undoStack.length > 0
          state.canRedo = _redoStack.length > 0
        })
        get()._sync()
        _liveLayout?.invalidate()
      },

      removeSnapshot(id) {
        set((state) => {
          state.snapshots = state.snapshots.filter(s => s.id !== id) as any
        })
      },

      renameSnapshot(id, name) {
        set((state) => {
          const snap = state.snapshots.find(s => s.id === id)
          if (snap) snap.name = name
        })
      },

      // ── I/O ─────────────────────────────────────────────────────────────
      loadDiagram(data) {
        get().stopLiveLayout()
        _undoStack.length = 0
        _redoStack.length = 0
        const nodes: Record<string, C4Node> = {}
        const relations: Record<string, C4Relation> = {}
        const views: Record<string, DiagramView> = {}
        for (const n of data.nodes) nodes[n.id] = n
        for (const r of data.relations) relations[r.id] = r
        if (data.views) for (const v of data.views) views[v.id] = v

        // Restore snapshots (backward compat: old files won't have them)
        const snapshots: DiagramSnapshot[] = data.snapshots ?? []

        // Restore per-view positions (backward compat: old files won't have them)
        const defaultPos = data.defaultPositions ?? snapshotPositions(nodes)

        set((state) => {
          state.c4Nodes = nodes as any
          state.c4Relations = relations as any
          state.views = views as any
          state.defaultPositions = defaultPos as any
          state.activeViewId = null
          state.selectedNodeId = null
          state.selectedEdgeId = null
          state.canUndo = false
          state.canRedo = false
          state.snapshots = snapshots as any
        })
        get()._sync()
        get().startLiveLayout()
      },

      saveDiagram() {
        const { c4Nodes, c4Relations, views, activeViewId, defaultPositions, snapshots } = get()

        // Snapshot current positions into the active context before saving
        const currentPos = snapshotPositions(c4Nodes)
        const savedDefaultPos = activeViewId === null ? currentPos : defaultPositions
        const savedViews = Object.values(views).map(v => ({
          ...v,
          positions: v.id === activeViewId ? currentPos : v.positions,
        }))

        return {
          nodes: Object.values(c4Nodes),
          relations: Object.values(c4Relations),
          views: savedViews,
          defaultPositions: savedDefaultPos,
          snapshots: snapshots as DiagramSnapshot[],
        }
      },

      resetDiagram() {
        get().stopLiveLayout()
        _undoStack.length = 0
        _redoStack.length = 0
        const sample = buildSampleDiagram()
        set((state) => {
          state.c4Nodes = sample.nodes as any
          state.c4Relations = sample.relations as any
          state.views = {} as any
          state.activeViewId = null
          state.defaultPositions = snapshotPositions(sample.nodes) as any
          state.selectedNodeId = null
          state.selectedEdgeId = null
          state.canUndo = false
          state.canRedo = false
          state.snapshots = [] as any
        })
        get()._sync()
        get().startLiveLayout()
      },

      newDiagram() {
        get().stopLiveLayout()
        _undoStack.length = 0
        _redoStack.length = 0
        set((state) => {
          state.c4Nodes = {}
          state.c4Relations = {}
          state.views = {} as any
          state.activeViewId = null
          state.defaultPositions = {} as any
          state.selectedNodeId = null
          state.selectedEdgeId = null
          state.canUndo = false
          state.canRedo = false
          state.snapshots = [] as any
        })
        get()._sync()
        get().startLiveLayout()
      },

      // ── viewport ────────────────────────────────────────────────────────
      setFitViewFn(fn, instantFn) {
        _fitViewFn = fn
        _fitViewInstantFn = instantFn ?? fn
        // On HMR re-init, stop any stale auto-fit loop
        const stale = _getAutoFitTimer()
        if (stale !== null && !get().autoFitActive) {
          clearInterval(stale)
          _setAutoFitTimer(null)
        }
      },
      fitAll() {
        _fitViewFn?.()
      },
      toggleAutoFit() {
        // Always cancel any existing timer first
        const existing = _getAutoFitTimer()
        if (existing !== null) {
          clearInterval(existing)
          _setAutoFitTimer(null)
        }
        const next = !get().autoFitActive
        set((state) => { state.autoFitActive = next })
        if (next) {
          _fitViewFn?.()  // start immediately
          const t = setInterval(() => {
            if (!get().autoFitActive) { clearInterval(t); _setAutoFitTimer(null); return }
            _fitViewFn?.()
          }, 400)
          _setAutoFitTimer(t)
        }
      },
    }
  })
)

// Auto-start live cola layout (skip in test/SSR environments)
if (typeof requestAnimationFrame !== 'undefined') {
  useDiagramStore.getState().startLiveLayout()
}
