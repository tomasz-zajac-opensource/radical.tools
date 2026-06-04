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
  DiagramSequence,
  DiagramSnapshot,
  PresentationSlide,
  Presentation,
  SlideCanvasState,
  NodePosition,
  NODE_SIZES,
  COLLAPSED_HEIGHT,
  COLLAPSED_WIDTH,
  isContainerType,
} from '../types/c4'
import {
  Metamodel,
  NodeTypeDef,
  RelationTypeDef,
  builtInC4Metamodel,
  builtInDddC4Metamodel,
  isRelationAllowed,
  isParentAllowed,
  canAddMoreOfType,
  inferRelationType,
} from '../types/metamodel'
import { applyElkLayout, applyTreeLayout } from '../layout/elkLayout'
import { applyColaLayout } from '../layout/colaLayout'
import { applyRadicalLayout } from '../layout/radicalLayout'
import { runSmartLayout } from '../layout/smartLayout'
import { applyReferenceLayout } from '../layout/referenceLayout'
import { minimizeCrossings } from '../layout/crossingOpt'
import { LiveColaLayout } from '../layout/liveColaLayout'
import { documents, useDocumentsStore } from './documentStore'

// ─── helpers ────────────────────────────────────────────────────────────────

function uid(): string {
  return crypto.randomUUID()
}

// ─── Undo / Redo history ────────────────────────────────────────────────────

interface HistoryEntry {
  c4Nodes: Record<string, C4Node>
  c4Relations: Record<string, C4Relation>
  views: Record<string, DiagramView>
}

const MAX_HISTORY = 100
const _undoStack: HistoryEntry[] = []
const _redoStack: HistoryEntry[] = []

function _captureState(state: DiagramStore): HistoryEntry {
  return {
    c4Nodes: JSON.parse(JSON.stringify(state.c4Nodes)),
    c4Relations: JSON.parse(JSON.stringify(state.c4Relations)),
    views: JSON.parse(JSON.stringify(state.views)),
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

/** Capture all node positions + collapsed state for a presentation slide */
function captureCanvasState(nodes: Record<string, C4Node>): SlideCanvasState {
  const result: SlideCanvasState['nodes'] = {}
  for (const [id, n] of Object.entries(nodes)) {
    result[id] = { x: n.x, y: n.y, width: n.width, height: n.height, collapsed: n.collapsed }
  }
  return { nodes: result }
}

/** Build the initial presentations array from possibly-legacy persisted data. */
function buildPresentationsFromData(
  presentations: Presentation[] | undefined,
  legacySlides: PresentationSlide[] | undefined,
): { presentations: Presentation[]; activeId: string } {
  let list: Presentation[] = presentations ? [...presentations] : []
  if (list.length === 0) {
    // Migrate legacy single-presentation slides into a default presentation
    list = [{ id: crypto.randomUUID(), name: 'Main', slides: legacySlides ?? [] }]
  }
  return { presentations: list, activeId: list[0].id }
}

function computeSnapDiff(
  prevNodes: Record<string, C4Node>,
  currNodes: Record<string, C4Node>,
  prevRels: Record<string, C4Relation>,
  currRels: Record<string, C4Relation>,
): Record<string, 'new' | 'changed' | 'removed'> {
  const result: Record<string, 'new' | 'changed' | 'removed'> = {}
  for (const id of Object.keys(currNodes)) {
    if (!prevNodes[id]) {
      result[id] = 'new'
    } else {
      const p = prevNodes[id], c = currNodes[id]
      if (p.label !== c.label || p.description !== c.description || p.technology !== c.technology ||
          p.type !== c.type || p.parentId !== c.parentId || p.external !== c.external) {
        result[id] = 'changed'
      }
    }
  }
  // Removed nodes: in base but not in current.
  for (const id of Object.keys(prevNodes)) {
    if (!currNodes[id]) result[id] = 'removed'
  }
  for (const id of Object.keys(currRels)) {
    if (!prevRels[id]) {
      result[id] = 'new'
    } else {
      const p = prevRels[id], c = currRels[id]
      if (p.sourceId !== c.sourceId || p.targetId !== c.targetId ||
          p.label !== c.label || p.technology !== c.technology) {
        result[id] = 'changed'
      }
    }
  }
  // Removed relations: in base but not in current.
  for (const id of Object.keys(prevRels)) {
    if (!currRels[id]) result[id] = 'removed'
  }
  return result
}

/**
 * Compute sequence-level diff: which relation IDs were added to or removed
 * from sequences between two snapshots. Only covers membership changes —
 * structural node/relation changes are handled by computeSnapDiff.
 * Structural diff entries always win; this fills the gaps.
 */
function computeSeqDiff(
  prevSeqs: Record<string, DiagramSequence> | undefined,
  currSeqs: Record<string, DiagramSequence> | undefined,
): Record<string, 'new' | 'changed' | 'removed'> {
  const result: Record<string, 'new' | 'changed' | 'removed'> = {}
  const prev = prevSeqs ?? {}
  const curr = currSeqs ?? {}
  const allSeqIds = new Set([...Object.keys(prev), ...Object.keys(curr)])
  for (const seqId of allSeqIds) {
    const prevSeq = prev[seqId]
    const currSeq = curr[seqId]
    const prevIds = new Set(prevSeq?.relationIds ?? [])
    const currIds = new Set(currSeq?.relationIds ?? [])
    for (const rid of currIds) if (!prevIds.has(rid)) result[rid] = 'new'
    for (const rid of prevIds) if (!currIds.has(rid) && !result[rid]) result[rid] = 'removed'
    // Check step-description changes for relations present in both sequences at the same position.
    if (prevSeq && currSeq) {
      const len = Math.min(prevSeq.relationIds.length, currSeq.relationIds.length)
      for (let i = 0; i < len; i++) {
        const rid = currSeq.relationIds[i]
        if (rid !== prevSeq.relationIds[i]) continue  // position shifted – skip
        if (result[rid]) continue                     // already 'new' or 'removed'
        const prevDesc = prevSeq.stepDescriptions?.[i] ?? ''
        const currDesc = currSeq.stepDescriptions?.[i] ?? ''
        if (prevDesc !== currDesc) result[rid] = 'changed'
      }
    }
  }
  return result
}

/**
 * Build the ghost maps for a diff: nodes/relations that existed in the base
 * but are not present in the current state. Returned as plain dictionaries
 * so they can be merged into the canvas at render time without polluting
 * the actual model.
 */
function computeDiffGhosts(
  baseNodes: Record<string, C4Node>,
  currNodes: Record<string, C4Node>,
  baseRels: Record<string, C4Relation>,
  currRels: Record<string, C4Relation>,
): { nodes: Record<string, C4Node>; relations: Record<string, C4Relation> } {
  const nodes: Record<string, C4Node> = {}
  const relations: Record<string, C4Relation> = {}
  for (const id of Object.keys(baseNodes)) {
    if (!currNodes[id]) nodes[id] = JSON.parse(JSON.stringify(baseNodes[id]))
  }
  for (const id of Object.keys(baseRels)) {
    if (!currRels[id]) relations[id] = JSON.parse(JSON.stringify(baseRels[id]))
  }
  return { nodes, relations }
}

/** Compute the effective set of node IDs for a view: explicit nodeIds + all their ancestors */
function computeViewNodeSet(view: DiagramView | undefined, nodes: Record<string, C4Node>): Set<string> | undefined {
  if (!view) return undefined
  if (view.nodeIds.length === 0) return undefined
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

/** Is the node effectively collapsed (model-collapsed OR view-collapsed)?
 *  Pass `expandedSet` (from `view.expandedNodeIds`) to allow a named view to
 *  override a model-level collapse. */
function isEffectivelyCollapsed(
  node: C4Node,
  viewCollapsedSet?: Set<string>,
  expandedSet?: Set<string>
): boolean {
  if (expandedSet?.has(node.id)) return false  // view-level explicit expansion
  return node.collapsed || (viewCollapsedSet?.has(node.id) ?? false)
}

/**
 * Compute whether a node is effectively collapsed in a given named view.
 * Used by tree-panel components (Sidebar, RightPanel) to show ▶/▼ correctly
 * without duplicating the logic in each component.
 *
 * @param node          The C4Node to check.
 * @param activeViewId  The currently active view ID (or null/undefined for the default view).
 * @param view          The DiagramView object (pass `undefined` when no view is active).
 */
export function nodeEffectivelyCollapsedInView(
  node: C4Node,
  activeViewId: string | null | undefined,
  view: DiagramView | undefined,
): boolean {
  if (!activeViewId) return node.collapsed
  return (
    (node.collapsed && !(view?.expandedNodeIds?.includes(node.id) ?? false)) ||
    (view?.collapsedNodeIds?.includes(node.id) ?? false)
  )
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
  viewCollapsedSet?: Set<string>,
  expandedSet?: Set<string>
): boolean {
  const node = nodes[nodeId]
  if (!node || !node.parentId) return false
  const parent = nodes[node.parentId]
  if (!parent) return false
  if (isEffectivelyCollapsed(parent, viewCollapsedSet, expandedSet)) return true
  return isNodeHidden(node.parentId, nodes, viewCollapsedSet, expandedSet)
}

/**
 * Returns the id of the deepest visible ancestor for a given node.
 * If the node itself is visible, returns nodeId unchanged.
 */
function getVisibleAncestor(
  nodeId: string,
  nodes: Record<string, C4Node>,
  viewCollapsedSet?: Set<string>,
  expandedSet?: Set<string>
): string {
  if (!isNodeHidden(nodeId, nodes, viewCollapsedSet, expandedSet)) return nodeId
  const node = nodes[nodeId]
  if (!node || !node.parentId) return nodeId
  return getVisibleAncestor(node.parentId, nodes, viewCollapsedSet, expandedSet)
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
  viewCollapsedSet?: Set<string>,
  expandedSet?: Set<string>
): string {
  // Without a view filter, fall back to normal collapse logic
  if (!viewFilter) return getVisibleAncestor(nodeId, nodes, viewCollapsedSet, expandedSet)
  // Walk up until we find a node in the view that isn't hidden
  let cur = nodeId
  while (cur) {
    if (viewFilter.has(cur) && !isNodeHidden(cur, nodes, viewCollapsedSet, expandedSet)) return cur
    const node = nodes[cur]
    if (!node?.parentId) break
    cur = node.parentId
  }
  // Fallback: return whatever getVisibleAncestor gives
  return getVisibleAncestor(nodeId, nodes, viewCollapsedSet, expandedSet)
}

/** True if `ancestorId` is a (transitive) ancestor of `nodeId`. */
function isAncestorOf(ancestorId: string, nodeId: string, nodes: Record<string, C4Node>): boolean {
  let cur = nodes[nodeId]?.parentId
  while (cur) {
    if (cur === ancestorId) return true
    cur = nodes[cur]?.parentId
  }
  return false
}

/** Return all descendant node ids (children, grandchildren, …) */
function getDescendants(nodeId: string, nodes: Record<string, C4Node>): string[] {  const result: string[] = []
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
function effectiveNodeHeight(n: C4Node, viewCollapsedSet?: Set<string>, expandedSet?: Set<string>): number {
  if (isContainerType(n.type) && isEffectivelyCollapsed(n, viewCollapsedSet, expandedSet)) {
    return COLLAPSED_HEIGHT[n.type]
  }
  return n.height
}

/** Effective rendered width of a node (respects collapse + view collapse). */
function effectiveNodeWidth(n: C4Node, viewCollapsedSet?: Set<string>, expandedSet?: Set<string>): number {
  if (isContainerType(n.type) && isEffectivelyCollapsed(n, viewCollapsedSet, expandedSet)) {
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
  viewCollapsedSet?: Set<string>,
  ghostIds?: Set<string>,
  locked?: boolean,
  expandedSet?: Set<string>,
): Node<C4NodeRFData>[] {
  const rfNodes: Node<C4NodeRFData>[] = []

  // React Flow requires parents to appear before their children. Sort by
  // ancestor depth (roots first), then by type for stable ordering inside a
  // depth band. Type-based ordering alone is wrong as soon as containers can
  // nest (e.g. a sub-system inside a system) — comparing by type without
  // depth would put the sub-system before its parent and React Flow would
  // silently drop the parentNode link.
  const depthCache = new Map<string, number>()
  const depthOf = (id: string): number => {
    const cached = depthCache.get(id)
    if (cached !== undefined) return cached
    const n = nodes[id]
    const d = n?.parentId ? depthOf(n.parentId) + 1 : 0
    depthCache.set(id, d)
    return d
  }
  const typeRank = (t: string): number => {
    if (t === 'domain') return 0
    if (t === 'system') return 0
    if (t === 'container' || t === 'database' || t === 'webapp' || t === 'queue') return 1
    if (t === 'component') return 2
    return 3
  }
  const sorted = Object.values(nodes)
    .filter((n) => !viewFilter || viewFilter.has(n.id))
    .sort((a, b) => {
      const da = depthOf(a.id)
      const db = depthOf(b.id)
      if (da !== db) return da - db
      return typeRank(a.type) - typeRank(b.type)
    })

  // Pre-compute which nodes have children (in the full model)
  const parentSet = new Set(Object.values(nodes).map((n) => n.parentId).filter(Boolean))

  // Minimum top offset for children inside an expanded parent — must clear
  // the header (~30px) + 2-line label (~52px) + small gap. Mirrors the value
  // used by ELK / smartLayout / fitParentToChildren.
  const PARENT_LABEL_PAD = 110

  for (const n of sorted) {
    const hidden = isNodeHidden(n.id, nodes, viewCollapsedSet, expandedSet)
    const hasChildren = parentSet.has(n.id)
    const collapsed = isEffectivelyCollapsed(n, viewCollapsedSet, expandedSet)
    const isGhost = ghostIds?.has(n.id) ?? false

    // Fixed-size node types always render at canonical NODE_SIZES regardless of
    // what is stored in the document (handles legacy nodes created with old sizes).
    const isFixedSize = n.type === 'adr' || n.type === 'fitness-fn'

    const effHeight = isFixedSize
      ? NODE_SIZES[n.type].height
      : isContainerType(n.type) && (collapsed || !hasChildren)
        ? COLLAPSED_HEIGHT[n.type]
        : n.height
    const effWidth = isFixedSize
      ? NODE_SIZES[n.type].width
      : isContainerType(n.type) && (collapsed || !hasChildren)
        ? COLLAPSED_WIDTH[n.type]
        : n.width

    // Render-time safeguard: if a child sits too close to its parent's top
    // (because the saved layout pre-dates the larger header padding), push
    // the visible position down without mutating the model.
    let renderY = n.y
    if (n.parentId) {
      const parent = nodes[n.parentId]
      const parentExpanded =
        parent &&
        isContainerType(parent.type) &&
        !isEffectivelyCollapsed(parent, viewCollapsedSet, expandedSet) &&
        parentSet.has(parent.id)
      if (parentExpanded && renderY < PARENT_LABEL_PAD) {
        renderY = PARENT_LABEL_PAD
      }
    }


    rfNodes.push({
      id: n.id,
      type: n.type,
      position: { x: n.x, y: renderY },
      parentNode: n.parentId,
      extent: undefined,
      expandParent: false,
      hidden,
      // Ghost nodes (removed-in-current-milestone overlay) are not selectable
      // or draggable — they only exist as a visual diff hint.
      // In viewer/presenter modes (`locked`), nothing is draggable so the
      // saved layout cannot drift while someone browses the document.
      selectable: !hidden && !isGhost && !locked,
      draggable: !hidden && !isGhost && !locked,
      className: isGhost ? 'rf-node-ghost' : undefined,
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
      // Stack deeper nodes above their ancestors so a sub-system rendered
      // inside another system doesn't get hidden behind it.
      zIndex: depthOf(n.id) * 10
        + (n.type === 'domain' ? -1 : n.type === 'system' ? 0 : n.type === 'container' ? 1 : 2),
    })
  }
  return rfNodes
}

function deriveRFEdges(
  nodes: Record<string, C4Node>,
  relations: Record<string, C4Relation>,
  viewFilter?: Set<string>,
  viewCollapsedSet?: Set<string>,
  hiddenRelationIds?: Set<string>,
  expandedSet?: Set<string>,
): Edge<C4EdgeRFData>[] {
  const rfEdges: Edge<C4EdgeRFData>[] = []
  // Track virtual edges already emitted to avoid duplicates
  const seen = new Set<string>()

  // Depth-based zIndex — mirrors deriveRFNodes so edges always render above
  // their parent group nodes and are reachable by pointer events.
  const depthCache = new Map<string, number>()
  const depthOf = (id: string): number => {
    const cached = depthCache.get(id)
    if (cached !== undefined) return cached
    const n = nodes[id]
    const d = n?.parentId ? depthOf(n.parentId) + 1 : 0
    depthCache.set(id, d)
    return d
  }

  for (const rel of Object.values(relations)) {
    if (!nodes[rel.sourceId] || !nodes[rel.targetId]) continue
    if (hiddenRelationIds && hiddenRelationIds.has(rel.id)) continue

    const visSource = getViewVisibleAncestor(rel.sourceId, nodes, viewFilter, viewCollapsedSet, expandedSet)
    const visTarget = getViewVisibleAncestor(rel.targetId, nodes, viewFilter, viewCollapsedSet, expandedSet)

    if (visSource === visTarget) continue // collapsed to same ancestor → self-loop, skip

    // If filtering by view, both endpoints must be in the view
    if (viewFilter && (!viewFilter.has(visSource) || !viewFilter.has(visTarget))) continue

    // Skip "parent ↔ own descendant" virtual edges. They appear when a child
    // is in the view and its sibling (also a child of the same parent) is NOT
    // in the view: that sibling resolves up to the parent, producing a
    // misleading visual link from the child to its own parent. Hide them.
    if (visSource !== rel.sourceId || visTarget !== rel.targetId) {
      if (isAncestorOf(visSource, visTarget, nodes) || isAncestorOf(visTarget, visSource, nodes)) {
        continue
      }
    }

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
    // not hidden behind them. Use the same depth * 10 formula as deriveRFNodes
    // so edges inside nested structures always exceed their parent's zIndex.
    const srcDepth = depthOf(visSource)
    const tgtDepth = depthOf(visTarget)
    const edgeZIndex = Math.max(srcDepth, tgtDepth) * 10 + 5

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
        relationType: rel.relationType,
        isVirtual,
      },
    })
  }
  return rfEdges
}

// ─── Sample diagram ──────────────────────────────────────────────────────────

function buildSampleDiagram(): {
  nodes: Record<string, C4Node>
  relations: Record<string, C4Relation>
  snapshots: DiagramSnapshot[]
} {
  const add = (nodes: Record<string, C4Node>, n: C4Node) => { nodes[n.id] = n }
  const rel = (relations: Record<string, C4Relation>, r: C4Relation) => { relations[r.id] = r }

  // ── Snapshot 1: MVP – Frontend + API ──────────────────────────────────────
  const snap1nodes: Record<string, C4Node> = {}
  const snap1rels: Record<string, C4Relation> = {}
  add(snap1nodes, { id: 'sys1', type: 'system', label: 'Platform', description: 'Main system', collapsed: false, x: 200, y: 100, width: 700, height: 400 })
  add(snap1nodes, { id: 'ctn1', type: 'container', label: 'Frontend',  technology: 'React',    description: 'Web UI',      parentId: 'sys1', collapsed: false, x: 40,  y: 70,  ...NODE_SIZES.container })
  add(snap1nodes, { id: 'ctn2', type: 'container', label: 'API',       technology: 'Node.js',  description: 'REST API',    parentId: 'sys1', collapsed: false, x: 360, y: 70,  ...NODE_SIZES.container })
  add(snap1nodes, { id: 'usr1', type: 'person',    label: 'End User',  description: 'Uses web app', collapsed: false, x: -100, y: 180, ...NODE_SIZES.person })
  rel(snap1rels, { id: 'r01', sourceId: 'ctn1', targetId: 'ctn2', label: 'Calls', technology: 'HTTPS' })
  rel(snap1rels, { id: 'r00', sourceId: 'usr1', targetId: 'ctn1', label: 'Uses', technology: 'Browser' })

  // ── Snapshot 2: Added Database container ──────────────────────────────────
  const snap2nodes: Record<string, C4Node> = JSON.parse(JSON.stringify(snap1nodes))
  const snap2rels: Record<string, C4Relation> = JSON.parse(JSON.stringify(snap1rels))
  snap2nodes['sys1'] = { ...snap2nodes['sys1'], width: 900, height: 400 }
  add(snap2nodes, { id: 'ctn3', type: 'container', label: 'Database', technology: 'Postgres', description: 'Data storage', parentId: 'sys1', collapsed: false, x: 580, y: 70, ...NODE_SIZES.container })
  rel(snap2rels, { id: 'r02', sourceId: 'ctn2', targetId: 'ctn3', label: 'Reads/writes', technology: 'SQL' })

  // ── Snapshot 3: API renamed to "Backend", added Cache + Auth service ──────
  const snap3nodes: Record<string, C4Node> = JSON.parse(JSON.stringify(snap2nodes))
  const snap3rels: Record<string, C4Relation> = JSON.parse(JSON.stringify(snap2rels))
  snap3nodes['ctn2'] = { ...snap3nodes['ctn2'], label: 'Backend', description: 'GraphQL API', technology: 'Node.js / GraphQL' }
  snap3nodes['sys1'] = { ...snap3nodes['sys1'], width: 1100, height: 500 }
  add(snap3nodes, { id: 'ctn4', type: 'container', label: 'Cache',         technology: 'Redis',   description: 'Session cache',    parentId: 'sys1', collapsed: false, x: 580, y: 260, ...NODE_SIZES.container })
  add(snap3nodes, { id: 'ctn5', type: 'container', label: 'Auth Service',  technology: 'Keycloak', description: 'Identity provider', parentId: 'sys1', collapsed: false, x: 820, y: 70,  ...NODE_SIZES.container })
  rel(snap3rels, { id: 'r03', sourceId: 'ctn2', targetId: 'ctn4', label: 'Caches', technology: 'Redis protocol' })
  rel(snap3rels, { id: 'r04', sourceId: 'ctn1', targetId: 'ctn5', label: 'Auth', technology: 'OAuth2' })

  const snapshots: DiagramSnapshot[] = [
    { id: 'snap-1', name: 'v1 – MVP',             timestamp: Date.now() - 7 * 86400000, nodes: snap1nodes, relations: snap1rels },
    { id: 'snap-2', name: 'v2 – Added Database',  timestamp: Date.now() - 3 * 86400000, nodes: snap2nodes, relations: snap2rels },
    { id: 'snap-3', name: 'v3 – Auth + Cache',    timestamp: Date.now(),                nodes: snap3nodes, relations: snap3rels },
  ]

  return { nodes: snap3nodes, relations: snap3rels, snapshots }
}

// ─── Store interface ─────────────────────────────────────────────────────────

interface DiagramStore {
  // ── raw C4 model ──
  c4Nodes: Record<string, C4Node>
  c4Relations: Record<string, C4Relation>

  // ── sequences (model-level, referenced by dynamic views) ──
  sequences: Record<string, DiagramSequence>
  /** ID of the sequence currently being edited via canvas clicks. null = none */
  activeSequenceId: string | null

  // ── views ──
  views: Record<string, DiagramView>
  activeViewId: string | null
  /** Positions for the "All" (default) view */
  defaultPositions: Record<string, NodePosition>
  /** Camera state (pan + zoom) for the "All" (default) view */
  defaultViewport: { x: number; y: number; zoom: number } | null

  // ── derived React Flow state ──
  rfNodes: Node<C4NodeRFData>[]
  rfEdges: Edge<C4EdgeRFData>[]

  // ── UI state ──
  selectedNodeId: string | null
  selectedEdgeId: string | null
  /**
   * All currently selected node ids on the canvas. The first entry mirrors
   * `selectedNodeId` (“primary” selection) when non-empty. Maintained from
   * ReactFlow selection changes; multi-select uses Shift/Cmd by default.
   */
  selectedNodeIds: string[]
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
  /** Replace the multi-selection set. */
  setSelectedNodeIds: (ids: string[]) => void
  /** Wrap the current selection in a new parent of `parentTypeId`. */
  wrapSelectionInNewParent: (parentTypeId: string) => void
  /**
   * Remove a parent node but keep its direct children (re-parented to the
   * grandparent) along with any relations the children participate in.
   * Relations that touched the removed node itself are dropped.
   */
  unwrapNode: (id: string) => void
  /**
   * Move one or more nodes (which must currently share the same parent) into
   * a new parent. Pass `null` to move them to the canvas root. Coordinates
   * are translated so on-screen position is preserved as closely as possible.
   */
  reparentNodes: (ids: string[], newParentId: string | null) => void

  // ── actions: views ──
  addView: (name: string) => string
  removeView: (id: string) => void
  renameView: (id: string, name: string) => void
  setActiveView: (id: string | null) => void
  addNodeToView: (viewId: string, nodeId: string) => void
  removeNodeFromView: (viewId: string, nodeId: string) => void
  /** Replace the entire visible-nodes set of a view. Unknown ids are ignored. */
  setViewNodes: (viewId: string, nodeIds: string[]) => void
  /** Hide a specific relation from the view, even if both endpoints are visible. */
  hideRelationFromView: (viewId: string, relationId: string) => void
  /** Reverse `hideRelationFromView`. */
  unhideRelationInView: (viewId: string, relationId: string) => void
  /** Switch a view between 'static', 'dynamic', 'treemap', 'table', and 'matrix'. */
  setViewKind: (viewId: string, kind: 'static' | 'dynamic' | 'treemap' | 'table' | 'matrix') => void
  /** Persist treemap drill-down focus (null = top "All"). */
  setTreemapFocus: (viewId: string, focusId: string | null) => void
  /** Choose how treemap rectangles are sized for a view. */
  setTreemapSizeBy: (viewId: string, mode: 'leaves' | 'uniform' | 'relations') => void
  setTreemapMaxDepth: (viewId: string, depth: number | null) => void
  toggleTreemapExpand: (viewId: string, nodeId: string) => void
  /** Choose the auto-layout strategy used for this view. */
  setViewLayoutMode: (viewId: string, mode: 'auto' | 'tree') => void
  /** Link/unlink a sequence to a dynamic view. */
  setViewSequence: (viewId: string, sequenceId: string | null) => void
  /**
   * Create a new dynamic view scoped to a sequence:
   * populates nodeIds with the source/target nodes of every relation in the
   * sequence, sets kind='dynamic' and links the sequenceId.
   * Returns the new view id.
   */
  addViewFromSequence: (sequenceId: string) => string

  // ── actions: sequences ──
  addSequence: (name: string) => string
  removeSequence: (id: string) => void
  renameSequence: (id: string, name: string) => void
  /** Set which sequence is currently being edited (canvas edge clicks toggle steps). */
  setActiveSequence: (id: string | null) => void
  /** Toggle a relation in a model sequence (append if absent, remove if present). */
  toggleRelationInSequence: (sequenceId: string, relationId: string) => void
  /** Remove the step at index `idx` from a sequence. */
  removeFromSequence: (sequenceId: string, idx: number) => void
  /** Move a step from `fromIdx` to `toIdx` within a sequence. */
  reorderSequence: (sequenceId: string, fromIdx: number, toIdx: number) => void
  /** Clear all steps from a sequence. */
  clearSequence: (sequenceId: string) => void
  /** Set (or clear) the description for a specific step by index. */
  updateStepDescription: (sequenceId: string, idx: number, description: string) => void

  // ── actions: React Flow sync ──
  onNodesChange: (changes: NodeChange[]) => void
  onEdgesChange: (changes: EdgeChange[]) => void
  fitParentToChildren: (parentId: string, viewFilter?: Set<string>, viewCollapsedSet?: Set<string>, expandedSet?: Set<string>) => void
  resolveOverlaps: (draggedId: string) => void

  // ── actions: layout ──
  runElkLayout: () => Promise<void>
  runColaLayout: () => void
  runRadicalLayout: () => void
  runReferenceLayout: () => void
  runTreeLayout: () => Promise<void>
  runSmartLayout: () => Promise<void>
  setLayoutMode: (mode: 'elk' | 'cola' | 'radical') => void
  startLiveLayout: (opts?: { skipBulk?: boolean }) => void
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

  // ── actions: snapshots (versions / milestones) ──
  snapshots: DiagramSnapshot[]
  /** ID of the milestone currently loaded onto the canvas (null = live HEAD). */
  activeSnapshotId: string | null
  /** Backup of the live HEAD state, kept while a milestone is loaded. */
  liveBackup: { nodes: Record<string, C4Node>; relations: Record<string, C4Relation>; sequences: Record<string, DiagramSequence> } | null
  /** True after the user makes a structural edit while viewing a milestone. */
  milestoneDirty: boolean
  /** Open the propagate/new prompt modal. */
  milestonePromptOpen: boolean
  createSnapshot: (name: string) => string
  restoreSnapshot: (id: string) => void
  removeSnapshot: (id: string) => void
  renameSnapshot: (id: string, name: string) => void
  /** Load a milestone onto the canvas for inspection / editing. */
  selectMilestone: (id: string) => void
  /** Commit milestone edits: 'propagate' = apply diff to this + later milestones; 'new' = insert new milestone after current. */
  commitMilestoneChanges: (mode: 'propagate' | 'new', newName?: string) => void
  /** Discard milestone edits and return to live HEAD state. */
  discardMilestoneChanges: () => void
  /** Close the prompt modal without committing (banner stays). */
  dismissMilestonePrompt: () => void

  // ── delete confirmation ──
  /** When the user presses Delete on the canvas, the request is parked here
   * until they choose between "remove from model" or "hide from current view". */
  pendingDelete: { nodeIds: string[]; edgeIds: string[] } | null
  /** Called by the confirm dialog. */
  resolvePendingDelete: (action: 'model' | 'view' | 'cancel') => void

  // ── diff highlight (time travel) ──
  diffHighlight: Record<string, 'new' | 'changed' | 'removed'>
  setDiffHighlight: (diff: Record<string, 'new' | 'changed' | 'removed'>) => void
  /** Snapshot id used as the diff base when viewing a milestone. `null` means
   *  "auto" — use the milestone immediately before the active one (or live
   *  HEAD when the active milestone is the very first). User can override
   *  via {@link setDiffBase} to compare against any milestone. */
  diffBaseSnapshotId: string | null
  setDiffBase: (id: string | null) => void
  /** Ghost copies of items that exist in the diff base but are missing from
   *  the active milestone. Merged into rfNodes/rfEdges by `_sync()` so the
   *  user can see what got removed, without these ghosts polluting the
   *  actual `c4Nodes` / `c4Relations` model. */
  diffGhostNodes: Record<string, C4Node>
  diffGhostRelations: Record<string, C4Relation>
  /** Whether diff overlays are currently visible. Default `false` — user
   *  toggles explicitly to see changes vs. the previous milestone. */
  showDiff: boolean
  toggleShowDiff: () => void

  // ── app mode ──
  appMode: 'designer' | 'viewer' | 'presenter' | 'metamodel'
  setAppMode: (mode: 'designer' | 'viewer' | 'presenter' | 'metamodel') => void

  // ── metamodel (per document) ──
  metamodel: Metamodel
  setMetamodel: (m: Metamodel) => void
  resetMetamodelToC4: () => void
  upsertNodeType: (def: NodeTypeDef) => void
  removeNodeType: (id: string) => void
  upsertRelationType: (def: RelationTypeDef) => void
  removeRelationType: (id: string) => void

  // ── transient notifications (toasts) ──
  notifications: Array<{ id: string; severity: 'error' | 'warning' | 'info'; message: string; ts: number }>
  pushNotification: (message: string, severity?: 'error' | 'warning' | 'info') => void
  dismissNotification: (id: string) => void

  // ── presentation mode ──
  /** All presentations (each contains its own slides) */
  presentations: Presentation[]
  /** Currently selected presentation id (null only if none exist) */
  activePresentationId: string | null
  /** Slides of the active presentation (mirror — kept in sync) */
  presentationSlides: PresentationSlide[]
  presentationActive: boolean
  presentationSlideIndex: number
  addPresentation: (name?: string) => string
  removePresentation: (id: string) => void
  renamePresentation: (id: string, name: string) => void
  setActivePresentation: (id: string) => void
  addPresentationSlide: (name?: string) => void
  removePresentationSlide: (id: string) => void
  renamePresentationSlide: (id: string, name: string) => void
  updatePresentationSlideViewport: (id: string, vp: { x: number; y: number; zoom: number }) => void
  startPresentation: () => void
  stopPresentation: () => void
  goToSlide: (index: number) => void
  previewSlide: (index: number) => void
  captureSlideViewport: (id: string) => void
  linkSnapshotToSlide: (slideId: string, snapshotId: string | null) => void
  linkViewToSlide: (slideId: string, viewId: string | null) => void
  setViewportFns: (
    getVP: () => { x: number; y: number; zoom: number },
    setVP: (vp: { x: number; y: number; zoom: number }, opts?: { duration?: number }) => void,
  ) => void

  // ── actions: viewport ──
  autoFitActive: boolean
  setFitViewFn: (fn: (() => void) | null, instantFn?: (() => void) | null) => void
  fitAll: () => void
  toggleAutoFit: () => void
  zoomIn: () => void
  zoomOut: () => void

  // ── internal ──
  _sync: () => void
  _pushUndo: () => void
  _markMilestoneEdit: () => void
  _resizeParentsBottomUp: (viewFilter?: Set<string>, viewCollapsedSet?: Set<string>) => void
}

// ─── Live layout singleton (not serialisable → kept outside store) ───────────

let _liveLayout: LiveColaLayout | null = null

// Set to true during store init when an existing document was loaded from
// localStorage. Used by the boot startLiveLayout() call to skip the
// 110-iteration cola bulk phase (which would immediately overwrite the
// persisted positions).
let _initLoadedFromDisk = false

// Use window to survive HMR module reloads — otherwise after a hot-reload the
// module-local references become null and the auto-fit interval keeps ticking
// against a dead closure.
const _getFitViewFn = (): (() => void) | null =>
  (typeof window !== 'undefined' ? (window as any).__radicalFitViewFn : null) ?? null
const _setFitViewFnRef = (fn: (() => void) | null) => {
  if (typeof window !== 'undefined') (window as any).__radicalFitViewFn = fn
}
const _getFitViewInstantFn = (): (() => void) | null =>
  (typeof window !== 'undefined' ? (window as any).__radicalFitViewInstantFn : null) ?? null
const _setFitViewInstantFnRef = (fn: (() => void) | null) => {
  if (typeof window !== 'undefined') (window as any).__radicalFitViewInstantFn = fn
}
const _getAutoFitTimer = (): ReturnType<typeof setInterval> | null =>
  (typeof window !== 'undefined' ? (window as any).__radicalAutoFitTimer : null) ?? null
const _setAutoFitTimer = (t: ReturnType<typeof setInterval> | null) => {
  if (typeof window !== 'undefined') (window as any).__radicalAutoFitTimer = t
}
// Viewport fns — stored on window so HMR module reloads don't lose them
const _getViewportFn = (): (() => { x: number; y: number; zoom: number }) | null =>
  (window as any).__rfGetViewport ?? null
const _setViewportFn = (): ((vp: { x: number; y: number; zoom: number }, opts?: { duration?: number }) => void) | null =>
  (window as any).__rfSetViewport ?? null

// ─── Store implementation ────────────────────────────────────────────────────

export const useDiagramStore = create<DiagramStore>()(
  immer((set, get) => {
    // ── Document persistence boot ────────────────────────────────────────
    // We always have an "active" document. If the index is empty we seed one
    // with the built-in sample. For LS-backed docs we can hydrate
    // synchronously; FS-backed docs are loaded asynchronously below.
    const buildSampleData = (): DiagramData => {
      const sample = buildSampleDiagram()
      return {
        nodes: Object.values(sample.nodes),
        relations: Object.values(sample.relations),
        defaultPositions: snapshotPositions(sample.nodes),
        snapshots: sample.snapshots,
      }
    }
    const { meta: activeMeta } = documents.ensureActive(buildSampleData)

    let initNodes: Record<string, C4Node>
    let initRelations: Record<string, C4Relation>
    let initViews: Record<string, DiagramView>
    let initDefaultPositions: Record<string, NodePosition>
    let initSnapshots: DiagramSnapshot[]
    let initPres: ReturnType<typeof buildPresentationsFromData>
    let initMetamodel: Metamodel

    let persisted: DiagramData | null = null
    if (activeMeta.source === 'ls') {
      // Synchronous LS read so the UI shows the right diagram on first paint.
      try {
        if (typeof localStorage !== 'undefined') {
          const raw = localStorage.getItem('radical-doc:' + activeMeta.id)
          if (raw) persisted = JSON.parse(raw) as DiagramData
        }
      } catch (e) { console.warn('[diagramStore] sync LS read failed:', e) }
    }
    // FS-backed docs: render sample first, then async hydrate (see below).

    if (persisted && Array.isArray(persisted.nodes) && Array.isArray(persisted.relations)) {
      initNodes = {}
      initRelations = {}
      initViews = {}
      for (const n of persisted.nodes) initNodes[n.id] = n
      for (const r of persisted.relations) initRelations[r.id] = r
      if (persisted.views) for (const v of persisted.views) initViews[v.id] = v
      const initSequences: Record<string, DiagramSequence> = {}
      if (persisted.sequences) for (const s of persisted.sequences) initSequences[s.id] = s
      initDefaultPositions = persisted.defaultPositions ?? snapshotPositions(initNodes)
      initSnapshots = persisted.snapshots ?? []
      initPres = buildPresentationsFromData(persisted.presentations, persisted.presentationSlides)
      // Auto-refresh built-in presets so persisted documents pick up
      // metamodel updates shipped with new app versions.
      initMetamodel = (() => {
        const persistedMm = persisted.metamodel
        if (!persistedMm) return builtInC4Metamodel()
        if (persistedMm.id === 'c4-builtin') return builtInC4Metamodel()
        if (persistedMm.id === 'c4-ddd-builtin') return builtInDddC4Metamodel()
        return persistedMm
      })()
      // Signal the boot startLiveLayout() call to skip cola's bulk phase
      // so the persisted positions aren't immediately overwritten.
      _initLoadedFromDisk = true
    } else {
      const sample = buildSampleDiagram()
      initNodes = sample.nodes
      initRelations = sample.relations
      initViews = {}
      initDefaultPositions = snapshotPositions(sample.nodes)
      initSnapshots = sample.snapshots
      initPres = buildPresentationsFromData(undefined, [])
      initMetamodel = builtInC4Metamodel()
    }

    return {
      c4Nodes: initNodes,
      c4Relations: initRelations,
      sequences: (persisted?.sequences
        ? Object.fromEntries(persisted.sequences.map(s => [s.id, s]))
        : {}) as Record<string, DiagramSequence>,
      activeSequenceId: null,
      views: initViews,
      activeViewId: null,
      defaultPositions: initDefaultPositions,
      defaultViewport: persisted?.defaultViewport ?? null,
      rfNodes: deriveRFNodes(initNodes),
      rfEdges: deriveRFEdges(initNodes, initRelations),
      selectedNodeId: null,
      selectedEdgeId: null,
      selectedNodeIds: [],
      layoutMode: 'radical',
      isLayoutRunning: false,
      liveLayoutActive: true,
      connectSource: null,
      connectionModifier: 'alt' as const,
      autoFitActive: true,
      canUndo: false,
      canRedo: false,
      snapshots: initSnapshots,
      activeSnapshotId: null,
      liveBackup: null,
      milestoneDirty: false,
      milestonePromptOpen: false,
      pendingDelete: null,
      diffHighlight: {},
      diffBaseSnapshotId: null,
      diffGhostNodes: {},
      diffGhostRelations: {},
      showDiff: false,
      appMode: 'designer' as const,
      metamodel: initMetamodel,
      notifications: [],
      presentations: initPres.presentations,
      activePresentationId: initPres.activeId,
      presentationSlides: initPres.presentations[0].slides,
      presentationActive: false,
      presentationSlideIndex: 0,

      // ── sync helper ──────────────────────────────────────────────────────
      _sync() {
        set((state) => {
          const view = state.activeViewId ? state.views[state.activeViewId] : undefined
          // Merge diff ghosts (items removed in the active milestone but
          // present in the diff base) so the user can see what's gone.
          // The ghosts are kept in a separate map so they never end up in
          // the real c4Nodes / c4Relations on save.
          const ghostNodes = state.diffGhostNodes as Record<string, C4Node>
          const ghostRels = state.diffGhostRelations as Record<string, C4Relation>
          const hasGhosts = state.showDiff && (Object.keys(ghostNodes).length > 0 || Object.keys(ghostRels).length > 0)
          const liveNodes = state.c4Nodes as Record<string, C4Node>
          const liveRels = state.c4Relations as Record<string, C4Relation>
          const mergedNodes: Record<string, C4Node> = hasGhosts ? { ...ghostNodes, ...liveNodes } : liveNodes
          const mergedRels: Record<string, C4Relation> = hasGhosts ? { ...ghostRels, ...liveRels } : liveRels
          const filter = computeViewNodeSet(view as DiagramView | undefined, mergedNodes)
          const vcs = computeViewCollapsedSet(filter, mergedNodes)
          // Also include nodes the user explicitly collapsed in this named view
          if (view?.collapsedNodeIds?.length) {
            for (const nid of view.collapsedNodeIds) vcs.add(nid)
          }
          // Nodes explicitly expanded in this view override model-level collapse
          const expandedSet = view?.expandedNodeIds?.length
            ? new Set(view.expandedNodeIds)
            : undefined
          const ghostIdSet = hasGhosts ? new Set(Object.keys(ghostNodes)) : undefined
          // "locked" disables drag + selection. Metamodel mode is the only
          // truly read-only mode; designer is always editable; viewer and
          // presenter are "explore" modes (drag + collapse allowed,
          // mutations sandboxed by the setAppMode snapshot/restore).
          // While a presentation is active we also lock — slides are
          // static and must not drift from accidental drags.
          const locked = state.appMode === 'metamodel' || state.presentationActive
          state.rfNodes = deriveRFNodes(mergedNodes, filter, vcs, ghostIdSet, locked, expandedSet) as any
          const hiddenRels = view?.hiddenRelationIds && view.hiddenRelationIds.length
            ? new Set(view.hiddenRelationIds)
            : undefined
          const derivedEdges = deriveRFEdges(mergedNodes, mergedRels, filter, vcs, hiddenRels, expandedSet)
          // Annotate edges with step numbers:
          // 1. When actively editing a sequence (activeSequenceId set) — always show numbers
          // 2. When view is dynamic and linked to a sequence — show numbers in view mode
          const editingSeq = state.activeSequenceId
            ? (state.sequences as Record<string, DiagramSequence>)[state.activeSequenceId]
            : undefined
          const viewSeq = (!editingSeq && view?.kind === 'dynamic' && view.sequenceId)
            ? (state.sequences as Record<string, DiagramSequence>)[view.sequenceId]
            : undefined
          const annotateSeq = editingSeq ?? viewSeq
          if (annotateSeq && annotateSeq.relationIds.length > 0) {
            // Build a map from relationId → all 1-based step indices (same
            // relation can appear multiple times in one sequence).
            const seqIndex = new Map<string, number[]>()
            annotateSeq.relationIds.forEach((id, i) => {
              const arr = seqIndex.get(id)
              if (arr) arr.push(i + 1)
              else seqIndex.set(id, [i + 1])
            })
            for (const edge of derivedEdges) {
              const steps = seqIndex.get(edge.id)
              if (steps !== undefined && edge.data) edge.data.sequenceStep = steps
            }
          }
          state.rfEdges = derivedEdges as any
        })
      },

      /** Push current state to undo stack and sync canUndo/canRedo flags */
      _pushUndo() {
        _pushUndo(get())
        set((state) => { state.canUndo = true; state.canRedo = false })
      },

      /** Mark milestone as dirty if currently editing one (auto-opens prompt on first edit). */
      _markMilestoneEdit() {
        const { activeSnapshotId, milestoneDirty, appMode } = get()
        if (!activeSnapshotId) return
        // Milestones are read-only outside designer mode — ignore edit signals
        // so viewer/presenter can browse historical state without ever being
        // pushed into the "unsaved milestone changes" workflow.
        if (appMode !== 'designer') return
        if (milestoneDirty) return
        set((state) => {
          state.milestoneDirty = true
          state.milestonePromptOpen = true
        })
      },

      // ── nodes ────────────────────────────────────────────────────────────
      addNode(node) {
        const state0 = get()
        const mm = state0.metamodel
        const def = mm?.nodeTypes[node.type]
        const typeLabel = def?.label ?? node.type
        // Cardinality.max
        const count = Object.values(state0.c4Nodes).filter(n => n.type === node.type).length
        if (!canAddMoreOfType(mm, node.type, count)) {
          get().pushNotification(
            `Cannot add another ${typeLabel}: maximum (${def?.cardinality?.max}) reached in the metamodel.`,
            'error',
          )
          return ''
        }
        // Parent containment
        const parent = node.parentId ? state0.c4Nodes[node.parentId] : undefined
        if (!isParentAllowed(mm, node.type, parent?.type)) {
          const allowed = def?.allowedParents
          const parentLabel = parent
            ? (mm?.nodeTypes[parent.type]?.label ?? parent.type)
            : 'the canvas root'
          const allowedStr = allowed && allowed.length
            ? allowed.map(t => mm?.nodeTypes[t]?.label ?? t).join(', ')
            : 'the canvas root'
          get().pushNotification(
            `Cannot place ${typeLabel} inside ${parentLabel}. Allowed parents: ${allowedStr}.`,
            'error',
          )
          return ''
        }
        get()._pushUndo()
        get()._markMilestoneEdit()
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
        const state0 = get()
        const existing = state0.c4Nodes[id]
        if (!existing) return
        // If a reparent or retype is requested, validate against metamodel.
        if ('parentId' in updates || 'type' in updates) {
          const newType = (updates.type as string | undefined) ?? existing.type
          const newParentId = ('parentId' in updates
            ? (updates.parentId as string | null | undefined)
            : existing.parentId) ?? undefined
          const parent = newParentId ? state0.c4Nodes[newParentId] : undefined
          if (!isParentAllowed(state0.metamodel, newType, parent?.type)) {
            const def = state0.metamodel?.nodeTypes[newType]
            const allowed = def?.allowedParents
            const typeLabel = def?.label ?? newType
            const parentLabel = parent
              ? (state0.metamodel?.nodeTypes[parent.type]?.label ?? parent.type)
              : 'the canvas root'
            const allowedStr = allowed && allowed.length
              ? allowed.map(t => state0.metamodel?.nodeTypes[t]?.label ?? t).join(', ')
              : 'the canvas root'
            get().pushNotification(
              `Cannot move ${typeLabel} "${existing.label}" into ${parentLabel}. Allowed parents: ${allowedStr}.`,
              'error',
            )
            return
          }
        }
        get()._pushUndo()
        get()._markMilestoneEdit()
        set((state) => {
          if (!state.c4Nodes[id]) return
          Object.assign(state.c4Nodes[id], updates)
        })
        get()._sync()
        // Only wake the live layout if the change actually affects geometry
        // or graph topology. Editing label / description / technology must
        // NOT trigger a cola rebuild — cola would then re-run from scratch
        // and visibly drift the diagram toward its spring equilibrium
        // (typically up-and-left). Pure text edits are a no-op for layout.
        const LAYOUT_KEYS = ['x', 'y', 'width', 'height', 'parentId', 'type', 'collapsed'] as const
        if (LAYOUT_KEYS.some((k) => k in updates)) {
          _liveLayout?.invalidate()
        }
      },

      removeNode(id) {
        get()._pushUndo()
        get()._markMilestoneEdit()
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
          // Remove from all views (nodeIds and per-view collapse state)
          for (const view of Object.values(state.views)) {
            view.nodeIds = view.nodeIds.filter((nid) => !toRemove.has(nid))
            if (view.collapsedNodeIds?.length)
              view.collapsedNodeIds = view.collapsedNodeIds.filter((nid) => !toRemove.has(nid))
            if (view.expandedNodeIds?.length)
              view.expandedNodeIds = view.expandedNodeIds.filter((nid) => !toRemove.has(nid))
          }
        })
        get()._sync()
        _liveLayout?.invalidate()
      },

      toggleCollapse(id) {
        // Blocked while a presentation is active — slides are static and
        // their layout (positions + collapsed state) must not drift.
        if (get().presentationActive) return
        // Allowed in every mode. In viewer/presenter ("explore" mode), the
        // resulting mutations to c4Nodes / view positions are sandboxed:
        // the snapshot taken in setAppMode() on the way out of designer is
        // restored when the user returns to designer, and the auto-persist
        // subscriber is gated on appMode === 'designer' so nothing reaches
        // disk. We therefore only push to undo history while editing.
        const inDesigner = get().appMode === 'designer'
        if (inDesigner) get()._pushUndo()
        const activeViewId = get().activeViewId
        const modelCollapsed = get().c4Nodes[id]?.collapsed === true
        // Effective collapsed: model-level OR per-view collapse for named views.
        // A model-collapsed node can be view-expanded via view.expandedNodeIds.
        const prevCollapsed = activeViewId
          ? ((modelCollapsed && !(get().views[activeViewId]?.expandedNodeIds?.includes(id) ?? false))
              || (get().views[activeViewId]?.collapsedNodeIds?.includes(id) ?? false))
          : modelCollapsed
        // Apply to model temporarily — layout helpers below (separateSiblings /
        // fitParentToChildren) query node.collapsed to compute effective sizes.
        set((state) => {
          const node = state.c4Nodes[id]
          if (!node) return
          node.collapsed = !prevCollapsed
        })

        // ── Expand origin: ensure children "spawn from the parent" ─────
        // When opening a parent, its children may still hold stale x/y
        // from a previous layout (or from before any layout ran). On the
        // very next frame ReactFlow would render them at those stale
        // positions and cola would then animate them into the new spot
        // — visible as a "teleport, then drift" jump.
        // Fix: reset all direct children to a tight cluster anchored at
        // the parent's top-left header area (parent-relative coords with
        // small jittered offsets, so cola has a non-degenerate starting
        // configuration). Cola then unfolds them outward — the user sees
        // a clean expansion animation originating from the parent.
        if (prevCollapsed) {
          const allNodes = get().c4Nodes
          const parent = allNodes[id]
          if (parent && isContainerType(parent.type)) {
            const HEADER_OFFSET = (parent.type === 'container') ? 110 : 120
            const PAD = 24
            const children = Object.values(allNodes).filter((c) => c.parentId === id)
            if (children.length > 0) {
              // 1) Reset model positions (parent-relative) so a future render
              //    without live cola also shows children clustered inside the
              //    parent's header area instead of at stale coordinates.
              set((state) => {
                children.forEach((child, i) => {
                  const c = state.c4Nodes[child.id]
                  if (!c) return
                  // Tiny deterministic jitter so cola has distinct starting
                  // positions to push apart (otherwise overlapping nodes
                  // produce zero gradient and stay stuck).
                  const jx = ((i * 17) % 11) - 5
                  const jy = ((i * 23) % 9) - 4
                  c.x = PAD + jx
                  c.y = HEADER_OFFSET + jy
                })
              })
              // 2) Seed live cola directly. Cola tracks absolute centre
              //    coordinates, so compute parent's absolute top-left by
              //    walking the ancestor chain. Without this, cola treats
              //    re-appearing children as "new" and spawns them at the
              //    average of their connected neighbours' positions —
              //    making them visibly appear next to the neighbour, not
              //    inside the parent.
              if (_liveLayout) {
                let absX = parent.x
                let absY = parent.y
                let cur: C4Node | undefined = parent
                while (cur?.parentId) {
                  const p: C4Node | undefined = allNodes[cur.parentId]
                  if (!p) break
                  absX += p.x
                  absY += p.y
                  cur = p
                }
                const parentCx = absX + (parent.width ?? 0) / 2
                const parentCy = absY + (parent.height ?? 0) / 2
                children.forEach((child, i) => {
                  const jx = ((i * 17) % 21) - 10
                  const jy = ((i * 23) % 17) - 8
                  _liveLayout!.seedPosition(child.id, parentCx + jx, parentCy + jy)
                })
              }
            }
          }
        }

        // NOTE: no intermediate _sync() here — it would push a render with the
        // new `collapsed` flag but stale sibling positions, which auto-fit would
        // then snap to. The loop below only reads/writes the model; we sync
        // once at the end so the viewport sees a single consistent change.

        // When inside a named view, fitParentToChildren must only consider
        // the nodes that are actually visible in this view. Without the view
        // filter it would resize the parent to fit ALL model children
        // (including those not in the view), keeping the parent far too large.
        // We also pass the current view-collapsed set so previously-collapsed
        // siblings are measured at their collapsed size.
        let loopViewFilter: Set<string> | undefined
        let loopVcs: Set<string> | undefined
        let loopExpandedSet: Set<string> | undefined
        if (activeViewId) {
          const view = get().views[activeViewId]
          if (view) {
            loopViewFilter = computeViewNodeSet(view as any, get().c4Nodes)
            loopVcs = computeViewCollapsedSet(loopViewFilter, get().c4Nodes)
            if (view.collapsedNodeIds?.length) {
              for (const nid of view.collapsedNodeIds) loopVcs.add(nid)
            }
            // Build the expanded set so fitParentToChildren measures view-expanded
            // nodes at their full size, not their model-collapsed size.
            // When we are COLLAPSING the toggled node (!prevCollapsed = true → now
            // collapsing), it must be excluded from the expanded set even if it was
            // previously in view.expandedNodeIds — otherwise fitParentToChildren
            // would still measure it at full height (stale override).
            if (view.expandedNodeIds?.length) {
              loopExpandedSet = new Set(view.expandedNodeIds)
              if (!prevCollapsed) loopExpandedSet.delete(id) // we are collapsing `id`
              if (loopExpandedSet.size === 0) loopExpandedSet = undefined
            }
          }
        }

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
            get().fitParentToChildren(current.parentId, loopViewFilter, loopVcs, loopExpandedSet)
            currentId = current.parentId
          } else {
            break
          }
        }

        // If in a named view: revert the temporary model change and persist
        // collapse state per-view instead, so toggling in one view does not
        // affect other views or the default (all-nodes) view.
        if (activeViewId) {
          set((state) => {
            const node = state.c4Nodes[id]
            if (node) node.collapsed = modelCollapsed  // restore original model state
            const v = state.views[activeViewId]
            if (!v) return
            if (!v.collapsedNodeIds) v.collapsedNodeIds = []
            if (!v.expandedNodeIds) v.expandedNodeIds = []
            if (!prevCollapsed) {
              // Collapsing: add to this view's collapsed list; remove any expansion override
              if (!v.collapsedNodeIds.includes(id)) v.collapsedNodeIds.push(id)
              v.expandedNodeIds = v.expandedNodeIds.filter((nid) => nid !== id)
            } else {
              // Expanding: remove from collapsed list
              v.collapsedNodeIds = v.collapsedNodeIds.filter((nid) => nid !== id)
              // If this node is model-collapsed, we need to remember it was
              // explicitly expanded in this view so _sync() can override the
              // model-level collapse when rendering.
              if (modelCollapsed) {
                if (!v.expandedNodeIds.includes(id)) v.expandedNodeIds.push(id)
              } else {
                // Not model-collapsed — no expansion override needed
                v.expandedNodeIds = v.expandedNodeIds.filter((nid) => nid !== id)
              }
            }
          })
        }

        get()._sync()
        _liveLayout?.invalidate()
      },

      // ── relations ────────────────────────────────────────────────────────
      addRelation(rel) {
        // Enforce metamodel relation rules: refuse to create a relation
        // whose (from, to) type pair is not permitted by the active
        // metamodel. Existing in-memory relations are left untouched and
        // surface as Issues instead.
        const state0 = get()
        const src = state0.c4Nodes[rel.sourceId]
        const dst = state0.c4Nodes[rel.targetId]
        if (src && dst && !isRelationAllowed(state0.metamodel, src.type, dst.type)) {
          const srcLabel = state0.metamodel?.nodeTypes[src.type]?.label ?? src.type
          const dstLabel = state0.metamodel?.nodeTypes[dst.type]?.label ?? dst.type
          get().pushNotification(
            `Relation not allowed: ${srcLabel} \u2192 ${dstLabel}. The metamodel does not permit this connection.`,
            'error',
          )
          return
        }
        // Auto-infer relationType from metamodel when not explicitly provided.
        const relationType =
          rel.relationType ?? (src && dst
            ? inferRelationType(state0.metamodel, src.type, dst.type)
            : undefined)
        get()._pushUndo()
        get()._markMilestoneEdit()
        const id = uid()
        set((state) => {
          state.c4Relations[id] = { id, ...rel, ...(relationType ? { relationType } : {}) }
        })
        get()._sync()
        _liveLayout?.invalidate()
      },

      updateRelation(id, updates) {
        get()._pushUndo()
        get()._markMilestoneEdit()
        set((state) => {
          if (!state.c4Relations[id]) return
          Object.assign(state.c4Relations[id], updates)
        })
        get()._sync()
      },

      removeRelation(id) {
        get()._pushUndo()
        get()._markMilestoneEdit()
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
          state.selectedNodeIds = id ? [id] : []
          if (id) state.selectedEdgeId = null
          // Mirror into RF so the canvas paints the selection ring.
          for (const rn of state.rfNodes as Array<{ id: string; selected?: boolean }>) {
            const want = rn.id === id
            if (!!rn.selected !== want) rn.selected = want
          }
          if (id) {
            for (const re of state.rfEdges as Array<{ selected?: boolean }>) {
              if (re.selected) re.selected = false
            }
          }
        })
      },

      selectEdge(id) {
        set((state) => {
          state.selectedEdgeId = id
          if (id) {
            state.selectedNodeId = null
            state.selectedNodeIds = []
          }
          // Mirror into RF.
          for (const re of state.rfEdges as Array<{ id: string; selected?: boolean }>) {
            const want = re.id === id
            if (!!re.selected !== want) re.selected = want
          }
          if (id) {
            for (const rn of state.rfNodes as Array<{ selected?: boolean }>) {
              if (rn.selected) rn.selected = false
            }
          }
        })
      },

      setSelectedNodeIds(ids) {
        set((state) => {
          // De-dup while preserving order.
          const seen = new Set<string>()
          const clean: string[] = []
          for (const id of ids) {
            if (state.c4Nodes[id] && !seen.has(id)) { seen.add(id); clean.push(id) }
          }
          state.selectedNodeIds = clean
          state.selectedNodeId = clean[0] ?? null
          if (clean.length > 0) state.selectedEdgeId = null
          // Mirror into rfNodes so React Flow paints its selection ring.
          // Without this, programmatic selection (Quick Search, multi-select
          // bar) updates the store but the canvas wouldn't reflect it.
          const selSet = new Set(clean)
          for (const rn of state.rfNodes as Array<{ id: string; selected?: boolean }>) {
            const want = selSet.has(rn.id)
            if (!!rn.selected !== want) rn.selected = want
          }
          if (clean.length > 0) {
            for (const re of state.rfEdges as Array<{ selected?: boolean }>) {
              if (re.selected) re.selected = false
            }
          }
        })
      },

      wrapSelectionInNewParent(parentTypeId) {
        const state0 = get()
        const ids = state0.selectedNodeIds.length
          ? state0.selectedNodeIds
          : (state0.selectedNodeId ? [state0.selectedNodeId] : [])
        if (ids.length === 0) {
          state0.pushNotification('Nothing selected to wrap.', 'warning')
          return
        }
        const nodes = ids.map(id => state0.c4Nodes[id]).filter(Boolean) as C4Node[]
        if (nodes.length === 0) return

        const mm = state0.metamodel
        const parentDef = mm?.nodeTypes[parentTypeId]
        if (!parentDef) {
          state0.pushNotification(`Unknown wrapper type "${parentTypeId}".`, 'error')
          return
        }
        const wrapperLabel = parentDef.label

        // All selected nodes must currently share the same parent — otherwise
        // wrapping would break the existing containment hierarchy.
        const commonParentId = nodes[0].parentId ?? null
        if (!nodes.every(n => (n.parentId ?? null) === commonParentId)) {
          state0.pushNotification(
            'Cannot wrap: selected nodes have different parents. Select siblings only.',
            'error',
          )
          return
        }
        const commonParent = commonParentId ? state0.c4Nodes[commonParentId] : undefined

        // Wrapper must be allowed inside the common parent.
        if (!isParentAllowed(mm, parentTypeId, commonParent?.type)) {
          const allowed = parentDef.allowedParents
          const allowedStr = allowed && allowed.length
            ? allowed.map(t => mm?.nodeTypes[t]?.label ?? t).join(', ')
            : 'the canvas root'
          const where = commonParent
            ? (mm?.nodeTypes[commonParent.type]?.label ?? commonParent.type)
            : 'the canvas root'
          state0.pushNotification(
            `Cannot create ${wrapperLabel} inside ${where}. Allowed parents: ${allowedStr}.`,
            'error',
          )
          return
        }

        // Each selected child type must be allowed inside the new wrapper.
        for (const n of nodes) {
          if (!isParentAllowed(mm, n.type, parentTypeId)) {
            const childDef = mm?.nodeTypes[n.type]
            const childLabel = childDef?.label ?? n.type
            const allowed = childDef?.allowedParents
            const allowedStr = allowed && allowed.length
              ? allowed.map(t => mm?.nodeTypes[t]?.label ?? t).join(', ')
              : 'the canvas root'
            state0.pushNotification(
              `Cannot place ${childLabel} "${n.label}" inside ${wrapperLabel}. Allowed parents: ${allowedStr}.`,
              'error',
            )
            return
          }
        }

        // Bounding box (relative to common parent) + padding & header room.
        const PAD = 30
        const HEADER = 40
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
        for (const n of nodes) {
          minX = Math.min(minX, n.x)
          minY = Math.min(minY, n.y)
          maxX = Math.max(maxX, n.x + (n.width ?? 0))
          maxY = Math.max(maxY, n.y + (n.height ?? 0))
        }
        const newX = minX - PAD
        const newY = minY - PAD - HEADER
        // Hug the children — don't inflate to parentDef defaults, otherwise a
        // freshly-wrapped group looks much larger than its content and may
        // overflow its own parent.
        const newW = maxX - minX + 2 * PAD
        const newH = maxY - minY + 2 * PAD + HEADER

        // Create the wrapper. addNode will re-validate metamodel; we already
        // checked but it's a defensive double-check.
        const newId = get().addNode({
          type: parentTypeId,
          label: `New ${wrapperLabel}`,
          description: '',
          technology: '',
          collapsed: false,
          external: false,
          parentId: commonParentId ?? undefined,
          x: newX,
          y: newY,
          width: newW,
          height: newH,
        } as Omit<C4Node, 'id'>)
        if (!newId) return

        // Reparent each selected node into the wrapper, converting coords to
        // be relative to it. updateNode also re-validates.
        for (const n of nodes) {
          get().updateNode(n.id, {
            parentId: newId,
            x: n.x - newX,
            y: n.y - newY,
          } as Partial<Omit<C4Node, 'id'>>)
        }

        // Tighten the wrapper around its new children, then expand all
        // ancestors bottom-up so each containing system grows to fit. With
        // arbitrary nesting depth (system → system → system) we can't just
        // fit one level — every ancestor needs to recompute.
        get().fitParentToChildren(newId)
        let cur: string | undefined = commonParentId ?? undefined
        const seen = new Set<string>()
        while (cur && !seen.has(cur)) {
          seen.add(cur)
          get().fitParentToChildren(cur)
          cur = get().c4Nodes[cur]?.parentId
        }

        // Promote the new wrapper to the active selection.
        get().setSelectedNodeIds([newId])
        get().pushNotification(
          `Wrapped ${nodes.length} ${nodes.length === 1 ? 'node' : 'nodes'} into ${wrapperLabel}.`,
          'info',
        )
      },

      unwrapNode(id) {
        const state0 = get()
        const node = state0.c4Nodes[id]
        if (!node) return
        const mm = state0.metamodel
        const grandparentId = node.parentId ?? undefined
        const grandparent = grandparentId ? state0.c4Nodes[grandparentId] : undefined
        const grandparentLabel = grandparent
          ? (mm?.nodeTypes[grandparent.type]?.label ?? grandparent.type)
          : 'the canvas root'

        // Direct children only — grandchildren stay nested in their existing
        // parents, which themselves get re-parented one level up.
        const directChildren = Object.values(state0.c4Nodes).filter(
          (n) => n.parentId === id,
        ) as C4Node[]

        // Validate: each direct child must be allowed to live inside the
        // grandparent (or at root). Block early with a useful message.
        for (const c of directChildren) {
          if (!isParentAllowed(mm, c.type, grandparent?.type)) {
            const childDef = mm?.nodeTypes[c.type]
            const childLabel = childDef?.label ?? c.type
            const allowed = childDef?.allowedParents
            const allowedStr = allowed && allowed.length
              ? allowed.map((t) => mm?.nodeTypes[t]?.label ?? t).join(', ')
              : 'the canvas root'
            state0.pushNotification(
              `Cannot unwrap: ${childLabel} "${c.label}" is not allowed inside ${grandparentLabel}. Allowed: ${allowedStr}.`,
              'error',
            )
            return
          }
        }

        get()._pushUndo()
        get()._markMilestoneEdit()
        const removedLabel = mm?.nodeTypes[node.type]?.label ?? node.type
        const childCount = directChildren.length
        const nodeAbsX = node.x
        const nodeAbsY = node.y

        set((state) => {
          // Re-parent direct children, preserving their on-screen position by
          // converting child-local coords (relative to the removed node) to
          // grandparent-local coords (relative to grandparent or root).
          for (const c of directChildren) {
            const sn = state.c4Nodes[c.id]
            if (!sn) continue
            sn.parentId = grandparentId
            sn.x = c.x + nodeAbsX
            sn.y = c.y + nodeAbsY
          }
          // Drop the node itself.
          delete state.c4Nodes[id]
          // Drop only relations that touched the removed node directly;
          // children's relations survive unchanged.
          for (const [rid, rel] of Object.entries(state.c4Relations)) {
            if (rel.sourceId === id || rel.targetId === id) {
              delete state.c4Relations[rid]
            }
          }
          // Remove the node from every view; its children stay in views they
          // were already part of.
          for (const view of Object.values(state.views)) {
            view.nodeIds = view.nodeIds.filter((nid) => nid !== id)
          }
        })

        // Refit the grandparent (and on up) so containment stays tight.
        let cur: string | undefined = grandparentId
        const seen = new Set<string>()
        while (cur && !seen.has(cur)) {
          seen.add(cur)
          get().fitParentToChildren(cur)
          cur = get().c4Nodes[cur]?.parentId
        }

        // Selection: promote the now-unparented children so the user can see
        // what survived.
        get().setSelectedNodeIds(directChildren.map((c) => c.id))

        get()._sync()
        _liveLayout?.invalidate()
        get().pushNotification(
          childCount === 0
            ? `Removed ${removedLabel} "${node.label}".`
            : `Removed ${removedLabel} "${node.label}", kept ${childCount} ${childCount === 1 ? 'child' : 'children'}.`,
          'info',
        )
      },

      reparentNodes(ids, newParentId) {
        const state0 = get()
        const mm = state0.metamodel
        const nodes = ids
          .map((id) => state0.c4Nodes[id])
          .filter((n): n is C4Node => !!n)
        if (nodes.length === 0) return

        // All selected nodes must currently share the same parent so we don't
        // silently merge two different sub-trees.
        const oldParentId = nodes[0].parentId ?? null
        if (!nodes.every((n) => (n.parentId ?? null) === oldParentId)) {
          state0.pushNotification(
            'Cannot move: selected nodes have different parents. Select siblings only.',
            'error',
          )
          return
        }
        if ((newParentId ?? null) === oldParentId) {
          // Nothing to do — new parent is the current parent.
          return
        }

        const newParent = newParentId ? state0.c4Nodes[newParentId] : undefined
        if (newParentId && !newParent) {
          state0.pushNotification('Target parent no longer exists.', 'error')
          return
        }
        const newParentLabel = newParent
          ? (mm?.nodeTypes[newParent.type]?.label ?? newParent.type)
          : 'the canvas root'

        // Cycle guard: new parent must not be one of the moved nodes nor any
        // of their descendants.
        const movedSet = new Set(ids)
        for (const id of ids) {
          for (const d of getDescendants(id, state0.c4Nodes)) movedSet.add(d)
        }
        if (newParentId && movedSet.has(newParentId)) {
          state0.pushNotification(
            'Cannot move a node into itself or one of its descendants.',
            'error',
          )
          return
        }

        // Metamodel: each moved node's type must be allowed inside the target.
        for (const n of nodes) {
          if (!isParentAllowed(mm, n.type, newParent?.type)) {
            const childDef = mm?.nodeTypes[n.type]
            const childLabel = childDef?.label ?? n.type
            const allowed = childDef?.allowedParents
            const allowedStr = allowed && allowed.length
              ? allowed.map((t) => mm?.nodeTypes[t]?.label ?? t).join(', ')
              : 'the canvas root'
            state0.pushNotification(
              `Cannot place ${childLabel} "${n.label}" inside ${newParentLabel}. Allowed: ${allowedStr}.`,
              'error',
            )
            return
          }
        }

        // Compute absolute (root-space) coords by walking up the parent chain.
        const absOf = (id: string): { x: number; y: number } => {
          let x = 0, y = 0
          let cur: C4Node | undefined = state0.c4Nodes[id]
          const seen = new Set<string>()
          while (cur && !seen.has(cur.id)) {
            seen.add(cur.id)
            x += cur.x
            y += cur.y
            cur = cur.parentId ? state0.c4Nodes[cur.parentId] : undefined
          }
          return { x, y }
        }
        const newParentAbs = newParentId
          ? absOf(newParentId)
          : { x: 0, y: 0 }

        get()._pushUndo()
        get()._markMilestoneEdit()
        set((state) => {
          for (const n of nodes) {
            const sn = state.c4Nodes[n.id]
            if (!sn) continue
            const a = absOf(n.id) // computed against the original tree (state0)
            sn.parentId = newParentId ?? undefined
            sn.x = a.x - newParentAbs.x
            sn.y = a.y - newParentAbs.y
          }
        })

        // Refit both sides of the move bottom-up so containers grow/shrink.
        const refitChain = (startId: string | null | undefined): void => {
          let cur: string | undefined = startId ?? undefined
          const seen = new Set<string>()
          while (cur && !seen.has(cur)) {
            seen.add(cur)
            get().fitParentToChildren(cur)
            cur = get().c4Nodes[cur]?.parentId
          }
        }
        refitChain(oldParentId)
        refitChain(newParentId)

        get().setSelectedNodeIds(ids)
        get()._sync()
        _liveLayout?.invalidate()
        get().pushNotification(
          `Moved ${nodes.length} ${nodes.length === 1 ? 'node' : 'nodes'} into ${newParentLabel}.`,
          'info',
        )
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
        let positionsRestored = false
        set((state) => {
          delete state.views[id]
          if (state.activeViewId === id) {
            // Restore default positions before switching away
            applyPositions(state.c4Nodes as Record<string, C4Node>, state.defaultPositions as Record<string, NodePosition>)
            state.activeViewId = null
            positionsRestored = true
          }
        })
        get()._sync()
        if (positionsRestored) _liveLayout?.reset()
      },
      renameView(id, name) {
        set((state) => {
          if (state.views[id]) state.views[id].name = name
        })
      },
      setActiveView(newId) {
        const { activeViewId, c4Nodes, appMode } = get()
        if (newId === activeViewId) return

        // In viewer (explore mode) we deliberately keep the user's current
        // node positions when the active view changes — they may have
        // dragged things around to inspect a relationship and shouldn't
        // lose that arrangement just because they flipped to another view.
        // Only the *visibility* (view filter) changes; positions are NOT
        // saved into the outgoing view (would dirty the in-memory map for
        // the explore session) and NOT loaded from the incoming view.
        // The pre-mode snapshot in setAppMode restores everything cleanly
        // when the user returns to designer.
        if (appMode !== 'designer') {
          set((state) => { state.activeViewId = newId })
          get()._sync()
          return
        }

        // 1. Snapshot current positions from c4Nodes
        const currentPos = snapshotPositions(c4Nodes)
        // 1b. Snapshot current camera (pan + zoom). Canvas keeps this fresh
        //     in window.__rfCurrentViewport via React Flow's onMove handler.
        const rawVP = (window as any).__rfCurrentViewport
        const currentViewport: { x: number; y: number; zoom: number } | null = rawVP
          ? { x: rawVP.x, y: rawVP.y, zoom: rawVP.zoom }
          : null

        set((state) => {
          // 2. Save to outgoing context
          if (activeViewId === null) {
            state.defaultPositions = currentPos as any
            if (currentViewport) state.defaultViewport = currentViewport
          } else if (state.views[activeViewId]) {
            state.views[activeViewId].positions = currentPos as any
            if (currentViewport) state.views[activeViewId].viewport = currentViewport
          }

          // 3. Load from incoming context
          let incoming: Record<string, NodePosition> | undefined
          let incomingViewport: { x: number; y: number; zoom: number } | null = null
          if (newId === null) {
            incoming = state.defaultPositions as Record<string, NodePosition>
            incomingViewport = state.defaultViewport as typeof incomingViewport
          } else {
            const view = state.views[newId]
            if (view && Object.keys(view.positions).length > 0) {
              incoming = view.positions as Record<string, NodePosition>
            }
            if (view?.viewport) incomingViewport = view.viewport
            // New view with no positions yet → keep current positions
          }

          if (incoming) {
            applyPositions(state.c4Nodes as Record<string, C4Node>, incoming)
          }

          state.activeViewId = newId
          // Stash for the post-set effect below; we apply the viewport AFTER
          // _sync() so React Flow has already re-rendered nodes.
          ;(state as any).__pendingViewport = incomingViewport
        })
        get()._sync()
        // Apply restored camera. Defer so React Flow finishes rendering the
        // newly-positioned nodes before we move the viewport.
        const pending = (get() as any).__pendingViewport as
          | { x: number; y: number; zoom: number }
          | null
        if (pending) {
          requestAnimationFrame(() => {
            const setVP = (window as any).__rfSetViewport as
              | ((vp: { x: number; y: number; zoom: number }, opts?: { duration?: number }) => void)
              | null
            setVP?.(pending, { duration: 250 })
          })
        }
        set((state) => { delete (state as any).__pendingViewport })
        // Drop cola's cached positions so the live layout doesn't immediately
        // overwrite the just-restored coordinates with stale ones.
        _liveLayout?.reset()
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
          if (!view) return
          if (view.nodeIds.length === 0) {
            // Empty nodeIds means "show all". First removal transitions to
            // "show all except this node" by explicitly listing every other node.
            view.nodeIds = Object.keys(state.c4Nodes).filter(id => id !== nodeId)
          } else {
            view.nodeIds = view.nodeIds.filter((id) => id !== nodeId)
          }
          // Also clean up per-view collapse state for the removed node
          if (view.collapsedNodeIds?.length)
            view.collapsedNodeIds = view.collapsedNodeIds.filter((nid) => nid !== nodeId)
          if (view.expandedNodeIds?.length)
            view.expandedNodeIds = view.expandedNodeIds.filter((nid) => nid !== nodeId)
        })
        get()._sync()
      },
      setViewNodes(viewId, nodeIds) {
        const state0 = get()
        if (!state0.views[viewId]) return
        // Filter out unknown ids defensively — the AI may emit a stale id.
        const valid = nodeIds.filter((id) => id in state0.c4Nodes)
        // Dedupe while preserving order.
        const seen = new Set<string>()
        const ordered: string[] = []
        for (const id of valid) {
          if (!seen.has(id)) { seen.add(id); ordered.push(id) }
        }
        get()._pushUndo()
        set((state) => {
          const view = state.views[viewId]
          if (view) view.nodeIds = ordered
        })
        get()._sync()
        _liveLayout?.invalidate()
      },
      hideRelationFromView(viewId, relationId) {
        set((state) => {
          const view = state.views[viewId]
          if (!view) return
          if (!view.hiddenRelationIds) view.hiddenRelationIds = []
          if (!view.hiddenRelationIds.includes(relationId)) {
            view.hiddenRelationIds.push(relationId)
          }
        })
        get()._sync()
      },
      unhideRelationInView(viewId, relationId) {
        set((state) => {
          const view = state.views[viewId]
          if (!view || !view.hiddenRelationIds) return
          view.hiddenRelationIds = view.hiddenRelationIds.filter((id) => id !== relationId)
        })
        get()._sync()
      },

      setViewKind(viewId, kind) {
        set((state) => {
          const view = state.views[viewId]
          if (!view) return
          view.kind = kind
        })
        get()._sync()
      },

      setTreemapFocus(viewId, focusId) {
        set((state) => {
          const view = state.views[viewId]
          if (!view) return
          view.treemapFocusId = focusId
        })
        get()._sync()
      },

      setTreemapSizeBy(viewId, mode) {
        set((state) => {
          const view = state.views[viewId]
          if (!view) return
          view.treemapSizeBy = mode
        })
        get()._sync()
      },

      setTreemapMaxDepth(viewId, depth) {
        set((state) => {
          const view = state.views[viewId]
          if (!view) return
          view.treemapMaxDepth = depth
        })
        get()._sync()
      },

      toggleTreemapExpand(viewId, nodeId) {
        set((state) => {
          const view = state.views[viewId]
          if (!view) return
          const list = view.treemapExpandedIds ?? []
          const idx = list.indexOf(nodeId)
          if (idx >= 0) {
            view.treemapExpandedIds = list.filter((_, i) => i !== idx)
          } else {
            view.treemapExpandedIds = [...list, nodeId]
          }
        })
        get()._sync()
      },

      setViewLayoutMode(viewId, mode) {
        set((state) => {
          const view = state.views[viewId]
          if (!view) return
          view.layoutMode = mode
        })
        get()._sync()
      },

      setViewSequence(viewId, sequenceId) {
        set((state) => {
          const view = state.views[viewId]
          if (!view) return
          view.sequenceId = sequenceId ?? undefined
        })
        get()._sync()
      },

      addViewFromSequence(sequenceId) {
        const { sequences, c4Relations } = get()
        const seq = sequences[sequenceId]
        const viewId = uid()
        // Collect unique node ids (source + target) for all relations in the sequence
        const nodeSet = new Set<string>()
        for (const relId of (seq?.relationIds ?? [])) {
          const rel = c4Relations[relId]
          if (rel) { nodeSet.add(rel.sourceId); nodeSet.add(rel.targetId) }
        }
        const name = seq ? `${seq.name} view` : 'Sequence view'
        get()._pushUndo()
        set((state) => {
          state.views[viewId] = {
            id: viewId,
            name,
            kind: 'dynamic',
            sequenceId,
            nodeIds: Array.from(nodeSet),
            positions: {},
          }
        })
        get().setActiveView(viewId)
        return viewId
      },

      // ── sequences ───────────────────────────────────────────────────────
      addSequence(name) {
        const id = uid()
        set((state) => {
          state.sequences[id] = { id, name, relationIds: [] }
        })
        get()._markMilestoneEdit()
        return id
      },

      removeSequence(id) {
        set((state) => {
          delete state.sequences[id]
          // Unlink views that referenced this sequence
          for (const view of Object.values(state.views)) {
            if ((view as DiagramView).sequenceId === id) {
              (view as DiagramView).sequenceId = undefined
            }
          }
          if (state.activeSequenceId === id) state.activeSequenceId = null
        })
        get()._markMilestoneEdit()
        get()._sync()
      },

      renameSequence(id, name) {
        set((state) => {
          if (state.sequences[id]) state.sequences[id].name = name
        })
        get()._markMilestoneEdit()
      },

      setActiveSequence(id) {
        set((state) => { state.activeSequenceId = id })
        get()._sync()
      },

      toggleRelationInSequence(sequenceId, relationId) {
        set((state) => {
          const seq = state.sequences[sequenceId]
          if (!seq) return
          // Always append — the same relation may appear multiple times in a
          // sequence (e.g. step 2 and step 9). Use removeFromSequence to delete
          // individual occurrences via the step list in the right panel.
          seq.relationIds.push(relationId)
        })
        get()._markMilestoneEdit()
        get()._sync()
      },

      removeFromSequence(sequenceId, idx) {
        set((state) => {
          const seq = state.sequences[sequenceId]
          if (!seq) return
          seq.relationIds.splice(idx, 1)
          if (seq.stepDescriptions) seq.stepDescriptions.splice(idx, 1)
        })
        get()._markMilestoneEdit()
        get()._sync()
      },

      reorderSequence(sequenceId, fromIdx, toIdx) {
        set((state) => {
          const seq = state.sequences[sequenceId]
          if (!seq) return
          const arr = seq.relationIds
          if (fromIdx < 0 || fromIdx >= arr.length || toIdx < 0 || toIdx >= arr.length) return
          const [item] = arr.splice(fromIdx, 1)
          arr.splice(toIdx, 0, item)
          if (seq.stepDescriptions) {
            const [desc] = seq.stepDescriptions.splice(fromIdx, 1)
            seq.stepDescriptions.splice(toIdx, 0, desc)
          }
        })
        get()._markMilestoneEdit()
        get()._sync()
      },

      clearSequence(sequenceId) {
        set((state) => {
          const seq = state.sequences[sequenceId]
          if (!seq) return
          seq.relationIds = []
          seq.stepDescriptions = []
        })
        get()._markMilestoneEdit()
        get()._sync()
      },

      updateStepDescription(sequenceId, idx, description) {
        set((state) => {
          const seq = state.sequences[sequenceId]
          if (!seq) return
          if (!seq.stepDescriptions) seq.stepDescriptions = []
          // Pad with undefined if necessary
          while (seq.stepDescriptions.length <= idx) seq.stepDescriptions.push(undefined)
          seq.stepDescriptions[idx] = description || undefined
        })
        get()._markMilestoneEdit()
        get()._sync()
      },

      // ── React Flow sync ──────────────────────────────────────────────────
      onNodesChange(changes) {
        // Intercept Delete-key removals — show a confirmation prompt instead
        // of silently dropping nodes from the canvas (which previously left
        // them in the model and out-of-sync with rfNodes).
        const removals = changes.filter((c) => c.type === 'remove') as Array<{ type: 'remove'; id: string }>
        if (removals.length > 0) {
          const ids = removals.map((c) => c.id)
          set((state) => {
            const prev = state.pendingDelete ?? { nodeIds: [], edgeIds: [] }
            state.pendingDelete = {
              nodeIds: Array.from(new Set([...prev.nodeIds, ...ids])),
              edgeIds: prev.edgeIds,
            }
          })
        }
        const passthrough = changes.filter((c) => c.type !== 'remove')
        set((state) => {
          // During live layout, Cola controls non-dragged node positions.
          // But we MUST let ReactFlow's own drag position changes through
          // so the user sees immediate feedback (no 1-frame delay via Cola).
          // Filter out dimension changes from Cola — rfNodes get those via applyPositions.
          const effectiveChanges = state.liveLayoutActive
            ? passthrough.filter((c) => c.type !== 'dimensions')
            : passthrough
          state.rfNodes = applyNodeChanges(effectiveChanges, state.rfNodes) as any

          // Track multi-selection driven by ReactFlow (shift/cmd-click,
          // selection box). We rebuild selectedNodeIds from the current
          // rfNodes' selected flag so it reflects the true UI state.
          const hasSelectChange = passthrough.some(c => c.type === 'select')
          if (hasSelectChange) {
            const ids: string[] = []
            for (const rn of state.rfNodes) {
              if ((rn as any).selected) ids.push(rn.id)
            }
            state.selectedNodeIds = ids
            state.selectedNodeId = ids[0] ?? state.selectedNodeId
            // Compatibility with single-select consumers: when nothing is
            // selected on canvas, also clear the primary id.
            if (ids.length === 0) state.selectedNodeId = null
            if (ids.length > 0) state.selectedEdgeId = null
          }

          for (const change of passthrough) {
            if (change.type === 'select' && change.id) {
              if (change.selected) state.selectedNodeId = change.id
            }
          }
        })
      },

      onEdgesChange(changes) {
        const removals = changes.filter((c) => c.type === 'remove') as Array<{ type: 'remove'; id: string }>
        if (removals.length > 0) {
          const ids = removals.map((c) => c.id)
          set((state) => {
            const prev = state.pendingDelete ?? { nodeIds: [], edgeIds: [] }
            state.pendingDelete = {
              nodeIds: prev.nodeIds,
              edgeIds: Array.from(new Set([...prev.edgeIds, ...ids])),
            }
          })
        }
        const passthrough = changes.filter((c) => c.type !== 'remove')
        set((state) => {
          state.rfEdges = applyEdgeChanges(passthrough, state.rfEdges) as any
          for (const change of passthrough) {
            if (change.type === 'select' && change.id && change.selected) {
              // Don't select edge when a sequence is being edited — clicks are sequence toggles
              if (!state.activeSequenceId) {
                state.selectedEdgeId = change.id
              }
            }
          }
        })
      },

      resolvePendingDelete(action) {
        const pending = get().pendingDelete
        if (!pending) return
        // Always clear pending first so the modal closes immediately.
        set((state) => { state.pendingDelete = null })
        if (action === 'cancel') return

        const { nodeIds, edgeIds } = pending
        if (action === 'view') {
          const viewId = get().activeViewId
          if (viewId) {
            // Hide nodes from the active view only. Edges follow their
            // endpoints, so we don't need a separate edge-hide step.
            for (const id of nodeIds) get().removeNodeFromView(viewId, id)
          } else {
            // No active view → fall back to model deletion.
            for (const id of nodeIds) get().removeNode(id)
            for (const id of edgeIds) get().removeRelation(id)
          }
          return
        }
        // action === 'model'
        for (const id of nodeIds) get().removeNode(id)
        for (const id of edgeIds) get().removeRelation(id)
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

      fitParentToChildren(parentId, viewFilter, viewCollapsedSet, expandedSet) {
        const { c4Nodes } = get()
        const parent = c4Nodes[parentId]
        if (!parent || !isContainerType(parent.type)) return
        // Don't resize a collapsed node (model-collapsed or view-collapsed)
        if (isEffectivelyCollapsed(parent, viewCollapsedSet, expandedSet)) return

        let children = Object.values(c4Nodes).filter((c) => c.parentId === parentId)
        // When a view filter is active, only consider children in the view
        if (viewFilter) children = children.filter((c) => viewFilter.has(c.id))
        if (children.length === 0) return

        // Padding matching ELK CHILD_OPTIONS (direction RIGHT, same for both levels)
        const padRight  = (parent.type === 'container') ? 20 : 30
        const padBottom = (parent.type === 'container') ? 20 : 30

        let maxRight = 0
        let maxBottom = 0
        for (const child of children) {
          const h = effectiveNodeHeight(child, viewCollapsedSet, expandedSet)
          const w = effectiveNodeWidth(child, viewCollapsedSet, expandedSet)
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
        if (get().appMode !== 'designer') return
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
        if (get().appMode !== 'designer') return
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
        if (get().appMode !== 'designer') return
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
        if (get().appMode !== 'designer') return
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

      async runTreeLayout() {
        if (get().appMode === 'metamodel') return
        set((state) => { state.isLayoutRunning = true })
        try {
          const state = get()
          const view = state.activeViewId ? state.views[state.activeViewId] : undefined
          const vf = computeViewNodeSet(view, state.c4Nodes)
          const vcs = computeViewCollapsedSet(vf, state.c4Nodes)
          const { nodes: c4Nodes, relations: c4Relations } = filterForView(state.c4Nodes, state.c4Relations, vf, vcs)
          const positions = await applyTreeLayout(c4Nodes, c4Relations)
          get()._markMilestoneEdit()
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

          // Final collision-safety pass at root level.
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
          get()._sync()

          // Drop cola caches so the live layout doesn't snap nodes back to
          // their pre-layout positions on the next rebuild.
          _liveLayout?.reset()
          if (typeof window !== 'undefined') {
            const flush = (window as any).__radicalFlushPersist as (() => Promise<void>) | undefined
            void flush?.()
          }
          if (typeof requestAnimationFrame !== 'undefined') {
            requestAnimationFrame(() => { _getFitViewFn()?.() })
          } else {
            _getFitViewFn()?.()
          }
          get().pushNotification('Hierarchical tree layout applied.', 'info')
        } finally {
          set((state) => { state.isLayoutRunning = false })
        }
      },

      async runSmartLayout() {
        // Allowed in designer and viewer (viewer = explore: positions are
        // reverted on exit by the __preModeLayout snapshot in setAppMode).
        // Disallowed in metamodel where the canvas isn't shown.
        if (get().appMode === 'metamodel') return
        // Per-view layout-mode override: views configured for the
        // hierarchical nested-tree strategy delegate here. Default is
        // unchanged (ensemble Smart Layout).
        {
          const s = get()
          const v = s.activeViewId ? s.views[s.activeViewId] : undefined
          if (v?.layoutMode === 'tree') {
            await get().runTreeLayout()
            return
          }
        }
        set((state) => { state.isLayoutRunning = true })
        try {
          const state = get()
          const view = state.activeViewId ? state.views[state.activeViewId] : undefined
          const vf = computeViewNodeSet(view, state.c4Nodes)
          const vcs = computeViewCollapsedSet(vf, state.c4Nodes)
          const { nodes: c4Nodes, relations: c4Relations } = filterForView(state.c4Nodes, state.c4Relations, vf, vcs)
          const result = await runSmartLayout(c4Nodes, c4Relations, state.metamodel as Metamodel | undefined)
          if (result.candidates.length === 0) {
            get().pushNotification('Smart layout: no candidate produced a result.', 'warning')
            return
          }
          get()._markMilestoneEdit()
          set((state) => {
            for (const [id, pos] of Object.entries(result.winner.positions)) {
              const node = state.c4Nodes[id]
              if (!node) continue
              node.x = pos.x
              node.y = pos.y
              if (pos.width)  node.width  = pos.width
              if (pos.height) node.height = pos.height
            }
          })
          get()._resizeParentsBottomUp(vf, vcs)

          // Final collision-safety pass at root level (same as ELK/Radical paths).
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
          get()._sync()

          // Drop cola caches so the live layout doesn't snap nodes back to
          // their pre-smart positions on the next rebuild.
          _liveLayout?.reset()

          // Persist immediately. The default auto-persist is debounced
          // 400 ms — but the live cola layout starts ticking right now
          // (via reset() above) and its gradient descent will drift the
          // nodes back toward its prior equilibrium within that window,
          // so a delayed save would capture the drifted positions instead
          // of smart layout's output. Calling the flush hook here saves
          // smart layout's exact result before cola has a chance to move
          // anything.
          if (typeof window !== 'undefined') {
            const flush = (window as any).__radicalFlushPersist as (() => Promise<void>) | undefined
            void flush?.()
          }

          // Friendly summary so the user sees what happened.
          const before = result.baseline
          const after = result.winner.metrics
          const pct = before.weightedCost > 0
            ? Math.max(0, Math.round((1 - after.weightedCost / before.weightedCost) * 100))
            : 0
          const planarTag = result.planarity.verdict === 'planar'
            ? 'planar ✓'
            : `${Math.round((1 - result.planarity.ratio) * 100)}% planar`
          const arrow = '\u2009\u2192\u2009'
          const msg = before.weightedCost === 0
            ? `Smart layout: ${result.winner.name} — ${after.crossings} crossings, ${after.overdraws} overdraws · ${planarTag}.`
            : `Smart layout: ${result.winner.name} — crossings ${before.crossings}${arrow}${after.crossings}, overdraws ${before.overdraws}${arrow}${after.overdraws} (${pct}% better) · ${planarTag}.`
          get().pushNotification(msg, 'info')
          // Auto fit-all so the user immediately sees the freshly-laid-out
          // diagram framed in the viewport. Defer one paint so React Flow
          // has applied the new node positions before fitView measures them.
          if (typeof requestAnimationFrame !== 'undefined') {
            requestAnimationFrame(() => { _getFitViewFn()?.() })
          } else {
            _getFitViewFn()?.()
          }
          // Console breadcrumb with full ranking + SA stats — useful for tuning.
          console.info(
            '[smartLayout]', result.winner.name,
            'crossings', after.crossings, 'overdraws', after.overdraws,
            '· SA', result.refinement.before.toFixed(0), arrow, result.refinement.after.toFixed(0),
            `(${result.refinement.iterations} iters)`,
            '· planarity', result.planarity.verdict, `(${result.planarity.crossingEdges}/${result.planarity.totalEdges})`,
            '· winner score', result.winner.score,
            '· ranking:', result.candidates.map((c) =>
              `${c.name} [composite=${c.score.composite.toFixed(0)} cross=${c.metrics.crossings}(rend${c.score.renderedCrossings}) over=${c.metrics.overdraws}(rend${c.score.renderedOverdraws}) loop=${c.score.stubLoopPenalty.toFixed(2)} olap=${c.score.nodeOverlap.toFixed(1)} long=${c.score.edgeLengthExcess.toFixed(1)} lmean=${c.score.edgeLengthMean.toFixed(2)} leaf=${c.score.leafCentrality.toFixed(2)} ar=${c.score.aspectPenalty.toFixed(2)} sym=${c.score.symmetryDeficit.toFixed(2)}]`,
            ).join(' | '),
          )
        } catch (err) {
          console.error('[smartLayout] failed:', err)
          get().pushNotification('Smart layout failed — see console.', 'error')
        } finally {
          set((state) => { state.isLayoutRunning = false })
        }
      },

      setLayoutMode(mode) {
        set((state) => { state.layoutMode = mode })
      },

      startLiveLayout(opts?: { skipBulk?: boolean }) {
        const skipBulk = opts?.skipBulk ?? false
        if (_liveLayout?.running) return
        // Reuse existing instance if present so its _bulkDone flag persists
        // across pause/resume cycles (mode switches, presentation exit).
        // Re-creating would always do a full bulk re-arrange and visibly
        // shift the diagram.
        if (_liveLayout) {
          _liveLayout.start(skipBulk)
          set((state) => { state.liveLayoutActive = true })
          return
        }
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
        _liveLayout.start(skipBulk)
        set((state) => { state.liveLayoutActive = true })
      },

      stopLiveLayout() {
        // Keep the LiveColaLayout instance around so a subsequent
        // startLiveLayout() doesn't redo the heavy first-time bulk
        // arrangement (which would shift every node from its current
        // position). The instance internally tracks _bulkDone.
        _liveLayout?.stop()
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
        // A drag while editing a milestone is a real edit too — mark dirty
        // so the user is asked how to persist it (propagate / save as new).
        // Without this, positions never make it into the snapshot and switching
        // milestones reverts the move.
        get()._markMilestoneEdit()
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
          state.views = entry.views as any
          state.canUndo = _undoStack.length > 0
          state.canRedo = true
        })
        get()._sync()
        _liveLayout?.reset()
      },

      redo() {
        if (_redoStack.length === 0) return
        const entry = _redoStack.pop()!
        // push current state to undo
        _undoStack.push(_captureState(get()))
        set((state) => {
          state.c4Nodes = entry.c4Nodes as any
          state.c4Relations = entry.c4Relations as any
          state.views = entry.views as any
          state.canUndo = true
          state.canRedo = _redoStack.length > 0
        })
        get()._sync()
        _liveLayout?.reset()
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
          sequences: JSON.parse(JSON.stringify(get().sequences)),
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
          if (snap.sequences) {
            state.sequences = JSON.parse(JSON.stringify(snap.sequences)) as any
          }
          state.canUndo = _undoStack.length > 0
          state.canRedo = _redoStack.length > 0
          state.activeSnapshotId = id
        })
        get()._sync()
        _liveLayout?.reset()
      },

      removeSnapshot(id) {
        set((state) => {
          state.snapshots = state.snapshots.filter(s => s.id !== id) as any
          if (state.activeSnapshotId === id) {
            // If the active milestone is being deleted, restore live and clear flags.
            if (state.liveBackup) {
              state.c4Nodes = JSON.parse(JSON.stringify(state.liveBackup.nodes)) as any
              state.c4Relations = JSON.parse(JSON.stringify(state.liveBackup.relations)) as any
              if ((state.liveBackup as any).sequences) {
                state.sequences = JSON.parse(JSON.stringify((state.liveBackup as any).sequences)) as any
              }
            }
            state.activeSnapshotId = null
            state.liveBackup = null
            state.milestoneDirty = false
            state.milestonePromptOpen = false
            state.diffHighlight = {} as any
            state.diffBaseSnapshotId = null
            state.diffGhostNodes = {} as any
            state.diffGhostRelations = {} as any
          }
        })
        get()._sync()
        _liveLayout?.reset()
      },

      renameSnapshot(id, name) {
        set((state) => {
          const snap = state.snapshots.find(s => s.id === id)
          if (snap) snap.name = name
        })
      },

      // ── Milestone editing workflow ───────────────────────────────────────
      selectMilestone(id) {
        const { snapshots, activeSnapshotId, milestoneDirty, c4Nodes, c4Relations, sequences } = get()
        // If selecting the already-active milestone, just close any open prompt.
        if (activeSnapshotId === id) {
          set((state) => { state.milestonePromptOpen = false })
          return
        }
        // Block switching with unsaved milestone edits — user must commit/discard first.
        if (activeSnapshotId && milestoneDirty) {
          set((state) => { state.milestonePromptOpen = true })
          return
        }
        const snap = snapshots.find(s => s.id === id)
        if (!snap) return
        // Backup live HEAD if we don't already have one.
        const backup = activeSnapshotId
          ? get().liveBackup
          : { nodes: JSON.parse(JSON.stringify(c4Nodes)), relations: JSON.parse(JSON.stringify(c4Relations)), sequences: JSON.parse(JSON.stringify(sequences)) }

        // In viewer (explore mode) keep the user's currently-arranged
        // positions for any node that still exists in the new milestone
        // snapshot. Only nodes that didn't exist before take their
        // position from the snapshot. The pre-mode snapshot in setAppMode
        // restores everything cleanly when the user returns to designer.
        const preserveLayout = get().appMode !== 'designer'
        const livePosByLabel = new Map<string, { x: number; y: number; width: number; height: number; collapsed?: boolean }>()
        if (preserveLayout) {
          for (const n of Object.values(c4Nodes)) {
            livePosByLabel.set(n.id, { x: n.x, y: n.y, width: n.width, height: n.height, collapsed: n.collapsed })
          }
        }
        // Compute diff vs previous milestone so the user can see what
        // changed at this point in time. The very first/oldest milestone
        // (idx === 0) is the baseline itself — there is no "before", so we
        // skip the diff overlay entirely (otherwise it would highlight
        // everything that diverged from the live HEAD, which is confusing
        // because v1 is supposed to be the original state).
        const idx = snapshots.findIndex(s => s.id === id)
        const prev = idx > 0 ? snapshots[idx - 1] : null
        const diff = prev
          ? computeSnapDiff(
              prev.nodes as Record<string, C4Node>,
              snap.nodes as Record<string, C4Node>,
              prev.relations as Record<string, C4Relation>,
              snap.relations as Record<string, C4Relation>,
            )
          : {}
        // Augment with sequence membership changes (structural diff takes priority).
        if (prev) {
          const seqDiff = computeSeqDiff(
            prev.sequences as Record<string, DiagramSequence> | undefined,
            snap.sequences as Record<string, DiagramSequence> | undefined,
          )
          for (const [rid, action] of Object.entries(seqDiff)) {
            if (!diff[rid]) diff[rid] = action
          }
        }
        const ghosts = prev
          ? computeDiffGhosts(
              prev.nodes as Record<string, C4Node>,
              snap.nodes as Record<string, C4Node>,
              prev.relations as Record<string, C4Relation>,
              snap.relations as Record<string, C4Relation>,
            )
          : { nodes: {}, relations: {} }
        _pushUndo(get())
        set((state) => {
          const nextNodes = JSON.parse(JSON.stringify(snap.nodes)) as Record<string, C4Node>
          if (preserveLayout) {
            for (const [nid, n] of Object.entries(nextNodes)) {
              const live = livePosByLabel.get(nid)
              if (live) {
                n.x = live.x; n.y = live.y
                n.width = live.width; n.height = live.height
                if (live.collapsed !== undefined) n.collapsed = live.collapsed
              }
            }
          }
          state.c4Nodes = nextNodes as any
          state.c4Relations = JSON.parse(JSON.stringify(snap.relations)) as any
          if (snap.sequences) {
            state.sequences = JSON.parse(JSON.stringify(snap.sequences)) as any
          }
          state.activeSnapshotId = id
          state.liveBackup = backup as any
          state.milestoneDirty = false
          state.milestonePromptOpen = false
          state.diffHighlight = diff as any
          state.diffBaseSnapshotId = prev ? prev.id : null
          state.diffGhostNodes = ghosts.nodes as any
          state.diffGhostRelations = ghosts.relations as any
          state.canUndo = _undoStack.length > 0
          state.canRedo = _redoStack.length > 0
        })
        get()._sync()
        // Reseed cola from the freshly-loaded milestone positions so the
        // live layout continues from there (instead of carrying over the
        // previous canvas's cached coords). Physics keeps running so the
        // user can still drag / nudge nodes around on the milestone.
        _liveLayout?.reset()
      },

      dismissMilestonePrompt() {
        set((state) => { state.milestonePromptOpen = false })
      },

      discardMilestoneChanges() {
        const { liveBackup } = get()
        set((state) => {
          if (state.liveBackup) {
            state.c4Nodes = JSON.parse(JSON.stringify(state.liveBackup.nodes)) as any
            state.c4Relations = JSON.parse(JSON.stringify(state.liveBackup.relations)) as any
            if ((state.liveBackup as any).sequences) {
              state.sequences = JSON.parse(JSON.stringify((state.liveBackup as any).sequences)) as any
            }
          }
          state.activeSnapshotId = null
          state.liveBackup = null
          state.milestoneDirty = false
          state.milestonePromptOpen = false
          state.diffHighlight = {} as any
          state.diffBaseSnapshotId = null
          state.diffGhostNodes = {} as any
          state.diffGhostRelations = {} as any
        })
        get()._sync()
        _liveLayout?.reset()
        void liveBackup
      },

      commitMilestoneChanges(mode, newName) {
        const { activeSnapshotId, snapshots, c4Nodes, c4Relations, sequences, liveBackup } = get()
        if (!activeSnapshotId) return
        const idx = snapshots.findIndex(s => s.id === activeSnapshotId)
        if (idx < 0) return

        // Deep clones of the current (edited) canvas state.
        const editedNodes: Record<string, C4Node> = JSON.parse(JSON.stringify(c4Nodes))
        const editedRels: Record<string, C4Relation> = JSON.parse(JSON.stringify(c4Relations))
        const editedSeqs: Record<string, DiagramSequence> = JSON.parse(JSON.stringify(sequences))
        // Snapshot of the milestone BEFORE edits — used to compute the diff.
        const baseSnap = snapshots[idx]
        const baseNodes = baseSnap.nodes as Record<string, C4Node>
        const baseRels = baseSnap.relations as Record<string, C4Relation>
        const baseSeqs = (baseSnap.sequences ?? {}) as Record<string, DiagramSequence>

        if (mode === 'new') {
          // Insert a new milestone immediately after the active one with the edited state.
          const newId = uid()
          const namePrefix = newName?.trim() || `${baseSnap.name} (edited)`
          const newSnap: DiagramSnapshot = {
            id: newId,
            name: namePrefix,
            timestamp: Date.now(),
            nodes: editedNodes,
            relations: editedRels,
            sequences: editedSeqs,
          }
          set((state) => {
            state.snapshots.splice(idx + 1, 0, newSnap as any)
            // Stay viewing the freshly-created milestone (canvas already shows its content).
            // liveBackup is preserved so the user can still discard back to live HEAD.
            state.activeSnapshotId = newId
            state.milestoneDirty = false
            state.milestonePromptOpen = false
          })
          get()._sync()
          _liveLayout?.reset()
          void liveBackup
          return
        }

        // mode === 'propagate':
        // Compute element-level diff: added / removed / per-field updated.
        const addedNodes: C4Node[] = []
        const updatedNodes: { id: string; updates: Partial<C4Node> }[] = []
        const removedNodeIds: string[] = []
        for (const id of Object.keys(editedNodes)) {
          if (!baseNodes[id]) {
            addedNodes.push(editedNodes[id])
          } else {
            const before = baseNodes[id]
            const after = editedNodes[id]
            const updates: Partial<C4Node> = {}
            for (const k of ['label', 'description', 'technology', 'type', 'parentId', 'external', 'x', 'y', 'width', 'height', 'collapsed'] as const) {
              if ((before as any)[k] !== (after as any)[k]) (updates as any)[k] = (after as any)[k]
            }
            if (Object.keys(updates).length > 0) updatedNodes.push({ id, updates })
          }
        }
        for (const id of Object.keys(baseNodes)) {
          if (!editedNodes[id]) removedNodeIds.push(id)
        }

        const addedRels: C4Relation[] = []
        const updatedRels: { id: string; updates: Partial<C4Relation> }[] = []
        const removedRelIds: string[] = []
        for (const id of Object.keys(editedRels)) {
          if (!baseRels[id]) {
            addedRels.push(editedRels[id])
          } else {
            const before = baseRels[id]
            const after = editedRels[id]
            const updates: Partial<C4Relation> = {}
            for (const k of ['sourceId', 'targetId', 'label', 'technology'] as const) {
              if ((before as any)[k] !== (after as any)[k]) (updates as any)[k] = (after as any)[k]
            }
            if (Object.keys(updates).length > 0) updatedRels.push({ id, updates })
          }
        }
        for (const id of Object.keys(baseRels)) {
          if (!editedRels[id]) removedRelIds.push(id)
        }

        // Sequence diff for propagation.
        const addedSeqs: DiagramSequence[] = []
        const updatedSeqs: { id: string; seq: DiagramSequence }[] = []
        const removedSeqIds: string[] = []
        for (const id of Object.keys(editedSeqs)) {
          if (!baseSeqs[id]) {
            addedSeqs.push(editedSeqs[id])
          } else if (JSON.stringify(editedSeqs[id]) !== JSON.stringify(baseSeqs[id])) {
            updatedSeqs.push({ id, seq: editedSeqs[id] })
          }
        }
        for (const id of Object.keys(baseSeqs)) {
          if (!editedSeqs[id]) removedSeqIds.push(id)
        }

        // Apply diff to active milestone + every later milestone + live HEAD backup.
        const applyDiff = (
          targetNodes: Record<string, C4Node>,
          targetRels: Record<string, C4Relation>,
          targetSeqs: Record<string, DiagramSequence>,
        ) => {
          for (const n of addedNodes) targetNodes[n.id] = JSON.parse(JSON.stringify(n))
          for (const { id, updates } of updatedNodes) {
            if (targetNodes[id]) Object.assign(targetNodes[id], updates)
          }
          for (const id of removedNodeIds) delete targetNodes[id]
          for (const r of addedRels) targetRels[r.id] = JSON.parse(JSON.stringify(r))
          for (const { id, updates } of updatedRels) {
            if (targetRels[id]) Object.assign(targetRels[id], updates)
          }
          for (const id of removedRelIds) delete targetRels[id]
          for (const seq of addedSeqs) targetSeqs[seq.id] = JSON.parse(JSON.stringify(seq))
          for (const { id, seq } of updatedSeqs) targetSeqs[id] = JSON.parse(JSON.stringify(seq))
          for (const id of removedSeqIds) delete targetSeqs[id]
        }

        set((state) => {
          // Apply to active milestone (overwrite to be exact) and to all later milestones (diff).
          for (let i = idx; i < state.snapshots.length; i++) {
            const snap = state.snapshots[i] as any
            if (i === idx) {
              snap.nodes = JSON.parse(JSON.stringify(editedNodes))
              snap.relations = JSON.parse(JSON.stringify(editedRels))
              snap.sequences = JSON.parse(JSON.stringify(editedSeqs))
            } else {
              if (!snap.sequences) snap.sequences = {}
              applyDiff(snap.nodes, snap.relations, snap.sequences)
            }
          }
          // Apply to the live HEAD backup so it picks up future-facing changes too,
          // but DO NOT swap the canvas to live HEAD — keep showing the milestone the
          // user just edited (otherwise the canvas appears to "jump back" to current).
          if (state.liveBackup) {
            if (!(state.liveBackup as any).sequences) (state.liveBackup as any).sequences = {}
            applyDiff(state.liveBackup.nodes as any, state.liveBackup.relations as any, (state.liveBackup as any).sequences)
          }
          state.milestoneDirty = false
          state.milestonePromptOpen = false
          // Keep activeSnapshotId + liveBackup so user can still discard / switch later.
        })
        get()._sync()
        _liveLayout?.reset()
      },

      setDiffHighlight(diff) {
        set((state) => { state.diffHighlight = diff as any })
      },

      toggleShowDiff() {
        set((state) => { state.showDiff = !state.showDiff })
        get()._sync()
      },

      /** Set (or clear) the milestone used as the diff base. Pass `null` to
       *  return to the auto pick (the milestone immediately before the
       *  active one). Recomputes `diffHighlight` and ghost overlays. */
      setDiffBase(id) {
        const { activeSnapshotId, snapshots, c4Nodes, c4Relations, liveBackup } = get()
        if (!activeSnapshotId) return
        const idx = snapshots.findIndex(s => s.id === activeSnapshotId)
        if (idx < 0) return
        // Resolve effective base: explicit id > previous milestone.
        // For the very first/oldest milestone (idx === 0) there is no
        // previous one — it is itself the baseline, so we clear the diff
        // overlay instead of diffing against the live HEAD (which would
        // misleadingly highlight everything that has been edited since).
        let baseNodes: Record<string, C4Node>
        let baseRels: Record<string, C4Relation>
        let resolvedBaseId: string | null = null
        if (id) {
          const baseSnap = snapshots.find(s => s.id === id)
          if (!baseSnap) return
          baseNodes = baseSnap.nodes as Record<string, C4Node>
          baseRels = baseSnap.relations as Record<string, C4Relation>
          resolvedBaseId = id
        } else if (idx > 0) {
          const prev = snapshots[idx - 1]
          baseNodes = prev.nodes as Record<string, C4Node>
          baseRels = prev.relations as Record<string, C4Relation>
          resolvedBaseId = prev.id
        } else {
          // First milestone (or no base available) — clear overlays.
          set((state) => {
            state.diffHighlight = {} as any
            state.diffBaseSnapshotId = null
            state.diffGhostNodes = {} as any
            state.diffGhostRelations = {} as any
          })
          get()._sync()
          return
        }
        void liveBackup
        const diff = computeSnapDiff(baseNodes, c4Nodes as Record<string, C4Node>, baseRels, c4Relations as Record<string, C4Relation>)
        // Augment with sequence membership changes.
        const baseSnap2 = snapshots.find(s => s.id === resolvedBaseId)
        if (baseSnap2) {
          const seqDiff = computeSeqDiff(
            baseSnap2.sequences as Record<string, DiagramSequence> | undefined,
            get().sequences,
          )
          for (const [rid, action] of Object.entries(seqDiff)) {
            if (!diff[rid]) diff[rid] = action
          }
        }
        const ghosts = computeDiffGhosts(baseNodes, c4Nodes as Record<string, C4Node>, baseRels, c4Relations as Record<string, C4Relation>)
        set((state) => {
          state.diffHighlight = diff as any
          state.diffBaseSnapshotId = resolvedBaseId
          state.diffGhostNodes = ghosts.nodes as any
          state.diffGhostRelations = ghosts.relations as any
        })
        get()._sync()
      },

      // ── Notifications (toasts) ─────────────────────────────────────
      pushNotification(message, severity = 'error') {
        const id = uid()
        set((state) => {
          state.notifications.push({ id, severity, message, ts: Date.now() })
        })
        // Auto-dismiss is handled by the toast component (so it can pause
        // on hover and play a leave animation before removal).
      },

      dismissNotification(id) {
        set((state) => {
          state.notifications = state.notifications.filter(n => n.id !== id)
        })
      },

      // ── App mode ─────────────────────────────────────────────────────
      setAppMode(mode) {
        // Skip if mode hasn't actually changed — avoids needless physics
        // restarts that visibly fight an active auto-fit loop.
        const prevMode = get().appMode
        if (prevMode === mode) return
        if (get().presentationActive) {
          // stopPresentation will restore __prePresState; let it run first
          // so the layout snapshot we take below is the user's true layout,
          // not whatever slide was being shown.
          get().stopPresentation()
        }
        // Snapshot positions whenever we leave designer so any
        // viewer/presenter side-effects (slide playback, future readers)
        // can't perturb the saved layout. Restore on the way back.
        //
        // We snapshot c4Nodes AND every view.positions / defaultPositions
        // because the auto-persist subscriber writes currentPos into the
        // active view's `positions` on every save — so even though cola is
        // stopped in read-only modes, a save tick during the read-only
        // window could capture mid-frame coordinates and overwrite the
        // user's curated view layout. Restoring the maps as a whole guards
        // against that and keeps named views as stable as the "All
        // elements" view (which writes to defaultPositions instead).
        const W = window as any
        if (prevMode === 'designer' && mode !== 'designer') {
          W.__preModeLayout = {
            c4Nodes: JSON.parse(JSON.stringify(get().c4Nodes)),
            c4Relations: JSON.parse(JSON.stringify(get().c4Relations)),
            views: JSON.parse(JSON.stringify(get().views)),
            defaultPositions: JSON.parse(JSON.stringify(get().defaultPositions)),
            activeViewId: get().activeViewId,
          }
        } else if (prevMode !== 'designer' && mode === 'designer' && W.__preModeLayout) {
          const pre = W.__preModeLayout as {
            c4Nodes: Record<string, C4Node>
            c4Relations: Record<string, C4Relation>
            views: Record<string, DiagramView>
            defaultPositions: Record<string, NodePosition>
            activeViewId: string | null
          }
          set((state) => {
            state.c4Nodes = pre.c4Nodes as any
            state.c4Relations = pre.c4Relations as any
            state.views = pre.views as any
            state.defaultPositions = pre.defaultPositions as any
            state.activeViewId = pre.activeViewId
          })
          W.__preModeLayout = undefined
          // Physics kept running during viewer (explore mode), so cola's
          // internal cache reflects the explored positions — *not* the
          // snapshot we just restored. reset() drops that cache so the
          // next start() rebuilds against the restored c4Nodes.
          _liveLayout?.reset()
        }
        // Physics runs in *both* designer and viewer. In viewer the user
        // can drag/collapse to explore — mutations are sandboxed by the
        // snapshot above (restored on return) and by the auto-persist
        // subscriber gating writes on appMode === 'designer'. We stop it
        // only in metamodel mode where the canvas isn't shown.
        if (mode === 'metamodel') {
          get().stopLiveLayout()
        } else {
          get().startLiveLayout()
        }
        set((state) => { state.appMode = mode as any })
        // Rebuild rfNodes so per-node draggable/selectable flags reflect
        // the new mode (designer = editable, viewer/presenter = locked).
        get()._sync()
      },

      // ── Metamodel ──────────────────────────────────────────────────────
      setMetamodel(m) {
        set((state) => { state.metamodel = m as any })
      },
      resetMetamodelToC4() {
        set((state) => { state.metamodel = builtInC4Metamodel() as any })
      },
      upsertNodeType(def) {
        set((state) => {
          (state.metamodel as Metamodel).nodeTypes[def.id] = def
        })
      },
      removeNodeType(id) {
        set((state) => {
          const mm = state.metamodel as Metamodel
          if (mm.nodeTypes[id]?.builtin) return
          delete mm.nodeTypes[id]
        })
      },
      upsertRelationType(def) {
        set((state) => {
          (state.metamodel as Metamodel).relationTypes[def.id] = def
        })
      },
      removeRelationType(id) {
        set((state) => {
          const mm = state.metamodel as Metamodel
          if (mm.relationTypes[id]?.builtin) return
          delete mm.relationTypes[id]
        })
      },

      // ── Presentation mode ──────────────────────────────────────────────
      addPresentation(name) {
        const id = uid()
        const presName = name ?? `Presentation ${get().presentations.length + 1}`
        set((state) => {
          state.presentations.push({ id, name: presName, slides: [] })
          state.activePresentationId = id
          state.presentationSlides = state.presentations[state.presentations.length - 1].slides
          state.presentationSlideIndex = 0
        })
        return id
      },

      removePresentation(id) {
        set((state) => {
          state.presentations = state.presentations.filter(p => p.id !== id)
          // Always keep at least one presentation
          if (state.presentations.length === 0) {
            const newId = uid()
            state.presentations.push({ id: newId, name: 'Presentation 1', slides: [] })
            state.activePresentationId = newId
          } else if (state.activePresentationId === id) {
            state.activePresentationId = state.presentations[0].id
          }
          const active = state.presentations.find(p => p.id === state.activePresentationId)!
          state.presentationSlides = active.slides
          state.presentationSlideIndex = 0
        })
      },

      renamePresentation(id, name) {
        set((state) => {
          const p = state.presentations.find(p => p.id === id)
          if (p) p.name = name
        })
      },

      setActivePresentation(id) {
        set((state) => {
          const p = state.presentations.find(p => p.id === id)
          if (!p) return
          state.activePresentationId = id
          state.presentationSlides = p.slides
          state.presentationSlideIndex = 0
        })
      },

      addPresentationSlide(name) {
        const raw = (window as any).__rfCurrentViewport
        const viewport: { x: number; y: number; zoom: number } = raw
          ? { x: raw.x, y: raw.y, zoom: raw.zoom }
          : (_getViewportFn()?.() ?? { x: 0, y: 0, zoom: 1 })
        const { presentationSlides, activeSnapshotId, activeViewId } = get()
        const canvasState = captureCanvasState(get().c4Nodes as Record<string, C4Node>)
        // Inline full model snapshot — guarantees the slide replays exactly
        // what was on screen at creation time, even if the user later edits
        // nodes/relations or switches the active milestone.
        const modelSnapshot = {
          nodes: JSON.parse(JSON.stringify(get().c4Nodes)) as Record<string, C4Node>,
          relations: JSON.parse(JSON.stringify(get().c4Relations)) as Record<string, C4Relation>,
        }
        const id = uid()
        const slideName = name ?? `Slide ${presentationSlides.length + 1}`
        set((state) => {
          const pres = state.presentations.find(p => p.id === state.activePresentationId)
          if (!pres) return
          pres.slides.push({ id, name: slideName, snapshotId: activeSnapshotId, viewId: activeViewId, viewport, canvasState, modelSnapshot } as any)
          state.presentationSlides = pres.slides
        })
      },

      removePresentationSlide(id) {
        set((state) => {
          const pres = state.presentations.find(p => p.id === state.activePresentationId)
          if (!pres) return
          pres.slides = pres.slides.filter(s => s.id !== id)
          state.presentationSlides = pres.slides
          if (state.presentationSlideIndex >= pres.slides.length) {
            state.presentationSlideIndex = Math.max(0, pres.slides.length - 1)
          }
        })
      },

      renamePresentationSlide(id, name) {
        set((state) => {
          const pres = state.presentations.find(p => p.id === state.activePresentationId)
          if (!pres) return
          const slide = pres.slides.find(s => s.id === id)
          if (slide) slide.name = name
          state.presentationSlides = pres.slides
        })
      },

      updatePresentationSlideViewport(id, vp) {
        set((state) => {
          const pres = state.presentations.find(p => p.id === state.activePresentationId)
          if (!pres) return
          const slide = pres.slides.find(s => s.id === id)
          if (slide) slide.viewport = vp
          state.presentationSlides = pres.slides
        })
      },

      startPresentation() {
        const { presentationSlides } = get()
        if (presentationSlides.length === 0) return
        get().stopLiveLayout()
        // Snapshot full model + active view so we can restore on exit.
        // (goToSlide replaces c4Nodes/c4Relations from a slide snapshot,
        // so restoring just positions wouldn't be enough.)
        ;(window as any).__prePresState = {
          c4Nodes: JSON.parse(JSON.stringify(get().c4Nodes)),
          c4Relations: JSON.parse(JSON.stringify(get().c4Relations)),
          activeViewId: get().activeViewId,
        }
        set((state) => { state.presentationActive = true })
        // Re-derive rfNodes immediately so the per-node `draggable` flag
        // flips off before the user can grab anything (rfNodes carry
        // draggable per-node, which would otherwise override the
        // ReactFlow nodesDraggable prop until the next _sync).
        get()._sync()
        setTimeout(() => get().goToSlide(get().presentationSlideIndex), 50)
      },

      stopPresentation() {
        set((state) => { state.presentationActive = false })
        get().setDiffHighlight({})
        const pre = (window as any).__prePresState as
          | { c4Nodes: Record<string, C4Node>; c4Relations: Record<string, C4Relation>; activeViewId: string | null }
          | undefined
        if (pre) {
          set((state) => {
            state.c4Nodes = pre.c4Nodes as any
            state.c4Relations = pre.c4Relations as any
            state.activeViewId = pre.activeViewId
          })
          ;(window as any).__prePresState = undefined
        }
        get()._sync()
        // Resume live layout when returning to any non-metamodel mode
        // (designer or viewer). Reset the cola cache so it picks up the
        // restored c4Nodes positions instead of the slide-shown ones.
        if (get().appMode !== 'metamodel') {
          _liveLayout?.reset()
          get().startLiveLayout()
        }
      },

      goToSlide(index) {
        const { presentationSlides } = get()
        if (!presentationSlides.length) return
        const i = Math.max(0, Math.min(index, presentationSlides.length - 1))
        const slide = presentationSlides[i]
        const targetViewId = (slide as any).viewId ?? null
        set((state) => { state.presentationSlideIndex = i })

        // Disable physics while presenting
        get().stopLiveLayout()

        // Restore inline model snapshot first (preferred — captured at
        // slide-creation time so it always reflects what was on screen).
        // Fall back to the linked milestone snapshot for legacy slides.
        const inline = (slide as any).modelSnapshot as
          | { nodes: Record<string, C4Node>; relations: Record<string, C4Relation> }
          | undefined
        if (inline) {
          set((state) => {
            state.c4Nodes = JSON.parse(JSON.stringify(inline.nodes)) as any
            state.c4Relations = JSON.parse(JSON.stringify(inline.relations)) as any
          })
        } else if (slide.snapshotId) {
          const snap = get().snapshots.find(s => s.id === slide.snapshotId)
          if (snap) {
            set((state) => {
              state.c4Nodes = JSON.parse(JSON.stringify(snap.nodes)) as any
              state.c4Relations = JSON.parse(JSON.stringify(snap.relations)) as any
            })
          }
        }

        // Apply saved canvas state (positions + collapsed) — overrides snapshot positions
        if (slide.canvasState) {
          set((state) => {
            for (const [id, ns] of Object.entries(slide.canvasState!.nodes)) {
              const n = state.c4Nodes[id]
              if (!n) continue
              n.x = ns.x; n.y = ns.y
              n.width = ns.width; n.height = ns.height
              n.collapsed = ns.collapsed
            }
          })
        }

        // Activate the view linked to this slide (or reset to "all" if none)
        const currentViewId = get().activeViewId
        if (targetViewId !== currentViewId) {
          set((state) => { state.activeViewId = targetViewId })
        }

        // Re-derive rfNodes / rfEdges (always needed: view filter or canvas state may have changed)
        get()._sync()

        // Compute diff highlight between previous and current slide snapshots.
        // Prefer the inline modelSnapshot (always present on new slides);
        // fall back to the legacy linked milestone snapshot.
        {
          const prevSlide = i > 0 ? presentationSlides[i - 1] : null
          const slideModel = (s: typeof slide | null | undefined) => {
            if (!s) return null
            const inline = (s as any).modelSnapshot as
              | { nodes: Record<string, C4Node>; relations: Record<string, C4Relation> }
              | undefined
            if (inline) return inline
            if (s.snapshotId) {
              const snap = get().snapshots.find(x => x.id === s.snapshotId)
              if (snap) return { nodes: snap.nodes as Record<string, C4Node>, relations: snap.relations as Record<string, C4Relation> }
            }
            return null
          }
          const currModel = slideModel(slide)
          const prevModel = slideModel(prevSlide as any)
          if (currModel && prevModel) {
            get().setDiffHighlight(computeSnapDiff(prevModel.nodes, currModel.nodes, prevModel.relations, currModel.relations))
          } else {
            get().setDiffHighlight({})
          }
        }

        // Animate viewport transition — defer to next frame so React re-render
        // finishes first. We replay the per-slide captured {x,y,zoom} so the
        // user has full control over framing (capture viewport on the slide
        // sets it; "Capture viewport" button updates it). If a slide has no
        // captured viewport at all (legacy data), fall back to fitView.
        const vp = slide.viewport
        if (vp && (vp.zoom || vp.x || vp.y)) {
          requestAnimationFrame(() => _setViewportFn()?.(
            { x: vp.x, y: vp.y, zoom: vp.zoom },
            { duration: 600 },
          ))
        } else {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => _getFitViewFn()?.())
          })
        }
      },

      previewSlide(index) {
        const { presentationSlides } = get()
        if (!presentationSlides.length) return
        const i = Math.max(0, Math.min(index, presentationSlides.length - 1))
        const slide = presentationSlides[i]
        set((state) => { state.presentationSlideIndex = i })

        // Restore inline model snapshot (preferred) or linked milestone snapshot.
        const inline = (slide as any).modelSnapshot as
          | { nodes: Record<string, C4Node>; relations: Record<string, C4Relation> }
          | undefined
        if (inline) {
          set((state) => {
            state.c4Nodes = JSON.parse(JSON.stringify(inline.nodes)) as any
            state.c4Relations = JSON.parse(JSON.stringify(inline.relations)) as any
          })
        } else if (slide.snapshotId) {
          const snap = get().snapshots.find(s => s.id === slide.snapshotId)
          if (snap) {
            set((state) => {
              state.c4Nodes = JSON.parse(JSON.stringify(snap.nodes)) as any
              state.c4Relations = JSON.parse(JSON.stringify(snap.relations)) as any
            })
          }
        }

        // Apply saved canvas state (positions + collapsed).
        if (slide.canvasState) {
          set((state) => {
            for (const [id, ns] of Object.entries(slide.canvasState!.nodes)) {
              const n = state.c4Nodes[id]
              if (!n) continue
              n.x = ns.x; n.y = ns.y
              n.width = ns.width; n.height = ns.height
              n.collapsed = ns.collapsed
            }
          })
        }

        // Navigate to the view linked to this slide (or reset to "all" if none).
        const targetViewId = (slide as any).viewId ?? null
        if (targetViewId !== get().activeViewId) {
          set((state) => { state.activeViewId = targetViewId })
        }

        // Re-derive rfNodes / rfEdges.
        get()._sync()

        // Restore saved viewport, or fit view if none captured.
        const vp = slide.viewport
        if (vp && (vp.zoom || vp.x || vp.y)) {
          requestAnimationFrame(() => _setViewportFn()?.(
            { x: vp.x, y: vp.y, zoom: vp.zoom },
            { duration: 400 },
          ))
        } else {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => _getFitViewFn()?.())
          })
        }
      },

      setViewportFns(getVP, setVP) {
        ;(window as any).__rfGetViewport = getVP
        ;(window as any).__rfSetViewport = setVP
      },

      captureSlideViewport(id: string) {
        const raw = (window as any).__rfCurrentViewport
        const vp: { x: number; y: number; zoom: number } | null = raw
          ? { x: raw.x, y: raw.y, zoom: raw.zoom }
          : (_getViewportFn()?.() ?? null)
        if (!vp) return
        const canvasState = captureCanvasState(get().c4Nodes as Record<string, C4Node>)
        const currentViewId = get().activeViewId
        // Re-capture the full inline model snapshot too — "Capture viewport"
        // semantically means "this slide should look like the screen does now".
        const modelSnapshot = {
          nodes: JSON.parse(JSON.stringify(get().c4Nodes)) as Record<string, C4Node>,
          relations: JSON.parse(JSON.stringify(get().c4Relations)) as Record<string, C4Relation>,
        }
        set((state) => {
          const pres = state.presentations.find(p => p.id === state.activePresentationId)
          if (!pres) return
          const slide = pres.slides.find(s => s.id === id)
          if (slide) {
            slide.viewport = vp
            ;(slide as any).canvasState = canvasState
            ;(slide as any).viewId = currentViewId
            ;(slide as any).modelSnapshot = modelSnapshot
          }
          state.presentationSlides = pres.slides
        })
      },

      linkSnapshotToSlide(slideId: string, snapshotId: string | null) {
        set((state) => {
          const pres = state.presentations.find(p => p.id === state.activePresentationId)
          if (!pres) return
          const slide = pres.slides.find(s => s.id === slideId)
          if (slide) slide.snapshotId = snapshotId
          state.presentationSlides = pres.slides
        })
      },

      linkViewToSlide(slideId: string, viewId: string | null) {
        set((state) => {
          const pres = state.presentations.find(p => p.id === state.activePresentationId)
          if (!pres) return
          const slide = pres.slides.find(s => s.id === slideId)
          if (slide) (slide as any).viewId = viewId
          state.presentationSlides = pres.slides
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
        const sequences: Record<string, DiagramSequence> = {}
        for (const n of data.nodes) nodes[n.id] = n
        for (const r of data.relations) relations[r.id] = r
        if (data.views) for (const v of data.views) views[v.id] = v
        if (data.sequences) for (const s of data.sequences) sequences[s.id] = s

        // Restore snapshots (backward compat: old files won't have them)
        const snapshots: DiagramSnapshot[] = data.snapshots ?? []
        const presInit = buildPresentationsFromData(data.presentations, data.presentationSlides)

        // Restore per-view positions (backward compat: old files won't have them)
        const defaultPos = data.defaultPositions ?? snapshotPositions(nodes)
        const defaultVP: { x: number; y: number; zoom: number } | null = data.defaultViewport ?? null

        set((state) => {
          state.c4Nodes = nodes as any
          state.c4Relations = relations as any
          state.sequences = sequences as any
          state.activeSequenceId = null
          state.views = views as any
          state.defaultPositions = defaultPos as any
          state.defaultViewport = defaultVP
          state.activeViewId = null
          state.selectedNodeId = null
          state.selectedEdgeId = null
          state.canUndo = false
          state.canRedo = false
          state.snapshots = snapshots as any
          state.activeSnapshotId = null
          state.presentations = presInit.presentations as any
          state.activePresentationId = presInit.activeId
          state.presentationSlides = presInit.presentations[0].slides as any
          state.presentationActive = false
          state.presentationSlideIndex = 0
          state.metamodel = ((): any => {
            const dm = data.metamodel
            if (!dm) return builtInC4Metamodel()
            if (dm.id === 'c4-builtin') return builtInC4Metamodel()
            if (dm.id === 'c4-ddd-builtin') return builtInDddC4Metamodel()
            return dm
          })()
        })
        get()._sync()
        // skipBulk=true: loaded positions are already correct; the 110-iteration
        // cola bulk phase would immediately rearrange and overwrite them.
        get().startLiveLayout({ skipBulk: true })
        // Apply restored camera (loaded as activeViewId=null → default view).
        if (defaultVP) {
          requestAnimationFrame(() => {
            const setVP = (window as any).__rfSetViewport as
              | ((vp: { x: number; y: number; zoom: number }, opts?: { duration?: number }) => void)
              | null
            setVP?.(defaultVP, { duration: 0 })
          })
        }
      },

      saveDiagram() {
        const { c4Nodes, c4Relations, sequences, views, activeViewId, defaultPositions, defaultViewport, snapshots, presentations, metamodel } = get()

        // Snapshot current positions into the active context before saving
        const currentPos = snapshotPositions(c4Nodes)
        const savedDefaultPos = activeViewId === null ? currentPos : defaultPositions
        // Same for camera state so on reload each view restores its framing.
        const rawVP = (window as any).__rfCurrentViewport
        const currentVP: { x: number; y: number; zoom: number } | null = rawVP
          ? { x: rawVP.x, y: rawVP.y, zoom: rawVP.zoom }
          : null
        const savedDefaultVP = activeViewId === null ? (currentVP ?? defaultViewport) : defaultViewport
        const savedViews = Object.values(views).map(v => ({
          ...v,
          positions: v.id === activeViewId ? currentPos : v.positions,
          viewport: v.id === activeViewId ? (currentVP ?? v.viewport) : v.viewport,
        }))

        return {
          nodes: Object.values(c4Nodes),
          relations: Object.values(c4Relations),
          sequences: Object.values(sequences),
          views: savedViews,
          defaultPositions: savedDefaultPos,
          defaultViewport: savedDefaultVP,
          snapshots: snapshots as DiagramSnapshot[],
          presentations: presentations as Presentation[],
          metamodel: metamodel as Metamodel,
        }
      },

      resetDiagram() {
        get().stopLiveLayout()
        _undoStack.length = 0
        _redoStack.length = 0
        const sample = buildSampleDiagram()
        const presInit = buildPresentationsFromData(undefined, [])
        set((state) => {
          state.c4Nodes = sample.nodes as any
          state.c4Relations = sample.relations as any
          state.sequences = {} as any
          state.activeSequenceId = null
          state.views = {} as any
          state.activeViewId = null
          state.defaultPositions = snapshotPositions(sample.nodes) as any
          state.selectedNodeId = null
          state.selectedEdgeId = null
          state.canUndo = false
          state.canRedo = false
          state.snapshots = sample.snapshots as any
          state.activeSnapshotId = null
          state.diffHighlight = {} as any
          state.diffBaseSnapshotId = null
          state.diffGhostNodes = {} as any
          state.diffGhostRelations = {} as any
          state.presentations = presInit.presentations as any
          state.activePresentationId = presInit.activeId
          state.presentationSlides = presInit.presentations[0].slides as any
          state.presentationActive = false
          state.presentationSlideIndex = 0
          state.metamodel = builtInC4Metamodel() as any
        })
        get()._sync()
        get().startLiveLayout()
      },

      newDiagram() {
        get().stopLiveLayout()
        _undoStack.length = 0
        _redoStack.length = 0
        const presInit = buildPresentationsFromData(undefined, [])
        set((state) => {
          state.c4Nodes = {}
          state.c4Relations = {}
          state.sequences = {} as any
          state.activeSequenceId = null
          state.views = {} as any
          state.activeViewId = null
          state.defaultPositions = {} as any
          state.selectedNodeId = null
          state.selectedEdgeId = null
          state.canUndo = false
          state.canRedo = false
          state.snapshots = [] as any
          state.activeSnapshotId = null
          state.presentations = presInit.presentations as any
          state.activePresentationId = presInit.activeId
          state.presentationSlides = presInit.presentations[0].slides as any
          state.presentationActive = false
          state.presentationSlideIndex = 0
          state.metamodel = builtInC4Metamodel() as any
        })
        get()._sync()
        get().startLiveLayout()
      },

      // ── viewport ────────────────────────────────────────────────────────
      setFitViewFn(fn, instantFn) {
        _setFitViewFnRef(fn)
        _setFitViewInstantFnRef(instantFn ?? fn)
        // If autofit is currently on (e.g. survived HMR or appMode switch), the
        // running interval might be referencing a dead closure from the previous
        // ReactFlow instance. Restart it cleanly with the new fns.
        if (get().autoFitActive) {
          const stale = _getAutoFitTimer()
          if (stale !== null) {
            clearInterval(stale)
            _setAutoFitTimer(null)
          }
          if (fn) {
            // Animated re-fit so the user sees that autofit is still alive.
            fn()
            const t = setInterval(() => {
              if (!get().autoFitActive) { clearInterval(t); _setAutoFitTimer(null); return }
              if (get().presentationActive) return
              _getFitViewInstantFn()?.()
            }, 300)
            _setAutoFitTimer(t)
          }
        } else {
          // HMR cleanup: drop any orphan timer left behind.
          const stale = _getAutoFitTimer()
          if (stale !== null) {
            clearInterval(stale)
            _setAutoFitTimer(null)
          }
        }
      },
      fitAll() {
        // Sequence view (dynamic) has its own fit registered via __radicalSeqFitFn.
        const activeView = get().activeViewId ? get().views[get().activeViewId!] : null
        if (activeView?.kind === 'dynamic') {
          ;(window as any).__radicalSeqFitFn?.()
          return
        }
        // Explicit one-shot fit-all: use the *animated* (force) fn so the
        // user always sees the camera move, even if smart-fit decided
        // nothing changed since the last tick.
        _getFitViewFn()?.()
      },
      zoomIn() {
        ;(window as any).__radicalZoomIn?.()
      },
      zoomOut() {
        ;(window as any).__radicalZoomOut?.()
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
          _getFitViewFn()?.()  // start immediately (animated)
          const t = setInterval(() => {
            if (!get().autoFitActive) { clearInterval(t); _setAutoFitTimer(null); return }
            // Don't fight with slide viewport transitions during playback
            if (get().presentationActive) return
            _getFitViewInstantFn()?.()  // instant snap — no animation fighting physics
          }, 300)
          _setAutoFitTimer(t)
        }
      },
    }
  })
)

// Auto-start live cola layout (skip in test/SSR environments)
if (typeof requestAnimationFrame !== 'undefined') {
  // Pass skipBulk=true when the store was initialised from localStorage so
  // cola's 110-iteration synchronous bulk phase doesn't immediately
  // overwrite the persisted positions.
  useDiagramStore.getState().startLiveLayout({ skipBulk: _initLoadedFromDisk })
}

// ─── Auto-persist to the active document ────────────────────────────────────
// Subscribe to model slices and debounce-save into whatever the current
// active document is (LS or FS, resolved fresh on every flush).
if (typeof window !== 'undefined') {
  let _persistTimer: ReturnType<typeof setTimeout> | null = null
  let _suspended = false
  const flushPersist = async (): Promise<void> => {
    if (_suspended) return
    const activeId = documents.getActiveId()
    if (!activeId) return
    try {
      const data = useDiagramStore.getState().saveDiagram()
      await documents.saveDocument(activeId, data)
    } catch (e) {
      console.warn('[diagramStore] persist failed:', e)
    }
  }
  const schedulePersist = (): void => {
    if (_persistTimer !== null) clearTimeout(_persistTimer)
    _persistTimer = setTimeout(() => {
      _persistTimer = null
      void flushPersist()
    }, 400)
  }

  let prev = useDiagramStore.getState()
  useDiagramStore.subscribe((s) => {
    // In viewer/presenter ("explore" mode), drags / collapses mutate the
    // model temporarily but must NEVER reach disk. The setAppMode snapshot
    // restores everything on the way back to designer, so by simply not
    // scheduling a persist while we're outside designer, the explore
    // session stays fully ephemeral.
    const isExploreMode = s.appMode !== 'designer' && s.appMode !== 'metamodel'
    if (
      !isExploreMode && (
        s.c4Nodes !== prev.c4Nodes ||
        s.c4Relations !== prev.c4Relations ||
        s.sequences !== prev.sequences ||
        s.views !== prev.views ||
        s.defaultPositions !== prev.defaultPositions ||
        s.defaultViewport !== prev.defaultViewport ||
        s.snapshots !== prev.snapshots ||
        s.presentations !== prev.presentations ||
        s.metamodel !== prev.metamodel
      )
    ) {
      prev = s
      schedulePersist()
    } else {
      prev = s
    }
  })

  // ── Hydrate FS-backed active doc on boot ─────────────────────────────────
  // We rendered the sample synchronously above; if the active doc is FS,
  // load the file now and replace the in-memory model. We suspend the
  // auto-persist while doing this so the "sample → loaded" replacement
  // doesn't overwrite the file with stale data.
  const activeId = documents.getActiveId()
  if (activeId) {
    const meta = documents.listDocuments().find(d => d.id === activeId)
    if (meta?.source === 'fs') {
      _suspended = true
      documents.loadDocument(activeId).then((data) => {
        if (data) useDiagramStore.getState().loadDiagram(data)
      }).catch((e) => console.warn('[diagramStore] FS hydrate failed:', e))
        .finally(() => { _suspended = false })
    }
  }

  // ── React to active-document switches ────────────────────────────────────
  // When the user picks a different document in the manager modal, load it.
  let prevActive = documents.getActiveId()
  useDocumentsStore.subscribe((s) => {
    if (s.activeId === prevActive) return
    prevActive = s.activeId
    if (!s.activeId) return
    _suspended = true
    documents.loadDocument(s.activeId).then((data) => {
      if (data) useDiagramStore.getState().loadDiagram(data)
    }).catch((e) => console.warn('[diagramStore] switch-doc load failed:', e))
      .finally(() => { _suspended = false })
  })

  // Expose hooks for other modules / future use.
  ;(window as any).__radicalFlushPersist = flushPersist

  // ── Synchronous flush on tab close / reload / hide ───────────────────────
  // LocalStorage writes are synchronous, so we can safely persist pending
  // changes during pagehide / visibilitychange. This prevents a quick
  // reload (within the 400 ms debounce) from losing the most recent edit
  // (e.g. a freshly-applied smart layout).
  const flushSync = (): void => {
    if (_suspended) return
    if (_persistTimer === null) return // nothing pending
    clearTimeout(_persistTimer)
    _persistTimer = null
    const activeId = documents.getActiveId()
    if (!activeId) return
    const meta = documents.listDocuments().find(d => d.id === activeId)
    // FS writes go through async electronAPI and won't reliably complete
    // on pagehide; LS writes are synchronous and always make it to disk.
    if (meta?.source !== 'ls') {
      // Best effort — fire-and-forget. Pending FS save may still complete
      // if the unload races slowly enough; if not, the user will see the
      // pre-edit state next time.
      void flushPersist()
      return
    }
    try {
      const data = useDiagramStore.getState().saveDiagram()
      void documents.saveDocument(activeId, data)
    } catch (e) {
      console.warn('[diagramStore] sync flush failed:', e)
    }
  }
  if (typeof window.addEventListener === 'function') {
    window.addEventListener('pagehide', flushSync)
    window.addEventListener('beforeunload', flushSync)
  }
  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flushSync()
    })
  }

  // ── CLI-specified watched file ────────────────────────────────────────────
  // When Radical.Tools is launched with --file /path/to/model.c4.json (or the
  // RADICAL_FILE env var), Electron's main process watches the file and pushes
  // a 'file:external-change' IPC message whenever it changes on disk.
  //
  //   1. On boot: ensure the file is registered as an FS-backed doc and
  //      activate it. The existing switch-doc subscriber (above) will load it.
  //   2. On external change: suspend auto-persist, reload the model from the
  //      new content, then re-enable persist. This lets the user edit the file
  //      in any external editor and see changes reflected in real-time.
  //
  // Writing back from the app is handled by the existing auto-persist path
  // (saveDocument → file:write IPC), which already targets FS-backed docs.
  if (window.electronAPI?.getWatchedPath) {
    void window.electronAPI.getWatchedPath().then((watchedPath) => {
      if (!watchedPath) return
      const meta = documents.createFSDocument(watchedPath)
      // Activate (triggers the switch-doc subscriber above → loads the file).
      documents.setActiveId(meta.id)
    })
  }

  if (window.electronAPI?.onFileChanged) {
    window.electronAPI.onFileChanged(({ content }) => {
      _suspended = true
      try {
        const data = JSON.parse(content) as DiagramData
        useDiagramStore.getState().loadDiagram(data)
      } catch (e) {
        console.warn('[diagramStore] external file change — invalid JSON, ignored:', e)
      } finally {
        // Brief delay so the store's _sync() and React render cycle can
        // complete before auto-persist is re-enabled.
        setTimeout(() => { _suspended = false }, 300)
      }
    })
  }
}
