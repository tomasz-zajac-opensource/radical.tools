import React, { memo, useCallback, useMemo, useState, useRef, useEffect } from 'react'
import {
  EdgeProps,
  EdgeLabelRenderer,
  BaseEdge,
  Position,
  useStore,
  useStoreApi,
} from 'reactflow'
import { C4EdgeRFData } from '../../types/c4'
import { computeRoutedEdge, RoutingObstacle } from '../../layout/edgeRouting'
import { allocatePorts } from '../../layout/portAllocator'
import { useDiagramStore } from '../../store/diagramStore'

// ─── Floating-edge helpers ────────────────────────────────────────────────────

function nodeCenter(node: { positionAbsolute?: { x: number; y: number }; width?: number | null; height?: number | null }) {
  return {
    x: (node.positionAbsolute?.x ?? 0) + (node.width ?? 0) / 2,
    y: (node.positionAbsolute?.y ?? 0) + (node.height ?? 0) / 2,
  }
}

/**
 * Pick the best exit/entry side based on direction vector.
 * Slightly biased toward vertical sides (Top/Bottom) because
 * C4 diagrams flow top→bottom, so near-diagonal edges look better
 * exiting vertically.
 */
function bestSide(dx: number, dy: number, isTarget: boolean): Position {
  // Vertical bias: treat vertical as dominant unless horizontal is clearly larger
  const VERTICAL_BIAS = 1.15
  if (Math.abs(dx) >= Math.abs(dy) * VERTICAL_BIAS) {
    // horizontal dominant
    const goingRight = dx > 0
    return (goingRight !== isTarget) ? Position.Right : Position.Left
  } else {
    // vertical dominant (or near-diagonal → prefer vertical)
    const goingDown = dy > 0
    return (goingDown !== isTarget) ? Position.Bottom : Position.Top
  }
}

/**
 * Compute the border point on a node given the chosen side.
 * Always returns the centre of the side for clean, consistent connections.
 */
function borderPoint(
  node: { positionAbsolute?: { x: number; y: number }; width?: number | null; height?: number | null },
  side: Position,
  _otherCenter?: { x: number; y: number }
) {
  const ax = node.positionAbsolute?.x ?? 0
  const ay = node.positionAbsolute?.y ?? 0
  const w  = node.width  ?? 0
  const h  = node.height ?? 0

  switch (side) {
    case Position.Left:   return { x: ax,         y: ay + h / 2 }
    case Position.Right:  return { x: ax + w,     y: ay + h / 2 }
    case Position.Top:    return { x: ax + w / 2, y: ay         }
    case Position.Bottom: return { x: ax + w / 2, y: ay + h     }
  }
}

// ─── Custom arrowhead ─────────────────────────────────────────────────────────

function Arrow({ x, y, side, color, size }: { x: number; y: number; side: Position; color: string; size: number }) {
  const half = size / 2
  // Arrow tip is at (x,y) on the node border, pointing INTO the node
  let d: string
  switch (side) {
    case Position.Top:    d = `M${x - half},${y - size}L${x},${y}L${x + half},${y - size}`; break
    case Position.Bottom: d = `M${x - half},${y + size}L${x},${y}L${x + half},${y + size}`; break
    case Position.Left:   d = `M${x - size},${y - half}L${x},${y}L${x - size},${y + half}`; break
    case Position.Right:  d = `M${x + size},${y - half}L${x},${y}L${x + size},${y + half}`; break
  }
  return <path d={d} fill={color} stroke="none" />
}

// ─── Reconnect handle (draggable endpoint) ───────────────────────────────────

function ReconnectHandle({
  x,
  y,
  edgeId,
  end,
  otherNodeId,
}: {
  x: number
  y: number
  edgeId: string
  end: 'source' | 'target'
  otherNodeId: string
}) {
  const updateRelation = useDiagramStore((s) => s.updateRelation)
  const [dragging, setDragging] = useState(false)
  const [mouse, setMouse] = useState<{ x: number; y: number } | null>(null)
  const svgRef = useRef<SVGElement | null>(null)

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      e.preventDefault()
      setDragging(true)
      setMouse({ x: e.clientX, y: e.clientY })
    },
    []
  )

  useEffect(() => {
    if (!dragging) return

    const onMove = (e: MouseEvent) => {
      setMouse({ x: e.clientX, y: e.clientY })
    }

    const onUp = (e: MouseEvent) => {
      setDragging(false)
      setMouse(null)

      // Find node under cursor
      const el = document.elementFromPoint(e.clientX, e.clientY)
      const nodeEl = (el as HTMLElement)?.closest?.('.react-flow__node') as HTMLElement | null
      const nodeId = nodeEl?.getAttribute('data-id')

      if (nodeId && nodeId !== otherNodeId && !edgeId.startsWith('virtual-')) {
        updateRelation(edgeId, end === 'source' ? { sourceId: nodeId } : { targetId: nodeId })
      }
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [dragging, edgeId, end, otherNodeId, updateRelation])

  // Compute preview line endpoint in SVG coordinates
  const previewPt = useMemo(() => {
    if (!dragging || !mouse) return null
    // We need to convert screen coords to SVG flow coords.
    // Find the ReactFlow viewport SVG element.
    const svg = document.querySelector('.react-flow__edges')?.closest('svg')
    if (!svg) return null
    const pt = svg.createSVGPoint()
    pt.x = mouse.x
    pt.y = mouse.y
    const ctm = svg.getScreenCTM()
    if (!ctm) return null
    const svgPt = pt.matrixTransform(ctm.inverse())
    return { x: svgPt.x, y: svgPt.y }
  }, [dragging, mouse])

  return (
    <>
      {/* Draggable handle circle */}
      <circle
        cx={x}
        cy={y}
        r={10}
        fill="var(--accent)"
        stroke="#fff"
        strokeWidth={2.5}
        style={{ cursor: 'grab', pointerEvents: 'all' }}
        className="nodrag nopan"
        onMouseDown={onMouseDown}
      />
      {/* Preview line while dragging */}
      {dragging && previewPt && (
        <>
          <line
            x1={x}
            y1={y}
            x2={previewPt.x}
            y2={previewPt.y}
            stroke="var(--accent)"
            strokeWidth={2}
            strokeDasharray="6 4"
            opacity={0.6}
          />
          <circle cx={previewPt.x} cy={previewPt.y} r={4} fill="var(--accent)" opacity={0.6} />
        </>
      )}
    </>
  )
}

// ─── Edge component ───────────────────────────────────────────────────────────

export const RelationEdge = memo(
  ({
    id,
    source,
    target,
    data,
    markerEnd,
    style,
    selected,
  }: EdgeProps<C4EdgeRFData>) => {
    // Targeted selectors: only re-render when THIS edge's source or target changes
    const sourceSelector = useCallback((s: any) => s.nodeInternals.get(source), [source])
    const targetSelector = useCallback((s: any) => s.nodeInternals.get(target), [target])
    const sourceNode = useStore(sourceSelector)
    const targetNode = useStore(targetSelector)
    const diffKind = useDiagramStore(s => s.showDiff ? s.diffHighlight[id] : undefined)
    const storeApi = useStoreApi()

    // Fall back to a straight stub if node data is not ready yet
    if (!sourceNode || !targetNode) return null

    const sc = nodeCenter(sourceNode)
    const tc = nodeCenter(targetNode)

    // Resolve sides + ports from the central allocator (groups parallel
    // edges so they don't all collide at the centre of a side).
    const stateSnapshot = storeApi.getState()
    const allocations = allocatePorts(
      stateSnapshot.nodeInternals as any,
      stateSnapshot.edges as any
    )
    const alloc = allocations.get(id)

    let srcSide: Position, tgtSide: Position
    let sp: { x: number; y: number }, tp: { x: number; y: number }
    if (alloc) {
      srcSide = alloc.sourceSide
      tgtSide = alloc.targetSide
      sp = alloc.sourcePoint
      tp = alloc.targetPoint
    } else {
      // Fallback (e.g. virtual edges not in store)
      const dx = tc.x - sc.x
      const dy = tc.y - sc.y
      const sax = sourceNode.positionAbsolute?.x ?? 0
      const say = sourceNode.positionAbsolute?.y ?? 0
      const sw  = sourceNode.width  ?? 0
      const sh  = sourceNode.height ?? 0
      const tax = targetNode.positionAbsolute?.x ?? 0
      const tay = targetNode.positionAbsolute?.y ?? 0
      const tw  = targetNode.width  ?? 0
      const th  = targetNode.height ?? 0
      const ntx = Math.max(tax, Math.min(tax + tw, sc.x))
      const nty = Math.max(tay, Math.min(tay + th, sc.y))
      let srcDx = ntx - sc.x
      let srcDy = nty - sc.y
      if (srcDx === 0 && srcDy === 0) { srcDx = dx; srcDy = dy }
      const nsx = Math.max(sax, Math.min(sax + sw, tc.x))
      const nsy = Math.max(say, Math.min(say + sh, tc.y))
      let tgtDx = tc.x - nsx
      let tgtDy = tc.y - nsy
      if (tgtDx === 0 && tgtDy === 0) { tgtDx = dx; tgtDy = dy }
      srcSide = bestSide(srcDx, srcDy, false)
      tgtSide = bestSide(tgtDx, tgtDy, true)
      sp = borderPoint(sourceNode, srcSide, tc)
      tp = borderPoint(targetNode, tgtSide, sc)
    }

    // Collect obstacles imperatively (no reactive subscription to all nodes)
    const nodeInternals = stateSnapshot.nodeInternals
    const allNodes = Array.from(nodeInternals.values())
    const excludeIds = new Set<string>([source, target])

    // Exclude ancestors of source and target (edge crosses their borders)
    let walker: (typeof sourceNode) | undefined = sourceNode
    while (walker?.parentNode) { excludeIds.add(walker.parentNode); walker = nodeInternals.get(walker.parentNode) }
    walker = targetNode
    while (walker?.parentNode) { excludeIds.add(walker.parentNode); walker = nodeInternals.get(walker.parentNode) }

    const obstacles: RoutingObstacle[] = []
    for (const n of allNodes) {
      if (excludeIds.has(n.id) || n.hidden || !n.width || !n.height) continue
      // Exclude descendants of source or target (they're inside those nodes)
      let isDescendant = false
      let cur: (typeof n) | undefined = n
      while (cur?.parentNode) {
        if (cur.parentNode === source || cur.parentNode === target) { isDescendant = true; break }
        cur = nodeInternals.get(cur.parentNode)
      }
      if (isDescendant) continue
      obstacles.push({
        x: n.positionAbsolute?.x ?? 0,
        y: n.positionAbsolute?.y ?? 0,
        w: n.width,
        h: n.height,
      })
    }

    const { path: edgePath, labelX, labelY } = computeRoutedEdge(
      sp.x, sp.y, srcSide,
      tp.x, tp.y, tgtSide,
      obstacles,
    )

    const strokeColor = selected ? 'var(--accent)' : data?.isVirtual ? '#6b7280' : '#94a3b8'
    const strokeDash  = data?.isVirtual ? '6 3' : undefined

    // Diff highlight
    const diffStroke =
      diffKind === 'new' ? 'var(--success)'
      : diffKind === 'removed' ? 'var(--danger)'
      : diffKind === 'changed' ? 'var(--warning, #d97706)'
      : null
    const diffDash = diffKind === 'removed' ? '6 4' : undefined
    const diffOpacity = diffKind === 'removed' ? 0.55 : 1

    return (
      <>
        <BaseEdge
          id={id}
          path={edgePath}
          style={{
            ...style,
            stroke:          diffStroke ?? strokeColor,
            strokeWidth:     diffStroke ? 3 : selected ? 2 : 1.5,
            strokeDasharray: diffDash ?? strokeDash,
            strokeLinejoin:  'round',
            strokeLinecap:   'round',
            opacity:         diffOpacity,
            filter:          diffStroke ? `drop-shadow(0 0 4px ${diffStroke})` : undefined,
          }}
        />
        {/* Custom arrowhead drawn at the target point */}
        <Arrow x={tp.x} y={tp.y} side={tgtSide} color={diffStroke ?? strokeColor} size={selected ? 10 : 8} />

        {/* Reconnect handles at endpoints when edge is selected */}
        {selected && !data?.isVirtual && (
          <>
            <ReconnectHandle x={sp.x} y={sp.y} edgeId={id} end="source" otherNodeId={target} />
            <ReconnectHandle x={tp.x} y={tp.y} edgeId={id} end="target" otherNodeId={source} />
          </>
        )}

        {(data?.label || data?.technology || data?.relationType) && (
          <EdgeLabelRenderer>
            <div
              style={{
                position:        'absolute',
                transform:       `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
                background:      'var(--edge-label-bg)',
                border:          '1px solid var(--edge-label-border)',
                borderRadius:    4,
                padding:         '3px 8px',
                fontSize:        17,
                color:           'var(--text-primary)',
                pointerEvents:   'none',
                maxWidth:        200,
                textAlign:       'center',
                lineHeight:      1.4,
                backdropFilter:  'blur(4px)',
                zIndex:          1000,
              }}
              className="nodrag nopan"
            >
              {data.label
                ? <div>{data.label}</div>
                : data.relationType && <div style={{ opacity: 0.85, fontStyle: 'italic' }}>{data.relationType}</div>
              }
              {data.technology && (
                <div style={{ fontStyle: 'italic', opacity: 0.85, fontSize: 14 }}>
                  [{data.technology}]
                </div>
              )}
            </div>
          </EdgeLabelRenderer>
        )}
        {data?.sequenceStep !== undefined && data.sequenceStep.length > 0 && (
          <EdgeLabelRenderer>
            <div
              style={{
                position:      'absolute',
                transform:     `translate(-50%, -50%) translate(${sp.x + (tp.x - sp.x) * 0.18}px,${sp.y + (tp.y - sp.y) * 0.18}px)`,
                background:    'var(--accent)',
                color:         '#fff',
                borderRadius:  data.sequenceStep.length === 1 ? '50%' : 8,
                minWidth:      20,
                height:        20,
                padding:       data.sequenceStep.length === 1 ? 0 : '0 5px',
                display:       'flex',
                alignItems:    'center',
                justifyContent:'center',
                fontSize:      10,
                fontWeight:    700,
                pointerEvents: 'none',
                zIndex:        1001,
                boxShadow:     '0 1px 4px rgba(0,0,0,0.4)',
                lineHeight:    1,
                whiteSpace:    'nowrap',
              }}
              className="nodrag nopan"
            >
              {data.sequenceStep.join(',')}
            </div>
          </EdgeLabelRenderer>
        )}
      </>
    )
  }
)

RelationEdge.displayName = 'RelationEdge'
