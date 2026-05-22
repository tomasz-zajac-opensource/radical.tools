import React, { useMemo, useState, useCallback, useRef, useEffect } from 'react'
import { useDiagramStore } from '../store/diagramStore'
import type { C4Node } from '../types/c4'

// Same palette as TreemapView so types stay visually consistent.
const TYPE_COLORS: Record<string, readonly [string, string, string]> = {
  domain:    ['#0a1e38', '#1a4a7a', '#90bcdf'],
  system:    ['#0d3a6e', '#1168bd', '#b0d4f5'],
  container: ['#154f88', '#3880c4', '#c5e2f8'],
  component: ['#1e5f9e', '#5e9fd8', '#daeefb'],
  database:  ['#321060', '#7e3dbf', '#c9a8f0'],
  webapp:    ['#0a3a1e', '#20924f', '#9de2b8'],
  queue:     ['#4a2000', '#c47a10', '#f0c88a'],
  person:    ['#4a0a10', '#b83020', '#f0a8a8'],
}
const FALLBACK: readonly [string, string, string] = ['#181830', '#36366a', '#9090b8']

// Layout constants
const HEAD_W       = 160   // participant box width
const HEAD_H       = 44    // participant box height
const HEAD_GAP     = 56    // horizontal gap between participants
const TOP_PAD      = 24
const HEAD_BOT_PAD = 28    // gap below header before first step
const STEP_GAP     = 56    // vertical distance between consecutive steps
const SIDE_PAD     = 32
const STEP_RADIUS  = 11    // step-number badge radius
const SELF_W       = 70    // width of self-call loop

interface Step {
  relationId: string
  sourceId:   string
  targetId:   string
  label:      string
  index:      number       // 1-based step number
}

export function SequenceView(): React.ReactElement {
  const activeViewId = useDiagramStore((s) => s.activeViewId)
  const view         = useDiagramStore((s) => (s.activeViewId ? s.views[s.activeViewId] : undefined))
  const sequences    = useDiagramStore((s) => s.sequences)
  const nodes        = useDiagramStore((s) => s.c4Nodes)
  const relations    = useDiagramStore((s) => s.c4Relations)
  const selectedNodeId = useDiagramStore((s) => s.selectedNodeId)
  const selectedEdgeId = useDiagramStore((s) => s.selectedEdgeId)
  const selectNode   = useDiagramStore((s) => s.selectNode)
  const selectEdge   = useDiagramStore((s) => s.selectEdge)

  const sequence = view?.sequenceId ? sequences[view.sequenceId] : undefined

  // Build ordered participants list (order of first appearance across steps).
  const { participants, steps } = useMemo(() => {
    const result: { participants: C4Node[]; steps: Step[] } = { participants: [], steps: [] }
    if (!sequence) return result
    const seen = new Map<string, C4Node>()
    const out: Step[] = []
    sequence.relationIds.forEach((rid, i) => {
      const r = relations[rid]
      if (!r) return
      const src = nodes[r.sourceId]
      const tgt = nodes[r.targetId]
      if (!src || !tgt) return
      if (!seen.has(src.id)) seen.set(src.id, src)
      if (!seen.has(tgt.id)) seen.set(tgt.id, tgt)
      out.push({
        relationId: rid,
        sourceId:   src.id,
        targetId:   tgt.id,
        label:      r.label || r.technology || '',
        index:      i + 1,
      })
    })
    result.participants = Array.from(seen.values())
    result.steps = out
    return result
  }, [sequence, relations, nodes])

  const xOf = useCallback(
    (id: string) => {
      const i = participants.findIndex((p) => p.id === id)
      if (i < 0) return 0
      return SIDE_PAD + i * (HEAD_W + HEAD_GAP) + HEAD_W / 2
    },
    [participants],
  )

  const svgW = Math.max(
    600,
    SIDE_PAD * 2 + participants.length * HEAD_W + Math.max(0, participants.length - 1) * HEAD_GAP,
  )
  const stepsTop  = TOP_PAD + HEAD_H + HEAD_BOT_PAD
  const stepsBot  = stepsTop + Math.max(1, steps.length) * STEP_GAP
  const svgH      = stepsBot + 32 + HEAD_H + TOP_PAD   // room for bottom header copy

  const [hoveredStep, setHoveredStep] = useState<number | null>(null)

  // ── Zoom ───────────────────────────────────────────────────────────────
  const ZOOM_MIN = 0.25
  const ZOOM_MAX = 4
  const [zoom, setZoom] = useState(1)
  const wrapRef = useRef<HTMLElement | null>(null)
  const clampZoom = useCallback((z: number) => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z)), [])
  const zoomBy = useCallback((factor: number) => {
    setZoom((z) => clampZoom(z * factor))
  }, [clampZoom])
  const zoomReset = useCallback(() => setZoom(1), [])
  const onWheel = useCallback((e: WheelEvent) => {
    e.preventDefault()
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1
    setZoom((z) => clampZoom(z * factor))
  }, [clampZoom])
  // Listen for keyboard zoom (Cmd/Ctrl + + / - / 0) while pointer is over canvas
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    el.addEventListener('wheel', onWheel, { passive: false })
    const handler = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      if (e.key === '+' || e.key === '=') { e.preventDefault(); setZoom((z) => clampZoom(z * 1.2)) }
      else if (e.key === '-' || e.key === '_') { e.preventDefault(); setZoom((z) => clampZoom(z / 1.2)) }
      else if (e.key === '0') { e.preventDefault(); setZoom(1) }
    }
    el.addEventListener('keydown', handler)
    return () => {
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('keydown', handler)
    }
  }, [clampZoom, onWheel])

  // Empty / unconfigured states ────────────────────────────────────────────
  if (!view) {
    return (
      <main className="canvas-area sequence-area" style={emptyWrapStyle}>
        <div style={emptyMsgStyle}>No active view.</div>
      </main>
    )
  }

  if (!sequence) {
    return (
      <main className="canvas-area sequence-area" style={emptyWrapStyle}>
        <div style={emptyMsgStyle}>
          <strong>No sequence linked.</strong>
          <div style={{ marginTop: 8, fontSize: 12, opacity: 0.75, maxWidth: 420, textAlign: 'center' }}>
            This view is set to <em>Flow</em>. Open the right panel and link a
            sequence (or create one) to render its steps as a UML sequence diagram.
          </div>
        </div>
      </main>
    )
  }

  if (steps.length === 0) {
    return (
      <main className="canvas-area sequence-area" style={emptyWrapStyle}>
        <div style={emptyMsgStyle}>
          <strong>Sequence is empty.</strong>
          <div style={{ marginTop: 8, fontSize: 12, opacity: 0.75, maxWidth: 420, textAlign: 'center' }}>
            Switch this view to <em>Structure</em>, set <code>{sequence.name}</code> as the
            active sequence in the right panel, then click edges in order to add steps.
          </div>
        </div>
      </main>
    )
  }

  const renderHeader = (yTop: number): React.ReactElement[] =>
    participants.map((p) => {
      const cx = xOf(p.id)
      const [fill, border, fg] = TYPE_COLORS[p.type] ?? FALLBACK
      const isSel = p.id === selectedNodeId
      return (
        <g
          key={`hd-${yTop}-${p.id}`}
          style={{ cursor: 'pointer' }}
          onClick={(e) => { e.stopPropagation(); selectNode(p.id) }}
        >
          <rect
            x={cx - HEAD_W / 2}
            y={yTop}
            width={HEAD_W}
            height={HEAD_H}
            rx={6}
            fill={fill}
            stroke={isSel ? '#ffd84d' : border}
            strokeWidth={isSel ? 2 : 1}
          />
          <text
            x={cx} y={yTop + HEAD_H / 2 - 4}
            fill={fg} fontSize={13} fontWeight={600}
            textAnchor="middle" dominantBaseline="middle"
            fontFamily="system-ui, -apple-system, sans-serif"
            pointerEvents="none"
          >
            {truncate(p.label, 22)}
          </text>
          <text
            x={cx} y={yTop + HEAD_H / 2 + 11}
            fill={fg} fontSize={9} opacity={0.75}
            textAnchor="middle" dominantBaseline="middle"
            fontFamily="system-ui, -apple-system, sans-serif"
            pointerEvents="none"
          >
            «{p.type}»
          </text>
        </g>
      )
    })

  return (
    <main
      ref={wrapRef as React.RefObject<HTMLElement>}
      className="canvas-area sequence-area"
      tabIndex={0}
      style={{
        overflow: 'auto',
        background: 'var(--bg-canvas)',
        color: 'var(--text-primary)',
        position: 'relative',
        outline: 'none',
      }}
      onClick={() => { selectNode(null); selectEdge(null) }}
    >
      <svg
        width={svgW * zoom}
        height={svgH * zoom}
        viewBox={`0 0 ${svgW} ${svgH}`}
        style={{ display: 'block', margin: '0 auto', color: 'var(--text-primary)' }}
      >
        <defs>
          <marker
            id="seq-arrow"
            viewBox="0 0 10 10"
            refX="9" refY="5"
            markerWidth="8" markerHeight="8"
            orient="auto-start-reverse"
          >
            <path d="M0,0 L10,5 L0,10 z" fill="currentColor" />
          </marker>
          <marker
            id="seq-arrow-hl"
            viewBox="0 0 10 10"
            refX="9" refY="5"
            markerWidth="9" markerHeight="9"
            orient="auto-start-reverse"
          >
            <path d="M0,0 L10,5 L0,10 z" fill="#ffd84d" />
          </marker>
        </defs>

        {/* Lifelines (dashed verticals) */}
        {participants.map((p) => {
          const cx = xOf(p.id)
          return (
            <line
              key={`ll-${p.id}`}
              x1={cx} x2={cx}
              y1={TOP_PAD + HEAD_H}
              y2={stepsBot + 12}
              stroke="var(--border-color-strong)"
              strokeWidth={1}
              strokeDasharray="4 4"
            />
          )
        })}

        {/* Top header */}
        {renderHeader(TOP_PAD)}

        {/* Bottom header (mirror) */}
        {renderHeader(stepsBot + 18)}

        {/* Steps */}
        {steps.map((s, idx) => {
          const y      = stepsTop + idx * STEP_GAP + STEP_GAP / 2
          const isSelf = s.sourceId === s.targetId
          const xs     = xOf(s.sourceId)
          const xt     = xOf(s.targetId)
          const isSel  = s.relationId === selectedEdgeId
          const isHov  = hoveredStep === idx
          const stroke = isSel ? '#ffd84d' : isHov ? 'var(--accent)' : 'currentColor'
          const sw     = isSel ? 2 : isHov ? 1.6 : 1.2
          const marker = isSel ? 'url(#seq-arrow-hl)' : 'url(#seq-arrow)'

          // Compute label position for non-self messages
          const midX = (xs + xt) / 2
          const labelY = y - 6

          return (
            <g
              key={`step-${s.relationId}-${idx}`}
              style={{ cursor: 'pointer' }}
              onMouseEnter={() => setHoveredStep(idx)}
              onMouseLeave={() => setHoveredStep((h) => (h === idx ? null : h))}
              onClick={(e) => { e.stopPropagation(); selectEdge(s.relationId) }}
            >
              {isSelf ? (
                <>
                  {/* Self-message loop: → out, down, ← back */}
                  <path
                    d={`M ${xs + 2} ${y - 8}
                        L ${xs + SELF_W} ${y - 8}
                        L ${xs + SELF_W} ${y + 8}
                        L ${xs + 2} ${y + 8}`}
                    fill="none"
                    stroke={stroke}
                    strokeWidth={sw}
                    markerEnd={marker}
                  />
                  {s.label && (
                    <text
                      x={xs + SELF_W + 8} y={y}
                      fill={stroke} fontSize={11}
                      dominantBaseline="middle"
                      fontFamily="system-ui, -apple-system, sans-serif"
                      pointerEvents="none"
                    >
                      {truncate(s.label, 40)}
                    </text>
                  )}
                </>
              ) : (
                <>
                  <line
                    x1={xs + (xt > xs ? STEP_RADIUS + 2 : -(STEP_RADIUS + 2))}
                    x2={xt + (xt > xs ? -2 : 2)}
                    y1={y} y2={y}
                    stroke={stroke}
                    strokeWidth={sw}
                    markerEnd={marker}
                  />
                  {s.label && (
                    <text
                      x={midX} y={labelY}
                      fill={stroke} fontSize={11}
                      textAnchor="middle"
                      fontFamily="system-ui, -apple-system, sans-serif"
                      pointerEvents="none"
                    >
                      {truncate(s.label, Math.max(8, Math.floor(Math.abs(xt - xs) / 8)))}
                    </text>
                  )}
                </>
              )}
              {/* Step-number badge on source side */}
              <circle
                cx={xs + (isSelf ? 0 : (xt > xs ? STEP_RADIUS : -STEP_RADIUS))}
                cy={y}
                r={STEP_RADIUS}
                fill={isSel ? '#ffd84d' : 'var(--accent)'}
                stroke="var(--border-color-strong)"
                strokeWidth={0.8}
              />
              <text
                x={xs + (isSelf ? 0 : (xt > xs ? STEP_RADIUS : -STEP_RADIUS))}
                y={y + 0.5}
                fill={isSel ? '#000' : '#fff'}
                fontSize={11} fontWeight={700}
                textAnchor="middle" dominantBaseline="middle"
                fontFamily="system-ui, -apple-system, sans-serif"
                pointerEvents="none"
              >
                {s.index}
              </text>
            </g>
          )
        })}
      </svg>

      {/* Floating caption */}
      <div
        style={{
          position: 'absolute',
          top: 8,
          left: 12,
          fontSize: 11,
          color: 'var(--text-muted)',
          background: 'var(--bg-panel)',
          border: '1px solid var(--border-color)',
          padding: '4px 8px',
          borderRadius: 4,
          pointerEvents: 'none',
        }}
      >
        Flow: <strong style={{ color: 'var(--text-primary)' }}>{sequence.name}</strong>
        <span style={{ marginLeft: 8, opacity: 0.7 }}>
          {steps.length} step{steps.length === 1 ? '' : 's'} · {participants.length} participant{participants.length === 1 ? '' : 's'}
        </span>
      </div>

      {/* Zoom controls */}
      <div
        style={{
          position: 'absolute',
          bottom: 12,
          right: 16,
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '4px 6px',
          background: 'var(--bg-panel)',
          border: '1px solid var(--border-color)',
          borderRadius: 6,
          fontSize: 11,
          color: 'var(--text-muted)',
          userSelect: 'none',
          boxShadow: '0 2px 6px rgba(0,0,0,0.2)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={() => zoomBy(1 / 1.2)}
          disabled={zoom <= ZOOM_MIN + 0.001}
          title="Zoom out (Ctrl/Cmd + −)"
          style={zoomBtnStyle}
        >−</button>
        <button
          onClick={zoomReset}
          title="Reset zoom (Ctrl/Cmd + 0)"
          style={{ ...zoomBtnStyle, minWidth: 46 }}
        >{Math.round(zoom * 100)}%</button>
        <button
          onClick={() => zoomBy(1.2)}
          disabled={zoom >= ZOOM_MAX - 0.001}
          title="Zoom in (Ctrl/Cmd + +)"
          style={zoomBtnStyle}
        >+</button>
      </div>
    </main>
  )
}

// ── helpers ────────────────────────────────────────────────────────────────

function truncate(text: string, max: number): string {
  if (!text) return ''
  if (text.length <= max) return text
  return text.slice(0, Math.max(1, max - 1)) + '…'
}

const emptyWrapStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'var(--bg-canvas)',
  color: 'var(--text-muted)',
}

const emptyMsgStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  fontSize: 14,
  padding: 24,
}

const zoomBtnStyle: React.CSSProperties = {
  background: 'transparent',
  color: 'var(--text-primary)',
  border: '1px solid var(--border-color)',
  borderRadius: 4,
  padding: '2px 8px',
  cursor: 'pointer',
  fontSize: 12,
  fontWeight: 600,
  minWidth: 24,
  lineHeight: '18px',
}
