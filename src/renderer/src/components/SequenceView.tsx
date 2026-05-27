import React, { useMemo, useState, useCallback, useRef, useEffect } from 'react'
import { useDiagramStore } from '../store/diagramStore'
import type { C4Node, C4Relation } from '../types/c4'

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
  description?: string     // per-occurrence override (from stepDescriptions)
  index:      number       // 1-based step number
  ghost?:     boolean      // true = removed from sequence vs. previous milestone
}

export function SequenceView(): React.ReactElement {
  const activeViewId = useDiagramStore((s) => s.activeViewId)
  const view         = useDiagramStore((s) => (s.activeViewId ? s.views[s.activeViewId] : undefined))
  const sequences    = useDiagramStore((s) => s.sequences)
  const nodes        = useDiagramStore((s) => s.c4Nodes)
  const relations    = useDiagramStore((s) => s.c4Relations)
  const diffHighlight   = useDiagramStore((s) => s.diffHighlight)
  const ghostNodes      = useDiagramStore((s) => s.diffGhostNodes)
  const ghostRelations  = useDiagramStore((s) => s.diffGhostRelations)
  const selectedNodeId = useDiagramStore((s) => s.selectedNodeId)
  const selectedEdgeId = useDiagramStore((s) => s.selectedEdgeId)
  const selectNode   = useDiagramStore((s) => s.selectNode)
  const selectEdge   = useDiagramStore((s) => s.selectEdge)
  const activeSnapshotId     = useDiagramStore((s) => s.activeSnapshotId)
  const snapshotName         = useDiagramStore((s) =>
    s.activeSnapshotId ? s.snapshots.find((sn) => sn.id === s.activeSnapshotId)?.name : undefined
  )
  const snapshots            = useDiagramStore((s) => s.snapshots)
  const diffBaseSnapshotId   = useDiagramStore((s) => s.diffBaseSnapshotId)
  const milestoneDirty           = useDiagramStore((s) => s.milestoneDirty)
  const commitMilestoneChanges   = useDiagramStore((s) => s.commitMilestoneChanges)
  const discardMilestoneChanges  = useDiagramStore((s) => s.discardMilestoneChanges)
  const showDiff             = useDiagramStore((s) => s.showDiff)
  const toggleShowDiff       = useDiagramStore((s) => s.toggleShowDiff)
  const [milestoneNewName, setMilestoneNewName] = useState<string | null>(null)

  const sequence = view?.sequenceId ? sequences[view.sequenceId] : undefined

  // Build ordered participants list (order of first appearance across steps).
  const { participants, steps } = useMemo(() => {
    const result: { participants: C4Node[]; steps: Step[] } = { participants: [], steps: [] }
    if (!sequence) return result
    const seen = new Map<string, C4Node>()
    const out: Step[] = []
    const effectiveGhostNodes    = showDiff ? ghostNodes    : {} as Record<string, C4Node>
    const effectiveGhostRelations = showDiff ? ghostRelations : {} as Record<string, C4Relation>
    const effectiveDiffHighlight  = showDiff ? diffHighlight  : {} as Record<string, 'new' | 'changed' | 'removed'>
    const effectiveDiffBaseId     = showDiff ? diffBaseSnapshotId : null
    sequence.relationIds.forEach((rid, i) => {
      const r = relations[rid] ?? effectiveGhostRelations[rid]
      if (!r) return
      const src = nodes[r.sourceId] ?? effectiveGhostNodes[r.sourceId]
      const tgt = nodes[r.targetId] ?? effectiveGhostNodes[r.targetId]
      if (!src || !tgt) return
      if (!seen.has(src.id)) seen.set(src.id, src)
      if (!seen.has(tgt.id)) seen.set(tgt.id, tgt)
      out.push({
        relationId: rid,
        sourceId:   src.id,
        targetId:   tgt.id,
        label:      r.label || r.technology || '',
        description: sequence.stepDescriptions?.[i] || undefined,
        index:      i + 1,
      })
    })
    // Add ghost steps: relation IDs removed from this sequence vs. the diff base.
    if (effectiveDiffBaseId && view?.sequenceId) {
      const baseSnap = snapshots.find(s => s.id === effectiveDiffBaseId)
      const baseSeq  = (baseSnap?.sequences as any)?.[view.sequenceId] as { relationIds: string[]; stepDescriptions?: (string | undefined)[] } | undefined
      if (baseSeq) {
        const currSet = new Set(sequence.relationIds)
        baseSeq.relationIds.forEach((rid, i) => {
          if (currSet.has(rid)) return  // still in sequence
          if (effectiveDiffHighlight[rid] !== 'removed') return  // only show seq-removed steps
          // Prefer live relation data (still in model) → ghost (model-deleted)
          const r = relations[rid] ?? effectiveGhostRelations[rid] ?? (baseSnap?.relations as any)?.[rid]
          if (!r) return
          const src = nodes[r.sourceId] ?? effectiveGhostNodes[r.sourceId] ?? (baseSnap?.nodes as any)?.[r.sourceId]
          const tgt = nodes[r.targetId] ?? effectiveGhostNodes[r.targetId] ?? (baseSnap?.nodes as any)?.[r.targetId]
          if (!src || !tgt) return
          if (!seen.has(src.id)) seen.set(src.id, src)
          if (!seen.has(tgt.id)) seen.set(tgt.id, tgt)
          out.push({
            relationId: rid,
            sourceId:   src.id,
            targetId:   tgt.id,
            label:      r.label || r.technology || '',
            description: baseSeq.stepDescriptions?.[i] || undefined,
            index:      i + 1,
            ghost:      true,
          })
        })
      }
    }
    result.participants = Array.from(seen.values())
    result.steps = out
    return result
  }, [sequence, relations, nodes, ghostRelations, ghostNodes, diffHighlight, diffBaseSnapshotId, snapshots, view, showDiff])

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
  const onWheel = useCallback((e: WheelEvent) => {
    e.preventDefault()
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1
    setZoom((z) => clampZoom(z * factor))
  }, [clampZoom])

  // Ref that always points to the current fit-to-container function so we can
  // register it once but have it read the latest svgW / svgH on each call.
  const fitFnRef = useRef<() => void>(() => { setZoom(1) })
  fitFnRef.current = () => {
    const el = wrapRef.current as HTMLElement | null
    if (!el) { setZoom(1); return }
    const z = clampZoom(Math.min(el.clientWidth / svgW, el.clientHeight / svgH) * 0.92)
    setZoom(z)
    el.scrollTo({ top: 0, left: 0 })
  }

  // Register sequence-specific fit + zoom globals on mount.
  // The Toolbar "Fit All" and Zoom +/− buttons delegate to these.
  useEffect(() => {
    ;(window as any).__radicalSeqFitFn  = () => fitFnRef.current()
    ;(window as any).__radicalZoomIn    = () => setZoom((z) => clampZoom(z * 1.2))
    ;(window as any).__radicalZoomOut   = () => setZoom((z) => clampZoom(z / 1.2))
    return () => {
      delete (window as any).__radicalSeqFitFn
      delete (window as any).__radicalZoomIn
      delete (window as any).__radicalZoomOut
    }
  }, [clampZoom])

  // Listen for wheel + keyboard zoom while pointer is over the canvas
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    el.addEventListener('wheel', onWheel, { passive: false })
    const handler = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      if (e.key === '+' || e.key === '=') { e.preventDefault(); setZoom((z) => clampZoom(z * 1.2)) }
      else if (e.key === '-' || e.key === '_') { e.preventDefault(); setZoom((z) => clampZoom(z / 1.2)) }
      else if (e.key === '0') { e.preventDefault(); fitFnRef.current() }
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
      const dk = showDiff ? diffHighlight[p.id] as 'new' | 'changed' | 'removed' | undefined : undefined
      const diffColor = dk === 'new' ? '#4ade80' : dk === 'removed' ? '#f87171' : dk === 'changed' ? '#fb923c' : null
      const diffLabel = dk === 'new' ? 'NEW' : dk === 'removed' ? 'REMOVED' : dk === 'changed' ? 'CHANGED' : null
      return (
        <g
          key={`hd-${yTop}-${p.id}`}
          style={{ cursor: 'pointer', opacity: dk === 'removed' ? 0.65 : 1 }}
          onClick={(e) => { e.stopPropagation(); selectNode(p.id) }}
        >
          <rect
            x={cx - HEAD_W / 2}
            y={yTop}
            width={HEAD_W}
            height={HEAD_H}
            rx={6}
            fill={fill}
            stroke={isSel ? '#ffd84d' : diffColor ?? border}
            strokeWidth={isSel ? 2 : diffColor ? 2.5 : 1}
            strokeDasharray={dk === 'removed' ? '6 3' : undefined}
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
          {diffLabel && (
            <text
              x={cx + HEAD_W / 2 - 5} y={yTop + 9}
              fill={diffColor!} fontSize={8} fontWeight={800}
              textAnchor="end" dominantBaseline="middle"
              fontFamily="system-ui, -apple-system, sans-serif"
              pointerEvents="none"
            >
              {diffLabel}
            </text>
          )}
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
          <marker
            id="seq-arrow-new"
            viewBox="0 0 10 10"
            refX="9" refY="5"
            markerWidth="9" markerHeight="9"
            orient="auto-start-reverse"
          >
            <path d="M0,0 L10,5 L0,10 z" fill="#4ade80" />
          </marker>
          <marker
            id="seq-arrow-removed"
            viewBox="0 0 10 10"
            refX="9" refY="5"
            markerWidth="9" markerHeight="9"
            orient="auto-start-reverse"
          >
            <path d="M0,0 L10,5 L0,10 z" fill="#f87171" />
          </marker>
          <marker
            id="seq-arrow-changed"
            viewBox="0 0 10 10"
            refX="9" refY="5"
            markerWidth="9" markerHeight="9"
            orient="auto-start-reverse"
          >
            <path d="M0,0 L10,5 L0,10 z" fill="#fb923c" />
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
          const dk       = diffHighlight[s.relationId] as 'new' | 'changed' | 'removed' | undefined
          const diffDk   = showDiff ? dk : undefined
          const diffColor = diffDk === 'new' ? '#4ade80' : diffDk === 'removed' ? '#f87171' : diffDk === 'changed' ? '#fb923c' : null
          const stroke = isSel ? '#ffd84d' : diffColor ?? (isHov ? 'var(--accent)' : 'currentColor')
          const sw     = isSel || diffColor ? 2 : isHov ? 1.6 : 1.2
          const strokeDash = diffDk === 'removed' ? '6 4' : undefined
          const stepOpacity = diffDk === 'removed' ? 0.65 : 1
          const marker = isSel ? 'url(#seq-arrow-hl)'
            : diffDk === 'new' ? 'url(#seq-arrow-new)'
            : diffDk === 'removed' ? 'url(#seq-arrow-removed)'
            : diffDk === 'changed' ? 'url(#seq-arrow-changed)'
            : 'url(#seq-arrow)'

          // Compute label position for non-self messages
          const midX = (xs + xt) / 2
          const labelY = y - 6
          // Per-step description overrides the default relation label
          const displayLabel = s.description ?? s.label

          return (
            <g
              key={`step-${s.relationId}-${idx}`}
              style={{ cursor: 'pointer', opacity: stepOpacity }}
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
                    strokeDasharray={strokeDash}
                    markerEnd={marker}
                  />
                  {displayLabel && (
                    <text
                      x={xs + SELF_W + 8} y={y}
                      fill={stroke} fontSize={11}
                      dominantBaseline="middle"
                      fontFamily="system-ui, -apple-system, sans-serif"
                      pointerEvents="none"
                    >
                      {truncate(displayLabel, 40)}
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
                    strokeDasharray={strokeDash}
                    markerEnd={marker}
                  />
                  {displayLabel && (
                    <text
                      x={midX} y={labelY}
                      fill={stroke} fontSize={11}
                      textAnchor="middle"
                      fontFamily="system-ui, -apple-system, sans-serif"
                      pointerEvents="none"
                    >
                      {truncate(displayLabel, Math.max(8, Math.floor(Math.abs(xt - xs) / 8)))}
                    </text>
                  )}
                </>
              )}
              {/* Step-number badge on source side */}
              <circle
                cx={xs + (isSelf ? 0 : (xt > xs ? STEP_RADIUS : -STEP_RADIUS))}
                cy={y}
                r={STEP_RADIUS}
                fill={isSel ? '#ffd84d' : diffColor ?? 'var(--accent)'}
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

      {/* Floating caption / milestone badge */}
      <div
        style={{
          position: 'absolute',
          top: 8,
          left: 12,
          fontSize: 11,
          color: 'var(--text-muted)',
          background: 'var(--bg-panel)',
          border: `1px solid ${(activeSnapshotId && milestoneDirty) ? 'var(--accent)' : 'var(--border-color)'}`,
          padding: '4px 8px',
          borderRadius: 4,
          pointerEvents: activeSnapshotId ? 'all' : 'none',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          zIndex: 10,
        }}
      >
        {activeSnapshotId && snapshotName ? (
          <>
            <span style={{ color: 'var(--accent)', fontSize: 10 }}>●</span>
            <span>
              Milestone: <strong style={{ color: 'var(--text-primary)' }}>{snapshotName}</strong>
              {milestoneDirty && <span style={{ color: 'var(--accent)', marginLeft: 4 }}>· unsaved</span>}
            </span>
            <button
              title={showDiff ? 'Hide diff' : 'Show changes vs. previous milestone'}
              onClick={toggleShowDiff}
              style={{ fontSize: 11, padding: '2px 6px', cursor: 'pointer', background: showDiff ? 'var(--accent)' : 'var(--bg-surface)', color: showDiff ? '#fff' : 'var(--text-muted)', border: '1px solid var(--border-color)', borderRadius: 3 }}
            >{showDiff ? '⊙ diff on' : '⊙ diff'}</button>
            {milestoneDirty && (
              <>
                <span style={{ width: 1, alignSelf: 'stretch', background: 'var(--border-color)', margin: '0 2px' }} />
                <button
                  title="Apply changes to this and all later milestones"
                  onClick={() => commitMilestoneChanges('propagate')}
                  style={{ fontSize: 11, padding: '2px 6px', cursor: 'pointer', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 3 }}
                >Propagate</button>
                {milestoneNewName !== null ? (
                  <>
                    <input
                      autoFocus
                      value={milestoneNewName}
                      onChange={e => setMilestoneNewName(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') { commitMilestoneChanges('new', milestoneNewName); setMilestoneNewName(null) }
                        if (e.key === 'Escape') setMilestoneNewName(null)
                      }}
                      placeholder="New milestone name…"
                      style={{ fontSize: 11, padding: '2px 6px', borderRadius: 3, border: '1px solid var(--border-color)', background: 'var(--bg-input, var(--bg-surface))', color: 'var(--text-primary)', width: 160 }}
                    />
                    <button
                      onClick={() => { commitMilestoneChanges('new', milestoneNewName); setMilestoneNewName(null) }}
                      style={{ fontSize: 11, padding: '2px 6px', cursor: 'pointer', background: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: 3, color: 'var(--text-primary)' }}
                    >Save</button>
                  </>
                ) : (
                  <button
                    title="Save as new milestone"
                    onClick={() => setMilestoneNewName(`${snapshotName} (edited)`)}
                    style={{ fontSize: 11, padding: '2px 6px', cursor: 'pointer', background: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: 3, color: 'var(--text-primary)' }}
                  >New milestone</button>
                )}
                <button
                  title="Discard changes and return to live"
                  onClick={discardMilestoneChanges}
                  style={{ fontSize: 11, padding: '2px 6px', cursor: 'pointer', background: 'none', border: '1px solid var(--border-color)', borderRadius: 3, color: 'var(--text-muted)' }}
                >Discard</button>
              </>
            )}
          </>
        ) : (
          <>
            Flow: <strong style={{ color: 'var(--text-primary)' }}>{sequence.name}</strong>
            <span style={{ marginLeft: 8, opacity: 0.7 }}>
              {steps.length} step{steps.length === 1 ? '' : 's'} · {participants.length} participant{participants.length === 1 ? '' : 's'}
            </span>
          </>
        )}
      </div>

      {/* Zoom controls */}
      <div
        style={{
          position: 'absolute',
          bottom: 12,
          right: 16,
          fontSize: 11,
          color: 'var(--text-muted)',
          background: 'var(--bg-panel)',
          border: '1px solid var(--border-color)',
          padding: '3px 8px',
          borderRadius: 4,
          pointerEvents: 'none',
          userSelect: 'none',
        }}
      >
        {Math.round(zoom * 100)}%
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
