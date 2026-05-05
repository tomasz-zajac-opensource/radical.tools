import React, { useCallback, useRef, useEffect, useState, useMemo } from 'react'
import ReactFlow, {
  Background,
  BackgroundVariant,
  Controls,
  NodeTypes,
  EdgeTypes,
  NodeMouseHandler,
  ReactFlowInstance,
  useViewport,
  getNodesBounds,
  getViewportForBounds,
} from 'reactflow'
import { useDiagramStore } from '../store/diagramStore'
import { PersonNode, SystemNode, ContainerNode, ComponentNode, DatabaseNode, WebAppNode, QueueNode } from './nodes/C4Nodes'
import { RelationEdge } from './edges/RelationEdge'
import { MilestoneEditOverlay } from './MilestoneEditOverlay'
import { DeleteConfirmDialog } from './DeleteConfirmDialog'
import { C4ElementType, NODE_SIZES, COLLAPSED_HEIGHT } from '../types/c4'
import { isParentAllowed, isRelationAllowed } from '../types/metamodel'

// Node and edge type registrations
const nodeTypes: NodeTypes = {
  person: PersonNode as any,
  system: SystemNode as any,
  container: ContainerNode as any,
  component: ComponentNode as any,
  database: DatabaseNode as any,
  webapp: WebAppNode as any,
  queue: QueueNode as any,
}

const edgeTypes: EdgeTypes = {
  c4relation: RelationEdge as any,
}

// ─── Connection preview line (drawn while dragging) ────────────────────────────
function ConnectionPreviewLine({
  containerRef,
  sourceId,
  mouseX,
  mouseY,
}: {
  containerRef: React.RefObject<HTMLDivElement>
  sourceId: string
  mouseX: number
  mouseY: number
}) {
  const container = containerRef.current
  if (!container) return null

  // Find source node element and compute its center relative to the container
  const nodeEl = container.querySelector(`.react-flow__node[data-id="${CSS.escape(sourceId)}"]`) as HTMLElement | null
  if (!nodeEl) return null

  const cRect = container.getBoundingClientRect()
  const nRect = nodeEl.getBoundingClientRect()

  const sx = nRect.left + nRect.width / 2 - cRect.left
  const sy = nRect.top + nRect.height / 2 - cRect.top
  const ex = mouseX - cRect.left
  const ey = mouseY - cRect.top

  return (
    <svg
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 99,
      }}
    >
      <line
        x1={sx}
        y1={sy}
        x2={ex}
        y2={ey}
        stroke="var(--accent)"
        strokeWidth={2}
        strokeDasharray="6 4"
        opacity={0.7}
      />
      <circle cx={ex} cy={ey} r={4} fill="var(--accent)" opacity={0.7} />
    </svg>
  )
}

function StructuralCanvas(): React.ReactElement {
  const rfInstanceRef = useRef<ReactFlowInstance | null>(null)

  const appMode = useDiagramStore((s) => s.appMode)
  // Both viewer AND presenter must be layout-read-only — the saved
  // positions/sizes are part of the document and should not drift just
  // because someone is browsing or presenting it.
  const isViewMode = appMode !== 'designer'
  const presentationActive = useDiagramStore((s) => s.presentationActive)
  const autoFitActive = useDiagramStore((s) => s.autoFitActive)

  const rfNodes = useDiagramStore((s) => s.rfNodes)
  const rfEdges = useDiagramStore((s) => s.rfEdges)
  const onNodesChange = useDiagramStore((s) => s.onNodesChange)
  const onEdgesChange = useDiagramStore((s) => s.onEdgesChange)
  const selectNode = useDiagramStore((s) => s.selectNode)
  const selectEdge = useDiagramStore((s) => s.selectEdge)
  const addNode = useDiagramStore((s) => s.addNode)
  const liveGrab = useDiagramStore((s) => s.liveGrab)
  const liveDrag = useDiagramStore((s) => s.liveDrag)
  const liveRelease = useDiagramStore((s) => s.liveRelease)

  // Connection mode
  const connectSource = useDiagramStore((s) => s.connectSource)
  const connectionModifier = useDiagramStore((s) => s.connectionModifier)
  const cancelConnection = useDiagramStore((s) => s.cancelConnection)

  // Sequence editing mode
  const activeSequenceId = useDiagramStore((s) => s.activeSequenceId)
  const activeSequenceName = useDiagramStore((s) => s.activeSequenceId ? s.sequences[s.activeSequenceId]?.name : undefined)
  const setActiveSequence = useDiagramStore((s) => s.setActiveSequence)

  // Track whether the modifier key is currently held — use BOTH ref (sync)
  // and state (triggers re-render for visual feedback).
  const modifierHeldRef = useRef(false)
  const [modifierHeld, setModifierHeld] = useState(false)

  useEffect(() => {
    const keyProp = (e: KeyboardEvent): boolean => {
      switch (connectionModifier) {
        case 'shift': return e.shiftKey
        case 'ctrl':  return e.ctrlKey
        case 'alt':   return e.altKey
        case 'meta':  return e.metaKey
      }
    }
    const onDown = (e: KeyboardEvent) => {
      if (keyProp(e) && !modifierHeldRef.current) {
        modifierHeldRef.current = true
        setModifierHeld(true)
      }
    }
    const onUp = (e: KeyboardEvent) => {
      if (!keyProp(e) && modifierHeldRef.current) {
        modifierHeldRef.current = false
        setModifierHeld(false)
      }
    }
    const onBlur = () => { modifierHeldRef.current = false; setModifierHeld(false) }
    window.addEventListener('keydown', onDown)
    window.addEventListener('keyup', onUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onDown)
      window.removeEventListener('keyup', onUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [connectionModifier])

  const setFitViewFn = useDiagramStore((s) => s.setFitViewFn)
  const setViewportFns = useDiagramStore((s) => s.setViewportFns)

  // Always keep window.__rfCurrentViewport up-to-date so slide capture is accurate
  const vp = useViewport()
  useEffect(() => {
    ;(window as any).__rfCurrentViewport = { x: vp.x, y: vp.y, zoom: vp.zoom }
  }, [vp.x, vp.y, vp.zoom])

  // ── Auto-fit animation state ─────────────────────────────────────────
  // We run a single persistent rAF loop that *exponentially* eases the
  // viewport towards a moving target (recomputed every frame from current
  // node bounds). This is critically-damped lerp, not a fixed-duration
  // tween — it keeps converging smoothly even when the target keeps
  // changing (e.g. live physics still settling after a collapse), with no
  // hard transitions between successive ticks.
  const fitAnimRef = useRef<number | null>(null)
  const fitTargetRef = useRef<{ x: number; y: number; zoom: number } | null>(null)
  const fitForceRef = useRef(false) // bypass deadband for explicit fits
  // EMA-filtered target. Auto-fit ticks blend the freshly computed target
  // into this with a low-pass filter, so cola-induced jitter on the bbox
  // is averaged out instead of triggering discrete corrections. The rAF
  // chaser pulls the camera toward this filtered value continuously.
  // Smart-fit memory: ids of nodes that were visible (not `hidden`) on the
  // previous auto-fit tick. Smart-fit only reacts when something *new*
  // appears (expand parent → kids un-hide). Without new nodes, the camera
  // stays put — no fit-all churn from cola jitter or unrelated edits.
  const prevVisibleIdsRef = useRef<Set<string>>(new Set())
  // Active-fit window: while open, every tick refits to keep up with
  // cola still re-arranging things after an expand/collapse. Closes
  // automatically after ACTIVE_FIT_WINDOW_MS of no further visibility
  // changes — preventing the camera from breathing forever.
  const fitWindowUntilRef = useRef<number>(0)
  // Newly-appeared node ids in the *most recent* expand event (used to
  // bias zoom-out so the new nodes are guaranteed to be in frame, even
  // if cola is still pushing them around).
  const recentlyAddedIdsRef = useRef<Set<string>>(new Set())
  const containerRef = useRef<HTMLDivElement>(null)

  /**
   * Full fit-all target — everything visible (used for explicit Fit-All
   * button + initial auto-fit toggle, i.e. `force=true` callers).
   */
  const computeFitTarget = useCallback((): { x: number; y: number; zoom: number } | null => {
    const inst = rfInstanceRef.current
    const container = containerRef.current
    if (!inst || !container) return null
    const allNodes = inst.getNodes()
    if (allNodes.length === 0) return null
    // Exclude `hidden` nodes — collapsed parents leave their children behind
    // with their old (now off-screen) absolute positions; including them in
    // the bounds would balloon the bbox and shrink the fit to ~1/3 of the
    // viewport.
    const nodes = allNodes.filter((n) => !n.hidden)
    if (nodes.length === 0) return null
    const rect = container.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return null
    const bounds = getNodesBounds(nodes)
    // Inflate bbox by a generous safety margin so live-cola drift after the
    // fit converges doesn't push edge nodes off-screen. The fractional
    // padding alone isn't enough because cola can keep moving outward for
    // ~1s past the moment we compute the target.
    const FIT_MARGIN = 140
    const padded = {
      x: bounds.x - FIT_MARGIN,
      y: bounds.y - FIT_MARGIN,
      width: bounds.width + FIT_MARGIN * 2,
      height: bounds.height + FIT_MARGIN * 2,
    }
    return getViewportForBounds(padded, rect.width, rect.height, 0.05, 4, 0.18)
  }, [])

  /**
   * Smart-fit target — used by the 300ms auto-fit interval.
   * Returns:
   *  - `null` if nothing changed (no newly-visible nodes since last tick).
   *    Caller must NOT move the camera.
   *  - viewport target whose world rect is `union(currentViewportWorldRect,
   *    bounds(newlyVisibleNodes))` — i.e. just zoom out / pan enough to
   *    include the newly-revealed content while keeping everything the user
   *    already had on screen.
   * On first ever call (no memory yet), returns the same as `computeFitTarget`.
   */
  const computeSmartFitTarget = useCallback((): { x: number; y: number; zoom: number } | null => {
    const inst = rfInstanceRef.current
    const container = containerRef.current
    if (!inst || !container) return null
    const rect = container.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return null
    const allNodes = inst.getNodes()
    const visible = allNodes.filter((n) => !n.hidden)
    if (visible.length === 0) {
      prevVisibleIdsRef.current = new Set()
      return null
    }
    const currentIds = new Set(visible.map((n) => n.id))
    const prev = prevVisibleIdsRef.current
    // First-tick bootstrap: no prior memory → behave like fit-all so the
    // diagram is correctly framed when auto-fit first turns on.
    if (prev.size === 0) {
      prevVisibleIdsRef.current = currentIds
      const bounds = getNodesBounds(visible)
      const FIT_MARGIN = 140
      const padded = {
        x: bounds.x - FIT_MARGIN,
        y: bounds.y - FIT_MARGIN,
        width: bounds.width + FIT_MARGIN * 2,
        height: bounds.height + FIT_MARGIN * 2,
      }
      return getViewportForBounds(padded, rect.width, rect.height, 0.05, 4, 0.18)
    }
    const newlyVisible = visible.filter((n) => !prev.has(n.id))
    const removedCount = [...prev].filter((id) => !currentIds.has(id)).length
    // Always update memory so a later expand still detects "new".
    prevVisibleIdsRef.current = currentIds

    const ACTIVE_FIT_WINDOW_MS = 1500
    const now = performance.now()
    const hasChange = newlyVisible.length > 0 || removedCount > 0
    if (hasChange) {
      // Open / refresh active-fit window — cola needs ~1s to settle
      // siblings around the new/removed nodes; keep refitting in that
      // window so the user always sees the full result, not a stale
      // mid-animation snapshot.
      fitWindowUntilRef.current = now + ACTIVE_FIT_WINDOW_MS
      if (newlyVisible.length > 0) {
        recentlyAddedIdsRef.current = new Set(newlyVisible.map((n) => n.id))
      }
    }
    // Outside the active window with no fresh change → camera stays put.
    if (now > fitWindowUntilRef.current) return null

    // Inside the active window: include all currently-visible nodes
    // PLUS any recently-added nodes (in case cola has temporarily pushed
    // them off-screen mid-animation — they'll be referenced by their
    // current absolute positions). Computing fit-all of "visible" is
    // simpler and equivalent here because hidden=false → already in the
    // visible array.
    void newlyVisible
    void removedCount
    const bounds = getNodesBounds(visible)
    // Same safety margin as in the bootstrap branch — cola continues to
    // settle inside the active-fit window and edge nodes can otherwise end
    // up flush against (or just past) the viewport border.
    const FIT_MARGIN = 140
    const padded = {
      x: bounds.x - FIT_MARGIN,
      y: bounds.y - FIT_MARGIN,
      width: bounds.width + FIT_MARGIN * 2,
      height: bounds.height + FIT_MARGIN * 2,
    }
    return getViewportForBounds(padded, rect.width, rect.height, 0.05, 4, 0.18)
  }, [])

  /**
   * Request a smooth fit. `force=true` snaps deadband off and re-arms the
   * loop even when the diagram looks stationary (used for explicit Fit-All
   * button + initial auto-fit toggle).
   *
   * Multiple calls don't restart the animation — they just update the
   * target. The persistent rAF loop interpolates towards whatever the
   * latest target is, producing a continuous, naturally-damped motion.
   */
  const smoothFitView = useCallback((duration = 260, force = false) => {
    // Quick-search (and any other explicit "focus this node" caller) sets a
    // short suppression window on the window object. While active, the
    // auto-fit interval tick must not run — otherwise the zoom-in onto the
    // searched node is immediately overridden by fit-to-all on the next
    // 300ms tick. Manual / forced calls (Fit-All button) bypass this.
    if (!force) {
      const until = (window as unknown as { __radicalAutoFitSuppressUntil?: number }).__radicalAutoFitSuppressUntil ?? 0
      if (performance.now() < until) return
    }
    // Smart-fit: forced calls (Fit-All / initial toggle) → fit-all of all
    // visible nodes. Auto ticks → only react when something *new* appeared
    // (e.g. parent expand reveals children); union current viewport with
    // those new nodes' bounds and zoom out just enough to include them.
    // Returns null when nothing changed → don't move the camera.
    const target = force ? computeFitTarget() : computeSmartFitTarget()
    if (!target) return

    const inst = rfInstanceRef.current
    if (!inst) return
    const container = containerRef.current
    if (!container) return

    fitTargetRef.current = target
    fitForceRef.current = force
    if (fitAnimRef.current == null) {
      const tick = () => {
        const inst2 = rfInstanceRef.current
        const tgt = fitTargetRef.current
        if (!inst2 || !tgt) {
          fitAnimRef.current = null
          return
        }
        const cur = inst2.getViewport()
        // Time-constant tau (ms): smaller = snappier. Forced ~140ms,
        // auto ~280ms (smooth continuous tracking of new content).
        // Fraction per frame at 60fps: 1 - exp(-16.6/tau).
        const tau = fitForceRef.current ? 140 : 280
        const alpha = 1 - Math.exp(-16.6 / tau)
        const nx = cur.x + (tgt.x - cur.x) * alpha
        const ny = cur.y + (tgt.y - cur.y) * alpha
        const nz = cur.zoom + (tgt.zoom - cur.zoom) * alpha
        const dx = Math.abs(tgt.x - nx)
        const dy = Math.abs(tgt.y - ny)
        const dz = Math.abs(tgt.zoom - nz)
        if (dx < 0.2 && dy < 0.2 && dz < 0.0005) {
          inst2.setViewport(tgt)
          fitAnimRef.current = null
          return
        }
        inst2.setViewport({ x: nx, y: ny, zoom: nz })
        fitAnimRef.current = requestAnimationFrame(tick)
      }
      fitAnimRef.current = requestAnimationFrame(tick)
    }
    void duration // duration kept in API for callers; loop is time-constant based
  }, [computeFitTarget, computeSmartFitTarget])

  // Cancel the in-flight fit animation on unmount (HMR / route change).
  useEffect(() => {
    return () => {
      if (fitAnimRef.current != null) {
        cancelAnimationFrame(fitAnimRef.current)
        fitAnimRef.current = null
      }
    }
  }, [])

  const onInit = useCallback((instance: ReactFlowInstance) => {
    rfInstanceRef.current = instance
    setFitViewFn(
      // Animated fit (initial toggle / fitAll button) — force=true so the
      // user always sees a response even if the viewport is already close.
      () => smoothFitView(600, true),
      // Auto-fit interval tick (300 ms): respects the deadband — only kicks
      // in when the diagram has drifted out of frame by more than ~3% of the
      // viewport. This eliminates the constant micro-juddering from the live
      // physics solver while still snapping back after collapse/expand.
      () => smoothFitView(550, false),
    )
    setViewportFns(
      () => instance.getViewport(),
      (vp, opts) => instance.setViewport(vp, opts),
    )
    // Quick-search uses this to pan + zoom onto a specific node. Computed
    // here because only the RF instance knows the node's absolute layout
    // position (parent-relative coords would otherwise need translation).
    ;(window as any).__rfFocusNode = (nodeId: string, opts?: { zoom?: number; duration?: number }) => {
      const n = instance.getNode(nodeId) as (ReturnType<typeof instance.getNode> & { width?: number; height?: number }) | undefined
      if (!n) return
      const w = (n.width ?? 200)
      const h = (n.height ?? 120)
      const px = (n.positionAbsolute?.x ?? n.position.x) + w / 2
      const py = (n.positionAbsolute?.y ?? n.position.y) + h / 2
      const dur = opts?.duration ?? 600
      // Block the auto-fit interval tick from clobbering this zoom while
      // the pan animation is running and for a couple of seconds after,
      // so the user actually has time to look at the focused node.
      ;(window as unknown as { __radicalAutoFitSuppressUntil?: number }).__radicalAutoFitSuppressUntil =
        performance.now() + dur + 2500
      // Also cancel any in-flight smooth-fit animation so it doesn't keep
      // pulling the viewport back during the focus pan.
      if (fitAnimRef.current != null) {
        cancelAnimationFrame(fitAnimRef.current)
        fitAnimRef.current = null
      }
      instance.setCenter(px, py, { zoom: opts?.zoom ?? 1.1, duration: dur })
    }
    // Restore the camera saved with the active view (or default context).
    // Falls back to fit-all if no viewport was persisted yet.
    setTimeout(() => {
      const s = useDiagramStore.getState()
      const stored = s.activeViewId
        ? s.views[s.activeViewId]?.viewport ?? null
        : s.defaultViewport
      if (stored) {
        instance.setViewport(stored, { duration: 0 })
      } else {
        instance.fitView({ padding: 0.12 })
      }
    }, 100)
  }, [setFitViewFn, setViewportFns, smoothFitView])

  // Double-click on the canvas background → add a new System at that position
  const onCanvasDoubleClick = useCallback(
    (event: React.MouseEvent) => {
      if (!rfInstanceRef.current) return
      // Only fire if the double-click is directly on the pane (not on a node)
      const target = event.target as HTMLElement
      if (!target.classList.contains('react-flow__pane')) return
      // screenToFlowPosition takes raw screen coordinates (no need to subtract bounds)
      const { x, y } = rfInstanceRef.current.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      })
      addNode({
        type: 'system' as C4ElementType,
        label: 'New System',
        description: '',
        collapsed: false,
        external: false,
        x: x - NODE_SIZES.system.width / 2,
        y: y - NODE_SIZES.system.height / 2,
        ...NODE_SIZES.system,
      })
    },
    [addNode]
  )

  const onNodeClick: NodeMouseHandler = useCallback(
    (e, node) => {
      // Connection clicks are handled by onClickCapture on the container.
      // This only handles normal selection.
      if (modifierHeldRef.current || useDiagramStore.getState().connectSource) return
      cancelConnection()
      // When the multi-selection modifier is held, let ReactFlow's own
      // multi-select handling (surfaced via onNodesChange) drive the
      // selection set — calling selectNode() here would collapse it back
      // to a single id.
      const multi = e.shiftKey || e.metaKey || e.ctrlKey
      if (multi) return
      selectNode(node.id)
    },
    [cancelConnection, selectNode]
  )

  // Use a native mousedown/mouseup flow on the container to handle
  // drag-to-connect: modifier+mousedown on source → drag → mouseup on target.
  const connectingRef = useRef(false) // true while actively dragging a connection
  const [connectMouse, setConnectMouse] = useState<{ x: number; y: number } | null>(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const findNodeId = (target: HTMLElement): string | null => {
      const nodeEl = target.closest('.react-flow__node') as HTMLElement | null
      return nodeEl?.getAttribute('data-id') ?? null
    }

    const isModHeld = (e: MouseEvent): boolean => {
      const mod = useDiagramStore.getState().connectionModifier
      return mod === 'shift' ? e.shiftKey :
             mod === 'ctrl'  ? e.ctrlKey :
             mod === 'alt'   ? e.altKey :
                               e.metaKey
    }

    const onMouseDown = (e: MouseEvent) => {
      if (!isModHeld(e)) return
      const nodeId = findNodeId(e.target as HTMLElement)
      if (!nodeId) return

      // Prevent ReactFlow from seeing this (no drag, no select)
      e.stopPropagation()
      e.preventDefault()

      const state = useDiagramStore.getState()
      state.startConnection(nodeId)
      connectingRef.current = true
      setConnectMouse({ x: e.clientX, y: e.clientY })
    }

    const onMouseMove = (e: MouseEvent) => {
      if (!connectingRef.current) return
      setConnectMouse({ x: e.clientX, y: e.clientY })
    }

    const onMouseUp = (e: MouseEvent) => {
      if (!connectingRef.current) return
      connectingRef.current = false
      setConnectMouse(null)

      const state = useDiagramStore.getState()
      const src = state.connectSource
      if (!src) return

      const nodeId = findNodeId(e.target as HTMLElement)
      if (nodeId && nodeId !== src) {
        const srcNode = state.c4Nodes[src]
        const dstNode = state.c4Nodes[nodeId]
        if (srcNode && dstNode) {
          if (isRelationAllowed(state.metamodel, srcNode.type, dstNode.type)) {
            state.addRelation({ sourceId: src, targetId: nodeId })
          } else {
            const srcLabel = state.metamodel?.nodeTypes[srcNode.type]?.label ?? srcNode.type
            const dstLabel = state.metamodel?.nodeTypes[dstNode.type]?.label ?? dstNode.type
            state.pushNotification(
              `Relation not allowed: ${srcLabel} → ${dstLabel}. The metamodel does not permit this connection.`,
              'error',
            )
          }
        }
      }
      state.cancelConnection()
    }

    // Capture phase so we intercept before ReactFlow
    el.addEventListener('mousedown', onMouseDown, true)
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      el.removeEventListener('mousedown', onMouseDown, true)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [])

  const onPaneClick = useCallback(() => {
    cancelConnection()
    selectNode(null)
    selectEdge(null)
  }, [cancelConnection, selectNode, selectEdge])

  // Metamodel-aware validation for ReactFlow's built-in connect drag.
  const isValidConnection = useCallback((conn: { source: string | null; target: string | null }) => {
    if (!conn.source || !conn.target || conn.source === conn.target) return false
    const state = useDiagramStore.getState()
    const src = state.c4Nodes[conn.source]
    const dst = state.c4Nodes[conn.target]
    if (!src || !dst) return false
    return isRelationAllowed(state.metamodel, src.type, dst.type)
  }, [])

  const onEdgeClick = useCallback(
    (_e: React.MouseEvent, edge: { id: string }) => {
      selectEdge(edge.id)
      // If a sequence is being edited, toggle this relation in it
      const state = useDiagramStore.getState()
      if (state.activeSequenceId && !edge.id.startsWith('virtual-')) {
        state.toggleRelationInSequence(state.activeSequenceId, edge.id)
      }
    },
    [selectEdge]
  )

  // Handle drag-from-sidebar drop
  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault()
      const typeStr = event.dataTransfer.getData('application/c4-type') as C4ElementType
      if (!typeStr || !rfInstanceRef.current) return

      const flowPos = rfInstanceRef.current.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      })

      // Detect if drop point is inside a node that is an allowed parent for
      // the dropped type, according to the active metamodel.
      const mm = useDiagramStore.getState().metamodel
      const def = mm?.nodeTypes[typeStr]
      const allowedParents = def?.allowedParents ?? []
      const typeLabel = def?.label ?? typeStr

      // Find the deepest visible node under the cursor regardless of whether
      // it's an allowed parent — we need it both to compute relative coords
      // (when valid) and to produce an accurate error toast (when not).
      const currentNodes = rfInstanceRef.current.getNodes()
      let hoveredNode: (typeof currentNodes)[number] | null = null
      for (const n of currentNodes) {
        if (n.hidden) continue
        const ax = n.positionAbsolute?.x ?? n.position.x
        const ay = n.positionAbsolute?.y ?? n.position.y
        const w = n.width ?? 0
        const h = n.height ?? 0
        if (flowPos.x >= ax && flowPos.x <= ax + w && flowPos.y >= ay && flowPos.y <= ay + h) {
          if (!hoveredNode || (n.zIndex ?? 0) >= (hoveredNode.zIndex ?? 0)) {
            hoveredNode = n
          }
        }
      }

      let parentId: string | undefined
      let relX = flowPos.x
      let relY = flowPos.y

      if (hoveredNode) {
        const hoveredType = hoveredNode.type ?? ''
        if (allowedParents.includes(hoveredType)) {
          // Valid drop into parent.
          parentId = hoveredNode.id
          const pax = hoveredNode.positionAbsolute?.x ?? hoveredNode.position.x
          const pay = hoveredNode.positionAbsolute?.y ?? hoveredNode.position.y
          relX = flowPos.x - pax
          relY = flowPos.y - pay
        } else {
          // Dropped on a node that is NOT a permitted parent for this type
          // (e.g. dragging a System onto a Container). Refuse the drop.
          const hoveredLabel = mm?.nodeTypes[hoveredType]?.label ?? hoveredType
          const allowedStr = allowedParents.length
            ? allowedParents.map(t => mm?.nodeTypes[t]?.label ?? t).join(', ')
            : 'the canvas root'
          useDiagramStore.getState().pushNotification(
            `Cannot place ${typeLabel} inside ${hoveredLabel}. Allowed parents: ${allowedStr}.`,
            'error',
          )
          return
        }
      } else if (!isParentAllowed(mm, typeStr, undefined)) {
        // Dropped on empty canvas but this type cannot live at the root.
        const allowedStr = allowedParents.length
          ? allowedParents.map(t => mm?.nodeTypes[t]?.label ?? t).join(', ')
          : 'a parent'
        useDiagramStore.getState().pushNotification(
          `${typeLabel} must be placed inside ${allowedStr}.`,
          'error',
        )
        return
      }

      const size = NODE_SIZES[typeStr]
      addNode({
        type: typeStr,
        label: typeStr[0].toUpperCase() + typeStr.slice(1),
        description: '',
        technology: '',
        collapsed: false,
        external: false,
        parentId,
        x: relX - size.width / 2,
        y: relY - size.height / 2,
        ...size,
      })
    },
    [addNode]
  )

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }, [])

  // Cancel connection on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && connectSource) cancelConnection()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [connectSource, cancelConnection])

  // Cola-driven drag handlers
  const dragRafRef = useRef<number | null>(null)

  const onNodeDragStart: NodeMouseHandler = useCallback(
    (_event, node) => {
      liveGrab(node.id, node.position.x, node.position.y)
    },
    [liveGrab]
  )

  const onNodeDrag: NodeMouseHandler = useCallback(
    (_event, node) => {
      liveDrag(node.id, node.position.x, node.position.y)
    },
    [liveDrag]
  )

  const onNodeDragStop: NodeMouseHandler = useCallback(
    (_event, node) => {
      liveRelease(node.id)
    },
    [liveRelease]
  )

  // CSS class for connecting mode visual feedback
  const canvasClasses = ['canvas-area']
  if (connectSource) canvasClasses.push('connecting')
  if (modifierHeld) canvasClasses.push('connect-ready')
  if (autoFitActive) canvasClasses.push('autofit-active')

  // Annotate nodes: connecting-source class when in connect mode
  const annotatedNodes = connectSource
    ? rfNodes.map((n) =>
        n.id === connectSource
          ? { ...n, className: (n.className ?? '') + ' connecting-source' }
          : n
      )
    : rfNodes

  return (
    <div
      ref={containerRef}
      className={canvasClasses.join(' ')}
      onDrop={isViewMode ? undefined : onDrop}
      onDragOver={isViewMode ? undefined : onDragOver}
      onDoubleClick={isViewMode ? undefined : onCanvasDoubleClick}
    >
      {activeSequenceId && (
        <div style={{
          position: 'absolute',
          top: 8,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 100,
          background: 'var(--accent)',
          color: '#fff',
          fontSize: 11,
          fontWeight: 600,
          padding: '5px 12px',
          borderRadius: 20,
          boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          pointerEvents: 'all',
          userSelect: 'none',
        }}>
          Editing: {activeSequenceName ?? activeSequenceId} — click relations to add/remove steps
          <button
            onClick={() => setActiveSequence(null)}
            style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', padding: '0 2px', fontSize: 13, lineHeight: 1, opacity: 0.85 }}
            title="Stop editing"
          >✕</button>
        </div>
      )}
      <MilestoneEditOverlay />
      <DeleteConfirmDialog />
      <ReactFlow
        nodes={annotatedNodes}
        edges={rfEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        onNodeDragStart={onNodeDragStart}
        onNodeDrag={onNodeDrag}
        onNodeDragStop={onNodeDragStop}
        onEdgeClick={onEdgeClick as any}
        onPaneClick={onPaneClick}
        onInit={onInit}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        nodesDraggable={!presentationActive}
        nodesConnectable={!isViewMode && !presentationActive}
        elementsSelectable
        connectOnClick={false}
        isValidConnection={isValidConnection}
        minZoom={0.05}
        maxZoom={3}
        deleteKeyCode="Delete"
        multiSelectionKeyCode={connectionModifier === 'shift' ? 'Meta' : 'Shift'}
        selectNodesOnDrag={false}
        elevateEdgesOnSelect
        elevateNodesOnSelect
        proOptions={{ hideAttribution: true }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={24}
          size={1}
          color="var(--canvas-dots)"
        />
        <Controls
          showFitView={false}
          showInteractive={false}
          style={{
            background: 'var(--bg-panel)',
            border: '1px solid var(--border-color)',
            borderRadius: 6,
          }}
        />
      </ReactFlow>

      {connectSource && connectMouse && (
        <ConnectionPreviewLine
          containerRef={containerRef}
          sourceId={connectSource}
          mouseX={connectMouse.x}
          mouseY={connectMouse.y}
        />
      )}

      {connectSource && (
        <div
          style={{
            position: 'absolute',
            top: 12,
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'var(--accent)',
            color: '#fff',
            borderRadius: 5,
            padding: '4px 12px',
            fontSize: 12,
            fontWeight: 600,
            pointerEvents: 'none',
            zIndex: 100,
          }}
        >
          Connecting from "{rfNodes.find((n) => n.id === connectSource)?.data?.label ?? connectSource}" — release on target
        </div>
      )}
    </div>
  )
}

export function Canvas(): React.ReactElement {
  return <StructuralCanvas />
}
