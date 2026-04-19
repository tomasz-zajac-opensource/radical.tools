import React, { useCallback, useRef, useEffect, useState, useMemo } from 'react'
import ReactFlow, {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  NodeTypes,
  EdgeTypes,
  NodeMouseHandler,
  ReactFlowInstance,
} from 'reactflow'
import { useDiagramStore } from '../store/diagramStore'
import { PersonNode, SystemNode, ContainerNode, ComponentNode, DatabaseNode } from './nodes/C4Nodes'
import { RelationEdge } from './edges/RelationEdge'
import { C4ElementType, NODE_SIZES, COLLAPSED_HEIGHT } from '../types/c4'

// Node and edge type registrations
const nodeTypes: NodeTypes = {
  person: PersonNode as any,
  system: SystemNode as any,
  container: ContainerNode as any,
  component: ComponentNode as any,
  database: DatabaseNode as any,
}

const edgeTypes: EdgeTypes = {
  c4relation: RelationEdge as any,
}

// Colour for minimap nodes
function minimapColor(type: string): string {
  const palette: Record<string, string> = {
    person: '#08427b',
    system: '#1168bd',
    container: '#438dd5',
    component: '#85bbf0',
  }
  return palette[type] ?? '#888'
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

export function Canvas(): React.ReactElement {
  const rfInstanceRef = useRef<ReactFlowInstance | null>(null)

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

  const onInit = useCallback((instance: ReactFlowInstance) => {
    rfInstanceRef.current = instance
    setFitViewFn(
      () => instance.fitView({ padding: 0.12, duration: 400 }),
      () => instance.fitView({ padding: 0.12 })
    )
    setTimeout(() => instance.fitView({ padding: 0.12 }), 100)
  }, [setFitViewFn])

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
    (_e, node) => {
      // Connection clicks are handled by onClickCapture on the container.
      // This only handles normal selection.
      if (modifierHeldRef.current || useDiagramStore.getState().connectSource) return
      cancelConnection()
      selectNode(node.id)
    },
    [cancelConnection, selectNode]
  )

  // Use a native mousedown/mouseup flow on the container to handle
  // drag-to-connect: modifier+mousedown on source → drag → mouseup on target.
  const containerRef = useRef<HTMLDivElement>(null)
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
        state.addRelation({ sourceId: src, targetId: nodeId })
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

  const onEdgeClick = useCallback(
    (_e: React.MouseEvent, edge: { id: string }) => { 
      selectEdge(edge.id)
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

      // Detect if drop point is inside a container-type node (system or container)
      // and the dropped type is a valid child for that parent.
      const validParentTypes: Record<string, string[]> = {
        container: ['system'],      // container can be child of system
        component: ['container'],   // component can be child of container
        database:  ['system', 'container'], // database can be child of system or container
      }
      const allowedParents = validParentTypes[typeStr] || []

      let parentId: string | undefined
      let relX = flowPos.x
      let relY = flowPos.y

      if (allowedParents.length > 0) {
        // Use getNodes() from ReactFlow instance — it includes computed positionAbsolute
        const currentNodes = rfInstanceRef.current.getNodes()
        // Find the deepest (highest zIndex) matching parent under the cursor
        let bestNode: (typeof currentNodes)[number] | null = null
        for (const n of currentNodes) {
          if (!allowedParents.includes(n.type ?? '')) continue
          if (n.hidden) continue
          const ax = n.positionAbsolute?.x ?? n.position.x
          const ay = n.positionAbsolute?.y ?? n.position.y
          const w = (n.width ?? 0)
          const h = (n.height ?? 0)
          if (flowPos.x >= ax && flowPos.x <= ax + w && flowPos.y >= ay && flowPos.y <= ay + h) {
            if (!bestNode || (n.zIndex ?? 0) >= (bestNode.zIndex ?? 0)) {
              bestNode = n
            }
          }
        }
        if (bestNode) {
          parentId = bestNode.id
          // Convert absolute flow position to relative position within parent
          const pax = bestNode.positionAbsolute?.x ?? bestNode.position.x
          const pay = bestNode.positionAbsolute?.y ?? bestNode.position.y
          relX = flowPos.x - pax
          relY = flowPos.y - pay
        }
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

  // Modifier label for the hint text
  const modLabel =
    connectionModifier === 'shift' ? 'Shift' :
    connectionModifier === 'ctrl' ? 'Ctrl' :
    connectionModifier === 'alt' ? (navigator.platform?.includes('Mac') ? 'Option' : 'Alt') :
    'Cmd'

  // CSS class for connecting mode visual feedback
  const canvasClasses = ['canvas-area']
  if (connectSource) canvasClasses.push('connecting')
  if (modifierHeld) canvasClasses.push('connect-ready')

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
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDoubleClick={onCanvasDoubleClick}
    >
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
        connectOnClick={false}
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
        <MiniMap
          nodeColor={(n) => minimapColor(n.type ?? '')}
          maskColor="var(--minimap-mask)"
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

      <div
        style={{
          position: 'absolute',
          bottom: 12,
          left: '50%',
          transform: 'translateX(-50%)',
          background: 'var(--hint-bg)',
          border: '1px solid var(--border-color)',
          borderRadius: 5,
          padding: '3px 10px',
          fontSize: 11,
          color: 'var(--text-muted)',
          pointerEvents: 'none',
        }}
      >
        Double-click canvas to add a System · Drag from panel · {modLabel}+drag between nodes to connect
      </div>
    </div>
  )
}
