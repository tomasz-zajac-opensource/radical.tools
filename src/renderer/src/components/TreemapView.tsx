import React, { useMemo, useRef, useEffect, useLayoutEffect, useState, useCallback } from 'react'
import { useDiagramStore } from '../store/diagramStore'
import { TYPE_ICON_PATHS } from '../types/c4'
import type { C4ElementType, C4Node, C4Relation } from '../types/c4'

// ─── Color palette per C4 type ──────────────────────────────────────────────
const TYPE_COLORS: Record<string, readonly [string, string, string]> = {
  domain:    ['#0a1e38', '#1a4a7a', '#90bcdf'],
  system:    ['#0d3a6e', '#1168bd', '#b0d4f5'],
  container: ['#154f88', '#3880c4', '#c5e2f8'],
  component: ['#1e5f9e', '#5e9fd8', '#daeefb'],
  database:  ['#321060', '#7e3dbf', '#c9a8f0'],
  webapp:    ['#0a3a1e', '#20924f', '#9de2b8'],
  queue:     ['#4a2000', '#c47a10', '#f0c88a'],
  person:    ['#4a0a10', '#b83020', '#f0a8a8'],
} as const

const FALLBACK_COLORS = ['#181830', '#36366a', '#9090b8'] as const

// ─── Types ──────────────────────────────────────────────────────────────────

type SizeBy = 'leaves' | 'uniform' | 'relations'

interface TNode {
  id:           string
  label:        string
  type:         string
  depth:        number
  value:        number
  relCount:     number
  descendants:  number  // total leaves under this node (1 if leaf)
  children:     TNode[]
  hasKids:      boolean
  /** true iff this node has real children that were hidden by the depth
   *  cutoff (i.e. user could click to reveal them inline) */
  cutAtDepth:   boolean
  /** true iff this node id is in the view's `treemapExpandedIds` set */
  isExpanded:   boolean
  rect?:        Rect
}

interface Rect { x: number; y: number; w: number; h: number }

// ─── Build tree ──────────────────────────────────────────────────────────────

function buildTree(
  nodes:        Record<string, C4Node>,
  relCount:     Record<string, number>,
  viewFilter:   Set<string> | undefined,
  parentId:     string | undefined,
  depth:        number,
  sizeBy:       SizeBy,
  maxDepth:     number,
  expandedSet:  Set<string>,
  parentForced: boolean,
): TNode[] {
  const result: TNode[] = []
  for (const n of Object.values(nodes)) {
    if (n.parentId !== parentId) continue
    if (viewFilter && !viewFilter.has(n.id)) continue
    // A node forces unlimited expansion of its subtree when the user has
    // explicitly expanded it (or any ancestor of it within this build).
    const nodeForced = parentForced || expandedSet.has(n.id)
    const cutChildren = !nodeForced && depth + 1 >= maxDepth
    const children = cutChildren
      ? []
      : buildTree(nodes, relCount, viewFilter, n.id, depth + 1, sizeBy, maxDepth, expandedSet, nodeForced)
    // When children were cut by the depth limit, still mark hasKids so the
    // node renders as drillable/expandable.
    let hasKids = children.length > 0
    let cutAtDepth = false
    if (!hasKids && cutChildren) {
      for (const m of Object.values(nodes)) {
        if (m.parentId !== n.id) continue
        if (viewFilter && !viewFilter.has(m.id)) continue
        hasKids = true
        cutAtDepth = true
        break
      }
    }
    const rc = relCount[n.id] ?? 0
    const descendants = children.length === 0
      ? 1
      : children.reduce((s, c) => s + c.descendants, 0)
    let value: number
    if (sizeBy === 'uniform') {
      // every sibling weighs the same; parent = number of own children (>=1)
      value = children.length === 0 ? 1 : children.reduce((s, c) => s + c.value, 0)
      if (children.length === 0) value = 1
    } else if (sizeBy === 'relations') {
      // legacy: leaves sized by relation count
      value = children.length === 0
        ? Math.max(1, rc + 1)
        : children.reduce((s, c) => s + c.value, 0)
    } else {
      // 'leaves' (default) — area ∝ number of descendant leaves
      value = descendants
    }
    result.push({
      id: n.id, label: n.label, type: n.type, depth, relCount: rc,
      descendants, children, hasKids, cutAtDepth,
      isExpanded: expandedSet.has(n.id), value,
    })
  }
  return result
}

// ─── Squarify layout ────────────────────────────────────────────────────────

function worstRatio(row: number[], side: number): number {
  if (!row.length) return Infinity
  const s  = row.reduce((a, b) => a + b, 0)
  const hi = Math.max(...row)
  const lo = Math.min(...row)
  return Math.max((side * side * hi) / (s * s), (s * s) / (side * side * lo))
}

function squarifySlice(nodes: TNode[], vals: number[], rect: Rect): void {
  if (!nodes.length || rect.w < 1 || rect.h < 1) return
  const { x, y, w, h } = rect
  const isH  = w >= h
  const side = isH ? h : w
  let row: number[] = []
  let cut = 0
  while (cut < vals.length) {
    const next = [...row, vals[cut]]
    if (row.length && worstRatio(next, side) > worstRatio(row, side)) break
    row = next; cut++
  }
  if (!row.length) { row = [vals[0]]; cut = 1 }
  const rSum = row.reduce((a, b) => a + b, 0)
  const rExt = rSum / side
  let off = 0
  for (let i = 0; i < row.length; i++) {
    const len = (row[i] / rSum) * side
    nodes[i].rect = isH
      ? { x, y: y + off, w: rExt, h: len }
      : { x: x + off, y, w: len, h: rExt }
    off += len
  }
  if (cut < nodes.length) {
    squarifySlice(
      nodes.slice(cut), vals.slice(cut),
      isH ? { x: x + rExt, y, w: w - rExt, h } : { x, y: y + rExt, w, h: h - rExt },
    )
  }
}

const HDR = [32, 26, 20, 16]
const PAD = [10,  7,  5,  3]
const GAP = [ 3,  2,  1,  1]  // inter-sibling gap per depth level

function applyLayout(nodes: TNode[], rect: Rect, depth: number): void {
  if (!nodes.length || rect.w < 2 || rect.h < 2) return
  nodes.sort((a, b) => b.value - a.value)
  const total = nodes.reduce((s, n) => s + n.value, 0)
  if (!total) return
  squarifySlice(nodes, nodes.map(n => (n.value / total) * rect.w * rect.h), rect)
  // Shrink each tile by a gap to create visible separation between siblings.
  const gap = GAP[Math.min(depth, 3)]
  for (const n of nodes) {
    if (!n.rect) continue
    n.rect = {
      x: n.rect.x + gap,
      y: n.rect.y + gap,
      w: Math.max(0, n.rect.w - gap * 2),
      h: Math.max(0, n.rect.h - gap * 2),
    }
  }
  const hh = HDR[Math.min(depth, 3)]
  const pd = PAD[Math.min(depth, 3)]
  for (const n of nodes) {
    if (!n.rect || !n.children.length) continue
    const inner = {
      x: n.rect.x + pd, y: n.rect.y + hh + pd,
      w: Math.max(0, n.rect.w - pd * 2),
      h: Math.max(0, n.rect.h - hh - pd * 2),
    }
    if (inner.w > 4 && inner.h > 4) applyLayout(n.children, inner, depth + 1)
  }
}

function flatten(nodes: TNode[], out: TNode[] = []): TNode[] {
  for (const n of nodes) { out.push(n); flatten(n.children, out) }
  return out
}

// ─── Component ──────────────────────────────────────────────────────────────

export function TreemapView(): React.ReactElement {
  const c4Nodes         = useDiagramStore(s => s.c4Nodes)
  const c4Relations     = useDiagramStore(s => s.c4Relations)
  const metamodel       = useDiagramStore(s => s.metamodel)
  const activeViewId    = useDiagramStore(s => s.activeViewId)
  const views           = useDiagramStore(s => s.views)
  const selectNode      = useDiagramStore(s => s.selectNode)
  const selectedNodeId  = useDiagramStore(s => s.selectedNodeId)
  const setTreemapFocus = useDiagramStore(s => s.setTreemapFocus)
  const setTreemapSizeBy = useDiagramStore(s => s.setTreemapSizeBy)
  const setTreemapMaxDepth = useDiagramStore(s => s.setTreemapMaxDepth)
  const toggleTreemapExpand = useDiagramStore(s => s.toggleTreemapExpand)

  const activeView = activeViewId ? views[activeViewId] : null
  const focusId    = activeView?.treemapFocusId ?? null
  const sizeBy: SizeBy = activeView?.treemapSizeBy ?? 'leaves'
  // null/undefined = unlimited. Default = 2 levels below focus (children +
  // grandchildren) — keeps the view legible; user can change via dropdown.
  const maxDepthRaw = activeView?.treemapMaxDepth
  const maxDepth: number =
    maxDepthRaw === null ? Infinity
    : (typeof maxDepthRaw === 'number' && maxDepthRaw > 0) ? maxDepthRaw
    : 2
  // Per-view set of node ids the user expanded inline beyond `maxDepth`.
  const expandedSet = useMemo(
    () => new Set(activeView?.treemapExpandedIds ?? []),
    [activeView],
  )

  const containerRef = useRef<HTMLDivElement>(null)
  const [size, setSize]       = useState({ w: 800, h: 600 })
  const [hovered, setHovered] = useState<TNode | null>(null)
  const [mouse, setMouse]     = useState({ x: 0, y: 0 })

  // Canvas-zoom drill animation, overlay strategy.
  // Main <g> always renders the CURRENT (renderFocusId) tree at identity.
  // During drill, an overlay <g> on top holds a frozen snapshot of the OLD
  // tree:
  //   drill-in:  overlay starts at identity, zooms so clicked rect fills the
  //              viewport, fades out at the end — revealing NEW underneath.
  //   drill-out: overlay starts at identity, shrinks into the position the
  //              previously focused node occupies in the NEW layout, fades
  //              out at the end.
  const [renderFocusId, setRenderFocusId] = useState<string | null>(focusId)
  const [overlay, setOverlay] = useState<
    { flat: TNode[]; transform: string; opacity: number; transition: string } | null
  >(null)
  const prevFocusRef    = useRef<string | null>(focusId)
  const clickedRectRef  = useRef<Rect | null>(null)
  const raf1Ref         = useRef<number | null>(null)
  const raf2Ref         = useRef<number | null>(null)
  const animTimerRef    = useRef<number | null>(null)

  useEffect(() => () => {
    if (raf1Ref.current   !== null) cancelAnimationFrame(raf1Ref.current)
    if (raf2Ref.current   !== null) cancelAnimationFrame(raf2Ref.current)
    if (animTimerRef.current !== null) window.clearTimeout(animTimerRef.current)
  }, [])

  // Track container size
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => {
      setSize({ w: Math.max(1, e.contentRect.width), h: Math.max(1, e.contentRect.height) })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const setFocus = useCallback((id: string | null) => {
    if (!activeViewId) return
    setTreemapFocus(activeViewId, id)
  }, [activeViewId, setTreemapFocus])

  // View filter — show ancestors of every selected nodeId. If the view has no
  // nodes selected at all, fall back to showing the whole model (a fresh
  // treemap view should never be empty).
  const viewFilter = useMemo(() => {
    if (!activeView) return undefined
    if (!activeView.nodeIds || activeView.nodeIds.length === 0) return undefined
    const s = new Set<string>()
    for (const id of activeView.nodeIds) {
      let cur: string | undefined = id
      while (cur && c4Nodes[cur]) { s.add(cur); cur = c4Nodes[cur].parentId }
    }
    return s
  }, [activeView, c4Nodes])

  // Relation count (only needed when sizeBy='relations' or for tooltip meta).
  const relCount = useMemo(() => {
    const rc: Record<string, number> = {}
    for (const r of Object.values(c4Relations) as C4Relation[]) {
      rc[r.sourceId] = (rc[r.sourceId] ?? 0) + 1
      rc[r.targetId] = (rc[r.targetId] ?? 0) + 1
    }
    return rc
  }, [c4Relations])

  // Breadcrumb path: top-level → focused node
  const breadcrumb = useMemo(() => {
    const path: { id: string | null; label: string }[] = [{ id: null, label: 'All' }]
    if (focusId && c4Nodes[focusId]) {
      const chain: C4Node[] = []
      let cur: string | undefined = focusId
      while (cur && c4Nodes[cur]) { chain.unshift(c4Nodes[cur]); cur = c4Nodes[cur].parentId }
      for (const n of chain) path.push({ id: n.id, label: n.label })
    }
    return path
  }, [focusId, c4Nodes])

  // Reset focus if focused node was removed
  useEffect(() => {
    if (focusId && !c4Nodes[focusId]) setFocus(null)
  }, [focusId, c4Nodes, setFocus])

  // Build tree (rooted at the RENDERED focus, which may lag the store focus
  // during drill-in so the OLD tree stays visible while it zooms in).
  const flatNodes = useMemo(() => {
    const MARGIN = 16
    const roots = buildTree(c4Nodes, relCount, viewFilter, renderFocusId ?? undefined, 0, sizeBy, maxDepth, expandedSet, false)
    applyLayout(roots, { x: MARGIN, y: MARGIN, w: size.w - MARGIN * 2, h: size.h - MARGIN * 2 }, 0)
    return flatten(roots)
  }, [c4Nodes, relCount, viewFilter, renderFocusId, size, sizeBy, maxDepth, expandedSet])

  // Drive canvas-zoom drill animation on store focus change.
  useLayoutEffect(() => {
    const prev = prevFocusRef.current
    if (prev === focusId) return
    prevFocusRef.current = focusId

    const W = size.w, H = size.h
    const MARGIN = 16

    // Cancel any in-flight animation
    if (raf1Ref.current    !== null) cancelAnimationFrame(raf1Ref.current)
    if (raf2Ref.current    !== null) cancelAnimationFrame(raf2Ref.current)
    if (animTimerRef.current !== null) window.clearTimeout(animTimerRef.current)

    // Snapshot the currently-rendered (OLD) tree before swapping renderFocus.
    const frozenOld = flatNodes
    const clicked   = clickedRectRef.current
    clickedRectRef.current = null

    // Swap main layer to NEW immediately. It will render underneath the overlay.
    setRenderFocusId(focusId)

    if (W < 1 || H < 1) {
      setOverlay(null)
      return
    }

    // Compute overlay target transform.
    //   drill-in: zoom into clicked rect (rect fills viewport at end)
    //   drill-out: shrink into prev-focus rect within NEW layout
    let targetTransform: string | null = null

    if (clicked && focusId !== null) {
      const sx = W / Math.max(1, clicked.w)
      const sy = H / Math.max(1, clicked.h)
      targetTransform =
        `translate(${-clicked.x * sx}px, ${-clicked.y * sy}px) scale(${sx}, ${sy})`
    } else if (prev !== null) {
      const newRoots = buildTree(c4Nodes, relCount, viewFilter, focusId ?? undefined, 0, sizeBy, maxDepth, expandedSet, false)
      applyLayout(newRoots, { x: MARGIN, y: MARGIN, w: W - MARGIN * 2, h: H - MARGIN * 2 }, 0)
      const refRect = flatten(newRoots).find((n) => n.id === prev)?.rect
      if (refRect) {
        const sx = refRect.w / W
        const sy = refRect.h / H
        targetTransform =
          `translate(${refRect.x}px, ${refRect.y}px) scale(${sx}, ${sy})`
      }
    }

    if (!targetTransform || frozenOld.length === 0) {
      setOverlay(null)
      return
    }

    // Phase 1: pin overlay at identity (covering canvas with OLD), no transition.
    setOverlay({
      flat: frozenOld,
      transform: 'translate(0px, 0px) scale(1, 1)',
      opacity: 1,
      transition: 'none',
    })

    // Phase 2: next frame, animate to target transform + fade out at the end.
    raf1Ref.current = requestAnimationFrame(() => {
      raf2Ref.current = requestAnimationFrame(() => {
        setOverlay({
          flat: frozenOld,
          transform: targetTransform!,
          opacity: 0,
          transition:
            'transform 360ms cubic-bezier(0.4, 0, 0.2, 1), ' +
            'opacity 140ms ease-in 240ms',
        })
      })
    })

    // Phase 3: clear overlay after the animation completes.
    animTimerRef.current = window.setTimeout(() => {
      setOverlay(null)
    }, 420)
  }, [focusId, size.w, size.h, c4Nodes, relCount, viewFilter, sizeBy, maxDepth, expandedSet])

  const isEmpty = flatNodes.length === 0

  const handleBack = useCallback(() => {
    if (!focusId) return
    setFocus(c4Nodes[focusId]?.parentId ?? null)
  }, [focusId, c4Nodes, setFocus])

  // Keyboard: Esc / Backspace to zoom out one level
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (focusId === null) return
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      if (e.key === 'Escape' || e.key === 'Backspace') {
        e.preventDefault()
        handleBack()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [focusId, handleBack])

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    setMouse({ x: e.clientX, y: e.clientY })
  }, [])

  // Render helper — emits clipPaths + node visuals for a given flat-node list.
  // `interactive=false` is used for the overlay (frozen snapshot) so it does
  // not capture hover/selection or react to clicks.
  const renderNodes = (flat: TNode[], interactive: boolean, idPrefix: string) => (
    <>
      <defs>
        {flat.map((n) => n.rect && (
          <clipPath key={`${idPrefix}cp-${n.id}`} id={`${idPrefix}cp-${n.id}`}>
            <rect
              x={n.rect.x + 1} y={n.rect.y + 1}
              width={Math.max(0, n.rect.w - 2)}
              height={Math.max(0, n.rect.h - 2)}
            />
          </clipPath>
        ))}
      </defs>

      {flat.map((n) => {
        if (!n.rect) return null
        const { x, y, w, h } = n.rect
        if (w < 2 || h < 2) return null

        const [fill, border, fg] = (TYPE_COLORS[n.type] ?? FALLBACK_COLORS) as [string, string, string]
        const typeDef = metamodel?.nodeTypes[n.type]
        const iconPath = typeDef?.iconPath ?? TYPE_ICON_PATHS[n.type as C4ElementType] ?? ''
        const isHov = interactive && hovered?.id === n.id
        const isSel = interactive && selectedNodeId === n.id
        const hh    = HDR[Math.min(n.depth, 3)]
        const rx    = Math.max(0, 6 - n.depth * 2)
        const fontSize = Math.min(12, Math.max(9, Math.min(w / 9, hh - 7)))
        // Show header strip whenever the node *could* have children — even if
        // they're currently cut by `maxDepth`, so the expand/collapse badge
        // remains reachable.
        const showHeader = n.hasKids && h > hh + 4
        // Badge appears when children exist but are hidden by the depth
        // limit (`+`), or when the user has explicitly expanded a node that
        // would otherwise be cut at this depth (`−`).
        const showExpandBadge =
          n.cutAtDepth || (n.isExpanded && n.depth + 1 >= maxDepth)
        const badgeIcon = n.isExpanded ? '−' : '+'

        const handleBodyClick = interactive
          ? (e: React.MouseEvent) => {
              e.stopPropagation()
              if (n.hasKids) {
                clickedRectRef.current = { x, y, w, h }
                setFocus(n.id)
              } else {
                selectNode(n.id)
              }
            }
          : undefined
        const handleHeaderClick = interactive
          ? (e: React.MouseEvent) => {
              e.stopPropagation()
              if (n.hasKids) {
                clickedRectRef.current = { x, y, w, h }
                setFocus(n.id)
              } else {
                selectNode(n.id)
              }
            }
          : undefined
        const handleBadgeClick = interactive
          ? (e: React.MouseEvent) => {
              e.stopPropagation()
              if (activeViewId) toggleTreemapExpand(activeViewId, n.id)
            }
          : undefined

        const strokeCol =
          isSel ? '#ffd84d' :
          isHov ? 'rgba(255,255,255,0.9)' : border
        const strokeW = isSel ? 2 : isHov ? 1.5 : 0.6
        const iconInset = showHeader && showExpandBadge && w > 40 ? 22 : 6
        const iconSize = showHeader
          ? Math.max(12, Math.min(15, hh - 8))
          : Math.max(11, Math.min(14, h - 8))
        const iconBoxPad = showHeader ? 3 : 2
        const iconBoxSize = iconSize + iconBoxPad * 2
        const showIcon = !!iconPath && w > (showHeader ? 66 : 44) && h > (showHeader ? hh - 2 : 16)
        const iconX = x + iconInset
        const iconY = showHeader ? y + (hh - iconBoxSize) / 2 : y + (h - iconBoxSize) / 2
        const labelX  = iconX + (showIcon ? iconBoxSize + 5 : 0)
        const iconFill = fg
        const iconScale = iconSize / 16

        return (
          <g
            key={`${idPrefix}${n.id}`}
            onMouseEnter={interactive ? () => setHovered(n) : undefined}
          >
            <rect
              x={x} y={y} width={w} height={h}
              fill={fill} stroke={strokeCol} strokeWidth={strokeW} rx={rx}
              style={interactive ? { cursor: 'pointer' } : undefined}
              onClick={handleBodyClick}
              pointerEvents={interactive ? undefined : 'none'}
            />
            {showHeader && (
              <>
                <rect
                  x={x} y={y} width={w} height={hh}
                  fill={border} fillOpacity={isHov ? 0.75 : 0.55} rx={rx}
                  style={interactive ? { cursor: 'pointer' } : undefined}
                  onClick={handleHeaderClick}
                  pointerEvents={interactive ? undefined : 'none'}
                />
                {showExpandBadge && w > 40 && (
                  <g
                    style={interactive ? { cursor: 'pointer' } : undefined}
                    onClick={handleBadgeClick}
                    pointerEvents={interactive ? undefined : 'none'}
                  >
                    <rect
                      x={x + 3} y={y + (hh - 16) / 2}
                      width={16} height={16} rx={3}
                      fill="rgba(0,0,0,0.25)"
                    />
                    <text
                      x={x + 11} y={y + hh / 2 + 1}
                      dominantBaseline="middle" textAnchor="middle"
                      fill={fg} fontSize={13} fontWeight={700}
                      fontFamily="system-ui, sans-serif"
                      pointerEvents="none"
                    >
                      {badgeIcon}
                    </text>
                  </g>
                )}
                {n.hasKids && w > 24 && (
                  <text
                    x={x + w - 6} y={y + hh / 2 + 1}
                    dominantBaseline="middle" textAnchor="end"
                    fill={fg} fontSize={10} opacity={0.85}
                    fontFamily="system-ui, sans-serif"
                    pointerEvents="none"
                  >
                    ⤢
                  </text>
                )}
              </>
            )}
            {showIcon && (
              <g
                clipPath={`url(#${idPrefix}cp-${n.id})`}
                pointerEvents="none"
              >
                <rect
                  x={iconX}
                  y={iconY}
                  width={iconBoxSize}
                  height={iconBoxSize}
                  rx={3}
                  fill={showHeader ? 'rgba(0,0,0,0.22)' : 'rgba(255,255,255,0.12)'}
                />
                <path
                  d={iconPath}
                  fill={iconFill}
                  transform={`translate(${iconX + iconBoxPad}, ${iconY + iconBoxPad}) scale(${iconScale})`}
                />
              </g>
            )}
            {w > 28 && (showHeader ? true : h > 12) && (
              <text
                x={labelX}
                y={showHeader ? y + hh - 8 : y + h / 2}
                dominantBaseline={showHeader ? 'auto' : 'middle'}
                fill={fg} fontSize={fontSize}
                fontWeight={n.depth <= 1 ? 600 : 400}
                fontFamily="system-ui, -apple-system, sans-serif"
                clipPath={`url(#${idPrefix}cp-${n.id})`}
                pointerEvents="none"
              >
                {n.label}
              </text>
            )}
          </g>
        )
      })}
    </>
  )

  return (
    <div className="treemap-wrap-outer">
      {/* Breadcrumb + controls bar */}
      <div className="treemap-breadcrumb">
        {breadcrumb.map((b, i) => {
          const isLast = i === breadcrumb.length - 1
          return (
            <React.Fragment key={b.id ?? '__root'}>
              {i > 0 && <span className="tm-bc-sep">›</span>}
              <button
                className={`tm-bc-item ${isLast ? 'active' : ''}`}
                onClick={() => setFocus(b.id)}
                disabled={isLast}
                title={isLast ? 'Current root' : `Zoom out to ${b.label}`}
              >
                {b.label}
              </button>
            </React.Fragment>
          )
        })}

        <div className="tm-bc-spacer" />

        <label className="tm-bc-sizeby" title="How to size rectangles">
          Size:
          <select
            value={sizeBy}
            onChange={(e) => activeViewId && setTreemapSizeBy(activeViewId, e.target.value as SizeBy)}
          >
            <option value="leaves">leaves (hierarchy)</option>
            <option value="uniform">uniform</option>
            <option value="relations">relations</option>
          </select>
        </label>

        <label className="tm-bc-sizeby" title="How many descendant levels to render below the current focus">
          Levels:
          <select
            value={maxDepth === Infinity ? 'all' : String(maxDepth)}
            onChange={(e) => {
              if (!activeViewId) return
              const v = e.target.value
              setTreemapMaxDepth(activeViewId, v === 'all' ? null : parseInt(v, 10))
            }}
          >
            <option value="1">1</option>
            <option value="2">2</option>
            <option value="3">3</option>
            <option value="4">4</option>
            <option value="all">all</option>
          </select>
        </label>

        {focusId !== null && (
          <button
            className="tm-bc-back"
            onClick={handleBack}
            title="Zoom out one level (Esc)"
          >
            ↑ Up
          </button>
        )}
      </div>

      <div
        ref={containerRef}
        className="treemap-wrap"
        onMouseMove={onMouseMove}
        onMouseLeave={() => setHovered(null)}
      >
        {isEmpty ? (
          <div className="treemap-empty">
            {focusId ? 'No child elements. Zoom out to navigate.' : 'No elements to display.'}
          </div>
        ) : (
          <svg width={size.w} height={size.h} style={{ display: 'block', userSelect: 'none' }}>
            {/* Main layer — current (NEW after a drill) tree at identity. */}
            <g>
              {renderNodes(flatNodes, true, '')}
            </g>

            {/* Overlay layer — frozen OLD tree during a drill animation.
                Zooms toward the clicked rect (drill-in) or shrinks into the
                prev-focus rect (drill-out), then fades out, revealing the
                main layer underneath. */}
            {overlay && (
              <g
                style={{
                  transform: overlay.transform,
                  transformBox: 'fill-box',
                  transformOrigin: '0 0',
                  transition: overlay.transition,
                  opacity: overlay.opacity,
                  pointerEvents: 'none',
                  willChange: 'transform, opacity',
                }}
              >
                {renderNodes(overlay.flat, false, 'ov-')}
              </g>
            )}
          </svg>
        )}

        {/* Tooltip — hierarchy first, relations second */}
        {hovered && hovered.rect && (
          <div
            className="treemap-tooltip"
            style={{ left: mouse.x + 14, top: mouse.y - 10 }}
          >
            <span className="tm-tt-type">{hovered.type}</span>
            <span className="tm-tt-label">{hovered.label}</span>
            <span className="tm-tt-meta">
              depth {hovered.depth}
              {hovered.children.length > 0 && ` · ${hovered.children.length} children`}
              {hovered.hasKids && ` · ${hovered.descendants} leaves`}
            </span>
            {hovered.relCount > 0 && (
              <span className="tm-tt-meta tm-tt-dim">
                {hovered.relCount} relation{hovered.relCount !== 1 ? 's' : ''}
              </span>
            )}
            <span className="tm-tt-hint">
              {hovered.hasKids
                ? 'click tile → zoom in'
                : 'click → select'}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
