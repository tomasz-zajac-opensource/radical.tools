import React, { ChangeEvent, useState, useMemo } from 'react'
import { useDiagramStore, nodeEffectivelyCollapsedInView } from '../store/diagramStore'
import { C4ElementType, NODE_COLORS, TYPE_LABELS, TYPE_ICON_PATHS, NODE_FG, isContainerType } from '../types/c4'
// SlidesColumn was used here; now lives in the bottom PresenterDock

// ── Icons ─────────────────────────────────────────────────────────────────────

function C4Icon({ type, size = 12 }: { type: C4ElementType; size?: number }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill={NODE_COLORS[type]} style={{ flexShrink: 0 }}>
      <path d={TYPE_ICON_PATHS[type]} />
    </svg>
  )
}

// ── Palette ───────────────────────────────────────────────────────────────────

// Sublabels for built-in C4/DDD types. Custom types fall back to def.description.
const PALETTE_SUBLABELS: Record<string, string> = {
  person:    'Actor / user',
  system:    'Software system',
  container: 'App, DB, service…',
  component: 'Class, module…',
  database:  'Database store',
  webapp:    'Web application',
  queue:     'Message queue / bus',
  domain:    'DDD problem space',
}

// Order: domain first (when present), then standard C4 order, then any custom types last.
const PALETTE_ORDER = ['domain', 'person', 'system', 'container', 'component', 'database', 'webapp', 'queue']

function PaletteItem({ typeId, label, sublabel, color, iconPath }: {
  typeId: string
  label: string
  sublabel: string
  color: string
  iconPath: string
}) {
  const onDragStart = (event: React.DragEvent) => {
    event.dataTransfer.setData('application/c4-type', typeId)
    event.dataTransfer.effectAllowed = 'copy'
  }
  return (
    <div className="palette-item" draggable onDragStart={onDragStart}>
      <div className="palette-badge" style={{ background: color }}>
        <svg viewBox="0 0 16 16" width="16" height="16" fill="#fff">
          <path d={iconPath} />
        </svg>
      </div>
      <div>
        <div className="palette-label">{label}</div>
        <div className="palette-sublabel">{sublabel}</div>
      </div>
    </div>
  )
}

// ── Tree node ─────────────────────────────────────────────────────────────────

function TreeNodeItem({ nodeId, depth }: { nodeId: string; depth: number }) {
  const node = useDiagramStore((s) => s.c4Nodes[nodeId])
  const selectedNodeId = useDiagramStore((s) => s.selectedNodeId)
  const selectNode = useDiagramStore((s) => s.selectNode)
  const toggleCollapse = useDiagramStore((s) => s.toggleCollapse)
  const allNodes = useDiagramStore((s) => s.c4Nodes)
  const activeViewId = useDiagramStore((s) => s.activeViewId)
  const activeView = useDiagramStore((s) => s.activeViewId ? s.views[s.activeViewId] : undefined)
  const addNodeToView = useDiagramStore((s) => s.addNodeToView)
  const removeNodeFromView = useDiagramStore((s) => s.removeNodeFromView)

  if (!node) return null

  const children = Object.values(allNodes).filter((n) => n.parentId === nodeId)
  const hasChildren = children.length > 0
  const isSelected = selectedNodeId === nodeId
  const canCollapse = isContainerType(node.type) && hasChildren
  const isHierarchy = activeView?.kind === 'treemap'
  const inView = !activeView
    || (isHierarchy && activeView.nodeIds.length === 0)
    || activeView.nodeIds.includes(nodeId)
  // Effective collapsed: per-view if a named view is active, else model-level.
  // A model-collapsed node can be overridden in this view via expandedNodeIds.
  const isEffectivelyCollapsed = nodeEffectivelyCollapsedInView(node, activeViewId, activeView)

  return (
    <>
      <div
        className={`tree-node ${isSelected ? 'selected' : ''}`}
        style={{ paddingLeft: 12 + depth * 14, opacity: inView ? 1 : 0.35 }}
        onClick={() => selectNode(nodeId)}
      >
        <span
          className="tree-toggle"
          onClick={(e) => { if (!canCollapse) return; e.stopPropagation(); toggleCollapse(nodeId) }}
          style={{ cursor: canCollapse ? 'pointer' : 'default', opacity: canCollapse ? 1 : 0.3 }}
        >
          {canCollapse ? (isEffectivelyCollapsed ? '▶' : '▼') : '·'}
        </span>
        <span className="tree-badge"><C4Icon type={node.type} size={10} /></span>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
          {node.label}
        </span>
        {activeViewId && (
          <span
            className="tree-view-toggle"
            title={inView ? 'Remove from view' : 'Add to view'}
            onClick={(e) => {
              e.stopPropagation()
              if (inView) removeNodeFromView(activeViewId, nodeId)
              else addNodeToView(activeViewId, nodeId)
            }}
          >
            {inView ? '👁' : '👁‍🗨'}
          </span>
        )}
      </div>
      {!isEffectivelyCollapsed && children.map((c) => (
        <TreeNodeItem key={c.id} nodeId={c.id} depth={depth + 1} />
      ))}
    </>
  )
}

// ── Relation row ──────────────────────────────────────────────────────────────

function RelationListItem({ relationId }: { relationId: string }): React.ReactElement | null {
  const rel = useDiagramStore((s) => s.c4Relations[relationId])
  const sourceLabel = useDiagramStore((s) => {
    const r = s.c4Relations[relationId]; if (!r) return ''
    const n = s.c4Nodes[r.sourceId]; return n ? (n.label || n.type) : '?'
  })
  const targetLabel = useDiagramStore((s) => {
    const r = s.c4Relations[relationId]; if (!r) return ''
    const n = s.c4Nodes[r.targetId]; return n ? (n.label || n.type) : '?'
  })
  const selectedEdgeId = useDiagramStore((s) => s.selectedEdgeId)
  const selectEdge = useDiagramStore((s) => s.selectEdge)
  const activeViewId = useDiagramStore((s) => s.activeViewId)
  const activeView = useDiagramStore((s) => (s.activeViewId ? s.views[s.activeViewId] : undefined))
  const hideRelationFromView = useDiagramStore((s) => s.hideRelationFromView)
  const unhideRelationInView = useDiagramStore((s) => s.unhideRelationInView)

  if (!rel) return null

  // A relation is "in view" when no view is active OR the active view does
  // not have it on its hidden list AND both endpoints are visible there.
  const hidden = !!activeView?.hiddenRelationIds?.includes(relationId)
  const endpointsInView = !activeView
    || (activeView.nodeIds.includes(rel.sourceId) && activeView.nodeIds.includes(rel.targetId))
  const inView = !activeView || (!hidden && endpointsInView)
  const isSelected = selectedEdgeId === relationId

  return (
    <div
      className={`tree-node ${isSelected ? 'selected' : ''}`}
      style={{ paddingLeft: 12, opacity: inView ? 1 : 0.35 }}
      onClick={() => selectEdge(relationId)}
      title={rel.label || `${sourceLabel} → ${targetLabel}`}
    >
      <span className="tree-toggle" style={{ opacity: 0.3 }}>·</span>
      <span className="tree-badge" aria-hidden>
        <svg viewBox="0 0 16 16" width={10} height={10} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 8h10M9 5l3 3-3 3" />
        </svg>
      </span>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
        <span style={{ opacity: 0.8 }}>{sourceLabel}</span>
        <span style={{ opacity: 0.5, padding: '0 4px' }}>→</span>
        <span style={{ opacity: 0.8 }}>{targetLabel}</span>
        {rel.label && (
          <span style={{ opacity: 0.55, marginLeft: 6, fontStyle: 'italic' }}>{rel.label}</span>
        )}
      </span>
      {activeViewId && endpointsInView && (
        <span
          className="tree-view-toggle"
          title={hidden ? 'Show in view' : 'Hide from view'}
          onClick={(e) => {
            e.stopPropagation()
            if (hidden) unhideRelationInView(activeViewId, relationId)
            else hideRelationFromView(activeViewId, relationId)
          }}
        >
          {hidden ? '👁‍🗨' : '👁'}
        </span>
      )}
    </div>
  )
}

function RelationsSection(): React.ReactElement {
  const relations = useDiagramStore((s) => s.c4Relations)
  const c4Nodes = useDiagramStore((s) => s.c4Nodes)
  const ids = useMemo(() => {
    return Object.values(relations)
      .filter((r) => c4Nodes[r.sourceId] && c4Nodes[r.targetId])
      .sort((a, b) => {
        const sa = (c4Nodes[a.sourceId]?.label || '').localeCompare(c4Nodes[b.sourceId]?.label || '')
        if (sa !== 0) return sa
        return (c4Nodes[a.targetId]?.label || '').localeCompare(c4Nodes[b.targetId]?.label || '')
      })
      .map((r) => r.id)
  }, [relations, c4Nodes])

  if (ids.length === 0) {
    return <div className="lp-empty-state" style={{ padding: '4px 12px 8px' }}>No relations.</div>
  }
  return (
    <>
      {ids.map((id) => <RelationListItem key={id} relationId={id} />)}
    </>
  )
}

// ── Accordion section ────────────────────────────────────────────────────────

function AccordionSection({
  title, defaultOpen = true, children, count, open: openProp, onToggle,
}: { title: string; defaultOpen?: boolean; children: React.ReactNode; count?: number; open?: boolean; onToggle?: () => void }) {
  const [openState, setOpenState] = useState(defaultOpen)
  const controlled = openProp !== undefined
  const open = controlled ? openProp : openState
  const toggle = controlled ? onToggle! : () => setOpenState((o) => !o)
  return (
    <div className="lp-section">
      <button className="lp-section-header" onClick={toggle}>
        <span className="lp-section-title">
          <svg className={`lp-section-chevron${open ? ' open' : ''}`} viewBox="0 0 16 16" width="10" height="10" aria-hidden>
            <path d="M5 3 L11 8 L5 13" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <span>{title}</span>
          {count != null && count > 0 && <span className="lp-section-count">{count}</span>}
        </span>
      </button>
      <div className={`lp-section-body${open ? ' open' : ''}`}>
        <div><div className="lp-section-body-pad">{children}</div></div>
      </div>
    </div>
  )
}

// ── Tiny inline icons ─────────────────────────────────────────────────────────
const Icon = {
  Plus: () => (
    <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <path d="M8 3v10M3 8h10"/>
    </svg>
  ),
  Check: () => (
    <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 8.5 L6.5 12 L13 4.5"/>
    </svg>
  ),
  Close: () => (
    <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <path d="M4 4 L12 12 M12 4 L4 12"/>
    </svg>
  ),
  Restore: () => (
    <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 8 a5 5 0 1 0 1.5 -3.5"/>
      <path d="M3 3 v3 h3"/>
    </svg>
  ),
  Trash: () => (
    <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 4.5 h10 M6 4.5 V3 h4 v1.5 M5 4.5 l.7 8.5 a1 1 0 0 0 1 1 h2.6 a1 1 0 0 0 1 -1 l.7 -8.5"/>
    </svg>
  ),
  Camera: () => (
    <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round">
      <path d="M2.5 5.5 h2 l1 -1.5 h5 l1 1.5 h2 v7 h-11 z"/>
      <circle cx="8" cy="9" r="2.3"/>
    </svg>
  ),
  Globe: () => (
    <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.4">
      <circle cx="8" cy="8" r="5.5"/>
      <ellipse cx="8" cy="8" rx="2.5" ry="5.5"/>
      <path d="M2.5 8 h11"/>
    </svg>
  ),
  Layers: () => (
    <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round">
      <path d="M8 2 L14 5 L8 8 L2 5 Z"/>
      <path d="M2 8 L8 11 L14 8"/>
      <path d="M2 11 L8 14 L14 11"/>
    </svg>
  ),
  Pencil: () => (
    <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 2.5 l2.5 2.5 -7.5 7.5 -3 .5 .5 -3 z"/>
      <path d="M10 3.5 l2.5 2.5"/>
    </svg>
  ),
  Bolt: () => (
    <svg viewBox="0 0 16 16" width="11" height="11" fill="currentColor">
      <path d="M9.5 2 L4 9 h4 L6.5 14 L13 7 H9 Z"/>
    </svg>
  ),
  TreemapGrid: () => (
    <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.4">
      <rect x="1" y="1" width="9" height="9" rx="1"/>
      <rect x="11" y="1" width="4" height="4" rx="0.5"/>
      <rect x="11" y="6" width="4" height="4" rx="0.5"/>
      <rect x="1" y="11" width="4" height="4" rx="0.5"/>
      <rect x="6" y="11" width="4" height="4" rx="0.5"/>
      <rect x="11" y="11" width="4" height="4" rx="0.5"/>
    </svg>
  ),
  ArrowUp: () => (
    <svg viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 12 V4 M4.5 7.5 L8 4 L11.5 7.5"/>
    </svg>
  ),
  ArrowDown: () => (
    <svg viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 4 V12 M4.5 8.5 L8 12 L11.5 8.5"/>
    </svg>
  ),
  ChevronRight: () => (
    <svg viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 3 L11 8 L5 13"/>
    </svg>
  ),
  Settings: () => (
    <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M2 4.5 h3 M7 4.5 h7"/>
      <circle cx="5" cy="4.5" r="1.5"/>
      <path d="M2 11.5 h7 M11 11.5 h3"/>
      <circle cx="9.5" cy="11.5" r="1.5"/>
    </svg>
  ),
}

/** Format a timestamp as "just now", "5m ago", "3h ago", "2d ago", "MMM d" */
function formatRelative(ts: number): string {
  const diff = Date.now() - ts
  const sec = Math.round(diff / 1000)
  if (sec < 60) return 'just now'
  const min = Math.round(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.round(hr / 24)
  if (day < 7) return `${day}d ago`
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

// ── Milestone list (left panel) ──────────────────────────────────────────────
// Milestones are saved snapshots of the architecture used to track how the
// model evolves over time. Clicking a milestone does NOT restore — it is
// purely informational (and used for linking to presentation slides).

function SnapshotList({ readOnly = false, onOpenProps }: { readOnly?: boolean; onOpenProps?: (snapId: string) => void }) {
  const snapshots = useDiagramStore((s) => s.snapshots)
  const activeSnapshotId = useDiagramStore((s) => s.activeSnapshotId)
  const createSnapshot = useDiagramStore((s) => s.createSnapshot)
  const viewMilestoneDiff = useDiagramStore((s) => s.selectMilestone)
  const clearMilestoneView = useDiagramStore((s) => s.discardMilestoneChanges)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')

  const confirmCreate = () => {
    const name = newName.trim()
    if (name) createSnapshot(name)
    setCreating(false)
    setNewName('')
  }

  return (
    <div className="lp-snap-list">
      {!readOnly && (
        creating ? (
          <div className="lp-inline-form">
            <input
              className="lp-inline-input"
              autoFocus
              placeholder="Milestone name…"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') confirmCreate()
                if (e.key === 'Escape') { setCreating(false); setNewName('') }
              }}
            />
            <button className="lp-icon-btn primary" title="Create" onClick={confirmCreate}><Icon.Check /></button>
            <button className="lp-icon-btn" title="Cancel" onClick={() => { setCreating(false); setNewName('') }}><Icon.Close /></button>
          </div>
        ) : (
          <button className="lp-add-btn" onClick={() => { setNewName(`v${snapshots.length + 1}`); setCreating(true) }}>
            <Icon.Plus /> New milestone
          </button>
        )
      )}
      {snapshots.length === 0 && !creating && (
        <div className="lp-empty-state">
          <span className="lp-empty-icon"><Icon.Camera /></span>
          <span>No milestones yet</span>
        </div>
      )}
      {/* Virtual "current live state" entry — always shown at the top of the
          milestone list so the user can quickly return to the working HEAD
          (and visually understand it as the newest, still-unsaved milestone). */}
      <div
        className={`lp-card lp-snap-card lp-snap-current${!activeSnapshotId ? ' active' : ''}`}
        onClick={() => { if (activeSnapshotId) clearMilestoneView() }}
        title="Current working state (live HEAD) — not yet saved as a milestone"
      >
        <div className="lp-snap-badge lp-snap-badge-live">●</div>
        <div className="lp-card-body">
          <div className="lp-card-title">Current (live)</div>
          <div className="lp-card-meta">
            <span>working state</span>
            <span className="lp-meta-dot">·</span>
            <span>newest</span>
          </div>
        </div>
      </div>
      {[...snapshots].reverse().map((snap, idx) => {
        const isActive = activeSnapshotId === snap.id
        const versionNum = snapshots.length - idx
        const nodeCount = Object.keys(snap.nodes).length
        return (
          <div
            key={snap.id}
            className={`lp-card lp-snap-card${isActive ? ' active' : ''}`}
            onClick={() => viewMilestoneDiff(snap.id)}
            title={`${new Date(snap.timestamp).toLocaleString()}\nClick to load this milestone onto the canvas`}
          >
            <div className="lp-snap-badge">v{versionNum}</div>
            <div className="lp-card-body">
              <div className="lp-card-title">{snap.name}</div>
              <div className="lp-card-meta">
                <span>{formatRelative(snap.timestamp)}</span>
                <span className="lp-meta-dot">·</span>
                <span>{nodeCount} {nodeCount === 1 ? 'node' : 'nodes'}</span>
              </div>
            </div>
            {!readOnly && onOpenProps && (
              <div className="lp-card-actions">
                <button
                  className="lp-icon-btn"
                  title="Milestone properties"
                  onClick={(e) => { e.stopPropagation(); onOpenProps(snap.id) }}
                ><Icon.Settings /></button>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Sequence list ─────────────────────────────────────────────────────────────

function SequenceList({ readOnly = false, compact = false }: { readOnly?: boolean; compact?: boolean }) {
  const sequences = useDiagramStore((s) => s.sequences)
  const activeSequenceId = useDiagramStore((s) => s.activeSequenceId)
  const setActiveSequence = useDiagramStore((s) => s.setActiveSequence)
  const addSequence = useDiagramStore((s) => s.addSequence)
  const removeFromSequence = useDiagramStore((s) => s.removeFromSequence)
  const reorderSequence = useDiagramStore((s) => s.reorderSequence)
  const clearSequence = useDiagramStore((s) => s.clearSequence)
  const c4Nodes = useDiagramStore((s) => s.c4Nodes)
  const c4Relations = useDiagramStore((s) => s.c4Relations)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())

  const toggleExpand = (id: string) =>
    setExpandedIds((prev) => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next })

  const seqList = Object.values(sequences)

  const btnStyle: React.CSSProperties = {
    background: 'none', border: 'none', cursor: 'pointer',
    color: 'var(--text-muted)', padding: '2px 3px', borderRadius: 3,
    display: 'flex', alignItems: 'center', lineHeight: 1,
  }

  return (
    <div className="lp-view-list">
      {seqList.length === 0 && (
        <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: '6px 4px', textAlign: 'center', opacity: 0.55, fontStyle: 'italic' }}>
          No sequences yet
        </div>
      )}
      {seqList.map((seq) => {
        const isActive = activeSequenceId === seq.id
        const isExpanded = compact ? expandedIds.has(seq.id) : (isActive)
        return (
          <div key={seq.id}>
            <div
              className={`lp-card lp-view-card${isActive ? ' active' : ''}`}
              onClick={() => setActiveSequence(isActive ? null : seq.id)}
            >
              <div className="lp-view-icon" style={{ color: isActive ? 'var(--accent)' : undefined }}>
                <Icon.Bolt />
              </div>
              <div className="lp-card-body">
                <div className="lp-card-title">{seq.name}</div>
                <div className="lp-card-meta">
                  <span>{seq.relationIds.length} {seq.relationIds.length === 1 ? 'step' : 'steps'}</span>
                  {isActive && <span style={{ marginLeft: 4, color: 'var(--accent)', fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>editing</span>}
                </div>
              </div>
            </div>
            {/* Inline step detail */}
            {((!compact && isActive) || (compact && isExpanded)) && seq.relationIds.length > 0 && (
              <div style={{ padding: '2px 8px 8px', borderLeft: '2px solid var(--accent)', marginLeft: 10 }}>
                <div style={{ display: 'grid', gap: 3, marginBottom: 4, minWidth: 0 }}>
                  {seq.relationIds.map((relId, idx) => {
                    const rel = c4Relations[relId]
                    const src = rel ? c4Nodes[rel.sourceId] : null
                    const tgt = rel ? c4Nodes[rel.targetId] : null
                    return (
                      <div key={relId} className="seq-step" style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'var(--surface-2,rgba(255,255,255,0.04))', borderRadius: 5, padding: '4px 6px' }}>
                        <span style={{
                          width: 18, height: 18, borderRadius: '50%',
                          background: 'var(--accent)', color: '#fff',
                          fontSize: 10, fontWeight: 700,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          flexShrink: 0,
                        }}>{idx + 1}</span>
                        <div style={{ flex: 1, minWidth: 0, fontSize: 11, lineHeight: 1.35 }}>
                          <div style={{ color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {src?.label ?? '?'} → {tgt?.label ?? '?'}
                          </div>
                          {rel?.label && (
                            <div style={{ color: 'var(--text-muted)', fontSize: 10, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {rel.label}
                            </div>
                          )}
                        </div>
                        {!readOnly && (
                          <div className="seq-step-actions">
                            <button
                              style={{ ...btnStyle, opacity: idx === 0 ? 0.3 : 1 }}
                              disabled={idx === 0}
                              onClick={() => reorderSequence(seq.id, idx, idx - 1)}
                              title="Move up"
                            ><Icon.ArrowUp /></button>
                            <button
                              style={{ ...btnStyle, opacity: idx === seq.relationIds.length - 1 ? 0.3 : 1 }}
                              disabled={idx === seq.relationIds.length - 1}
                              onClick={() => reorderSequence(seq.id, idx, idx + 1)}
                              title="Move down"
                            ><Icon.ArrowDown /></button>
                            <button
                              style={{ ...btnStyle, color: 'var(--danger, #ef4444)' }}
                              onClick={() => removeFromSequence(seq.id, idx)}
                              title="Remove step"
                            ><Icon.Close /></button>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
                {!readOnly && (
                  <button
                    onClick={() => clearSequence(seq.id)}
                    style={{
                      width: '100%',
                      fontSize: 11,
                      padding: '4px 0',
                      background: 'none',
                      border: '1px solid var(--border)',
                      borderRadius: 4,
                      color: 'var(--text-muted)',
                      cursor: 'pointer',
                    }}
                  >
                    Clear all steps
                  </button>
                )}
              </div>
            )}
            {(!compact && isActive && seq.relationIds.length === 0) && (
              <div style={{ padding: '4px 10px 8px', fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic', opacity: 0.6 }}>
                Click relations on canvas to add steps
              </div>
            )}
          </div>
        )
      })}
      {!readOnly && (
        <button className="lp-add-btn" onClick={() => {
          const id = addSequence(`Sequence ${seqList.length + 1}`)
          setActiveSequence(id)
        }}>
          <Icon.Plus /> New sequence
        </button>
      )}
    </div>
  )
}

// ── View properties (left panel pane 2) ─────────────────────────────────────

function ViewPropertiesContent({ viewId, readOnly = false, onClose }: { viewId: string; readOnly?: boolean; onClose: () => void }) {
  const view = useDiagramStore((s) => s.views[viewId])
  const sequences = useDiagramStore((s) => s.sequences)
  const renameView = useDiagramStore((s) => s.renameView)
  const removeView = useDiagramStore((s) => s.removeView)
  const setViewKind = useDiagramStore((s) => s.setViewKind)
  const setViewSequence = useDiagramStore((s) => s.setViewSequence)
  const setViewLayoutMode = useDiagramStore((s) => s.setViewLayoutMode)
  const setActiveView = useDiagramStore((s) => s.setActiveView)
  const [editingName, setEditingName] = useState(false)
  const [nameVal, setNameVal] = useState('')
  const seqList = Object.values(sequences)

  if (!view) return null
  const isDynamic = view.kind === 'dynamic'
  const isTreemap = view.kind === 'treemap'
  const isStatic  = !isDynamic && !isTreemap

  const commitName = () => {
    if (nameVal.trim()) renameView(view.id, nameVal.trim())
    setEditingName(false)
  }

  return (
    <div className="props-content">
      <div className="props-type-badge" style={{ background: isDynamic ? 'var(--accent)' : isTreemap ? '#2a3a5a' : '#334155', color: '#fff' }}>
        {isDynamic ? <Icon.Bolt /> : isTreemap ? <Icon.TreemapGrid /> : <Icon.Layers />}
        &nbsp;{isDynamic ? 'FLOW VIEW' : isTreemap ? 'HIERARCHY VIEW' : 'STRUCTURE VIEW'}
      </div>
      <div>
        <div className="props-section-title">Name</div>
        <div className="props-field">
          {editingName ? (
            <div style={{ display: 'flex', gap: 4 }}>
              <input className="props-input" autoFocus value={nameVal}
                onChange={(e) => setNameVal(e.target.value)} onBlur={commitName}
                onKeyDown={(e) => { if (e.key === 'Enter') commitName(); if (e.key === 'Escape') setEditingName(false) }}
                style={{ flex: 1 }} />
              <button className="lp-icon-btn primary" onClick={commitName} title="Save"><Icon.Check /></button>
              <button className="lp-icon-btn" onClick={() => setEditingName(false)} title="Cancel"><Icon.Close /></button>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ flex: 1, fontSize: 13, fontWeight: 600, padding: '3px 0' }}>{view.name}</div>
              {!readOnly && (
                <button className="lp-icon-btn" title="Rename view"
                  onClick={() => { setNameVal(view.name); setEditingName(true) }}><Icon.Pencil /></button>
              )}
            </div>
          )}
        </div>
      </div>
      {!readOnly && (
        <div>
          <div className="props-section-title">Type</div>
          <div style={{ display: 'flex', gap: 4 }}>
            <button
              onClick={() => setViewKind(view.id, 'static')}
              style={{
                flex: 1, padding: '5px 3px', fontSize: 11, borderRadius: 6, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                minWidth: 0, overflow: 'hidden',
                background: isStatic ? 'var(--accent)' : 'var(--surface-2, rgba(255,255,255,0.06))',
                color: isStatic ? '#fff' : 'var(--text-muted)',
                border: isStatic ? '1px solid var(--accent)' : '1px solid var(--border-color)',
                fontWeight: isStatic ? 600 : 400,
              }}
            ><Icon.Layers /> Structure</button>
            <button
              onClick={() => setViewKind(view.id, 'dynamic')}
              style={{
                flex: 1, padding: '5px 3px', fontSize: 11, borderRadius: 6, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                minWidth: 0, overflow: 'hidden',
                background: isDynamic ? 'var(--accent)' : 'var(--surface-2, rgba(255,255,255,0.06))',
                color: isDynamic ? '#fff' : 'var(--text-muted)',
                border: isDynamic ? '1px solid var(--accent)' : '1px solid var(--border-color)',
                fontWeight: isDynamic ? 600 : 400,
              }}
            ><Icon.Bolt /> Flow</button>
            <button
              onClick={() => setViewKind(view.id, 'treemap')}
              style={{
                flex: 1, padding: '5px 3px', fontSize: 11, borderRadius: 6, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                minWidth: 0, overflow: 'hidden',
                background: isTreemap ? 'var(--accent)' : 'var(--surface-2, rgba(255,255,255,0.06))',
                color: isTreemap ? '#fff' : 'var(--text-muted)',
                border: isTreemap ? '1px solid var(--accent)' : '1px solid var(--border-color)',
                fontWeight: isTreemap ? 600 : 400,
              }}
            ><Icon.TreemapGrid /> Hierarchy</button>
          </div>
        </div>
      )}
      {!readOnly && !isTreemap && !isDynamic && (
        <div>
          <div className="props-section-title">Auto-layout</div>
          <select
            value={view.layoutMode ?? 'auto'}
            onChange={(e) => setViewLayoutMode(view.id, e.target.value as 'auto' | 'tree')}
            className="props-input"
            style={{ cursor: 'pointer', width: '100%' }}
            title="Layout strategy applied when running Smart Layout while this view is active. Use 'Hierarchical tree' for views dominated by domain objects."
          >
            <option value="auto">Auto (Smart Layout)</option>
            <option value="tree">Hierarchical nested tree</option>
          </select>
        </div>
      )}
      {isDynamic && (
        <div>
          <div className="props-section-title">Sequence</div>
          {readOnly ? (
            <div style={{ fontSize: 11, color: 'var(--text)' }}>
              {view.sequenceId && sequences[view.sequenceId]
                ? sequences[view.sequenceId].name
                : <span style={{ opacity: 0.5, fontStyle: 'italic' }}>none</span>}
            </div>
          ) : (
            <select
              value={view.sequenceId ?? ''}
              onChange={(e) => setViewSequence(view.id, e.target.value || null)}
              className="props-input"
              style={{ cursor: 'pointer' }}
            >
              <option value="">— none —</option>
              {seqList.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}
        </div>
      )}
      <div>
        <div className="props-section-title">Nodes</div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{view.nodeIds.length} node{view.nodeIds.length !== 1 ? 's' : ''}</div>
      </div>
      {!readOnly && (
        <button className="props-delete" onClick={() => { removeView(view.id); setActiveView(null); onClose() }}>
          🗑 Delete view
        </button>
      )}
    </div>
  )
}

// ── Milestone properties (left panel pane 2) ────────────────────────────────

function MilestonePropertiesContent({ snapId, readOnly = false, onClose }: { snapId: string; readOnly?: boolean; onClose: () => void }) {
  const snapshots = useDiagramStore((s) => s.snapshots)
  const renameSnapshot = useDiagramStore((s) => s.renameSnapshot)
  const removeSnapshot = useDiagramStore((s) => s.removeSnapshot)
  const restoreSnapshot = useDiagramStore((s) => s.restoreSnapshot)
  const [editingName, setEditingName] = useState(false)
  const [nameVal, setNameVal] = useState('')

  const snap = snapshots.find((s) => s.id === snapId)
  if (!snap) return null
  const versionNum = snapshots.indexOf(snap) + 1
  const nodeCount = Object.keys(snap.nodes).length
  const relationCount = Object.keys(snap.relations).length

  const commitName = () => {
    if (nameVal.trim()) renameSnapshot(snap.id, nameVal.trim())
    setEditingName(false)
  }

  return (
    <div className="props-content">
      <div className="props-type-badge" style={{ background: '#334155', color: '#94a3b8' }}>
        <Icon.Camera /> &nbsp;MILESTONE v{versionNum}
      </div>
      <div>
        <div className="props-section-title">Name</div>
        <div className="props-field">
          {editingName ? (
            <div style={{ display: 'flex', gap: 4 }}>
              <input className="props-input" autoFocus value={nameVal}
                onChange={(e) => setNameVal(e.target.value)} onBlur={commitName}
                onKeyDown={(e) => { if (e.key === 'Enter') commitName(); if (e.key === 'Escape') setEditingName(false) }}
                style={{ flex: 1 }} />
              <button className="lp-icon-btn primary" onClick={commitName} title="Save"><Icon.Check /></button>
              <button className="lp-icon-btn" onClick={() => setEditingName(false)} title="Cancel"><Icon.Close /></button>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ flex: 1, fontSize: 13, fontWeight: 600, padding: '3px 0' }}>{snap.name}</div>
              {!readOnly && (
                <button className="lp-icon-btn" title="Rename milestone"
                  onClick={() => { setNameVal(snap.name); setEditingName(true) }}><Icon.Pencil /></button>
              )}
            </div>
          )}
        </div>
      </div>
      <div>
        <div className="props-section-title">Saved</div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          {new Date(snap.timestamp).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' } as any)}
        </div>
      </div>
      <div>
        <div className="props-section-title">Contents</div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          {nodeCount} node{nodeCount !== 1 ? 's' : ''} · {relationCount} relation{relationCount !== 1 ? 's' : ''}
        </div>
      </div>
      {!readOnly && (
        <>
          <button
            className="lp-icon-btn"
            style={{ justifyContent: 'center', width: '100%', padding: '6px 0', fontSize: 12, gap: 6, borderRadius: 6, marginTop: 4, display: 'flex', alignItems: 'center' }}
            title="Restore this milestone as the current live state"
            onClick={() => { restoreSnapshot(snap.id); onClose() }}
          >
            <Icon.Restore /> Restore to live
          </button>
          <button className="props-delete" onClick={() => { removeSnapshot(snap.id); onClose() }}>
            🗑 Delete milestone
          </button>
        </>
      )}
    </div>
  )
}

// ── View list (left panel) ────────────────────────────────────────────────────

function ViewList({ readOnly = false, onOpenProps }: { readOnly?: boolean; onOpenProps?: (viewId: string) => void }) {
  const views = useDiagramStore((s) => s.views)
  const sequences = useDiagramStore((s) => s.sequences)
  const activeViewId = useDiagramStore((s) => s.activeViewId)
  const setActiveView = useDiagramStore((s) => s.setActiveView)
  const addView = useDiagramStore((s) => s.addView)
  const totalNodes = useDiagramStore((s) => Object.keys(s.c4Nodes).length)
  const viewList = Object.values(views)

  return (
    <div className="lp-view-list">
      <div
        className={`lp-card lp-view-card${activeViewId === null ? ' active' : ''}`}
        onClick={() => setActiveView(null)}
      >
        <div className="lp-view-icon"><Icon.Globe /></div>
        <div className="lp-card-body">
          <div className="lp-card-title">Structure view</div>
          <div className="lp-card-meta">
            <span>{totalNodes} {totalNodes === 1 ? 'node' : 'nodes'}</span>
            <span style={{ marginLeft: 4, color: 'var(--text-muted)', fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>structure</span>
          </div>
        </div>
      </div>
      {viewList.map((v) => {
        const isActive = activeViewId === v.id
        const isDynamic = v.kind === 'dynamic'
        const isTreemap = v.kind === 'treemap'
        return (
          <div key={v.id}>
            <div
              className={`lp-card lp-view-card${isActive ? ' active' : ''}`}
              onClick={() => setActiveView(v.id)}
            >
              <div className="lp-view-icon" style={{ color: isDynamic ? 'var(--accent)' : undefined }}>
                {isDynamic ? <Icon.Bolt /> : isTreemap ? <Icon.TreemapGrid /> : <Icon.Layers />}
              </div>
              <div className="lp-card-body">
                <div className="lp-card-title">{v.name}</div>
                <div className="lp-card-meta">
                  <span>{v.nodeIds.length} {v.nodeIds.length === 1 ? 'node' : 'nodes'}</span>
                  {isDynamic && <span style={{ marginLeft: 4, color: 'var(--accent)', fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>flow</span>}
                  {isTreemap && <span style={{ marginLeft: 4, color: 'var(--accent)', fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>hierarchy</span>}
                  {!isDynamic && !isTreemap && <span style={{ marginLeft: 4, color: 'var(--text-muted)', fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>structure</span>}
                </div>
              </div>
              {!readOnly && onOpenProps && (
                <div className="lp-card-actions">
                  <button
                    className="lp-icon-btn"
                    onClick={(e) => { e.stopPropagation(); onOpenProps(v.id) }}
                    title="View properties"
                  ><Icon.Settings /></button>
                </div>
              )}
            </div>
          </div>
        )
      })}
      {!readOnly && (
        <button className="lp-add-btn" onClick={() => {
          const id = addView(`View ${viewList.length + 1}`)
          setActiveView(id)
          if (onOpenProps) onOpenProps(id)
        }}>
          <Icon.Plus /> New view
        </button>
      )}
    </div>
  )
}

// ── LeftPanel (accordion) ────────────────────────────────────────────────────

// ── Panel collapse toggle (chevron tab on inner edge) ────────────────────────

function PanelToggle({ side, collapsed, onToggle }: {
  side: 'left' | 'right'
  collapsed: boolean
  onToggle: () => void
}) {
  // Chevron points "outward" when collapsed (to expand), "inward" when expanded
  const pointsLeft = (side === 'left' && collapsed) || (side === 'right' && !collapsed)
    ? false
    : true
  return (
    <button
      className={`panel-toggle panel-toggle-${side}${collapsed ? ' collapsed' : ''}`}
      onClick={onToggle}
      title={collapsed ? 'Expand panel' : 'Collapse panel'}
      aria-label={collapsed ? 'Expand panel' : 'Collapse panel'}
    >
      <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        {pointsLeft ? <path d="M10 4 L6 8 L10 12" /> : <path d="M6 4 L10 8 L6 12" />}
      </svg>
    </button>
  )
}

export function LeftPanel({ mode = 'designer', readOnly = false, collapsed = false, onToggleCollapsed }: {
  mode?: 'designer' | 'viewer'
  readOnly?: boolean
  collapsed?: boolean
  onToggleCollapsed?: () => void
}) {
  const isReadOnly = readOnly || mode !== 'designer'
  const viewsCount = useDiagramStore((s) => Object.keys(s.views).length)
  const snapshotsCount = useDiagramStore((s) => s.snapshots.length)
  const metamodel = useDiagramStore((s) => s.metamodel)

  // Build palette dynamically from metamodel; fall back to static C4 records
  // for built-in types and to def.description / metadata for custom types.
  const paletteItems = useMemo(() => {
    const allTypeIds = metamodel ? Object.keys(metamodel.nodeTypes) : [...PALETTE_ORDER]
    const ordered = [
      ...PALETTE_ORDER.filter(t => allTypeIds.includes(t)),
      ...allTypeIds.filter(t => !PALETTE_ORDER.includes(t)),
    ]
    return ordered.map((typeId) => {
      const def = metamodel?.nodeTypes[typeId]
      const t = typeId as C4ElementType
      const builtIn = (TYPE_LABELS as Record<string, string>)[typeId] !== undefined
      return {
        typeId,
        label: def?.label ?? (builtIn ? TYPE_LABELS[t] : typeId),
        sublabel: PALETTE_SUBLABELS[typeId] ?? '',
        color: builtIn ? NODE_COLORS[t] : (def?.color ?? '#64748b'),
        iconPath: builtIn ? TYPE_ICON_PATHS[t] : (TYPE_ICON_PATHS.system),
      }
    })
  }, [metamodel])

  const defaultSection = mode === 'designer' ? 'elements' : 'views'
  const [openSection, setOpenSection] = useState<'elements' | 'views' | 'milestones'>(defaultSection as any)
  type PaneContent = { kind: 'view'; id: string } | { kind: 'milestone'; id: string }
  const [paneContent, setPaneContent] = useState<PaneContent | null>(null)
  const hasPaneContent = !!paneContent

  const toggle = onToggleCollapsed && (
    <PanelToggle side="left" collapsed={collapsed} onToggle={onToggleCollapsed} />
  )

  return (
    <div className={`left-panel${collapsed ? ' collapsed' : ''}`}>
      <div className="panel-content">
        <div className={`rp-slider${hasPaneContent ? ' show-props' : ''}`}>

          {/* Pane 1 — accordion */}
          <div className="rp-pane">
            {mode === 'designer' && (
              <AccordionSection title="Elements"
                open={openSection === 'elements'} onToggle={() => setOpenSection('elements')}>
                {paletteItems.map((item) => (
                  <PaletteItem key={item.typeId} {...item} />
                ))}
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4, padding: '0 4px' }}>
                  Drag to canvas · Double-click canvas to add System
                </div>
              </AccordionSection>
            )}
            <AccordionSection title="Views" count={viewsCount}
              open={openSection === 'views'} onToggle={() => setOpenSection('views')}>
              <ViewList
                readOnly={isReadOnly}
                onOpenProps={!isReadOnly ? (id) => { setPaneContent({ kind: 'view', id }); setOpenSection('views') } : undefined}
              />
            </AccordionSection>
            <AccordionSection title="Milestones" count={snapshotsCount}
              open={openSection === 'milestones'} onToggle={() => setOpenSection('milestones')}>
              <SnapshotList readOnly={isReadOnly} onOpenProps={!isReadOnly ? (id) => { setPaneContent({ kind: 'milestone', id }); setOpenSection('milestones') } : undefined} />
            </AccordionSection>
          </div>

          {/* Pane 2 — view / milestone properties */}
          <div className="rp-pane">
            <button className="rp-back-btn" onClick={() => setPaneContent(null)}>◀ Back</button>
            {paneContent?.kind === 'view' && (
              <ViewPropertiesContent
                viewId={paneContent.id}
                readOnly={isReadOnly}
                onClose={() => setPaneContent(null)}
              />
            )}
            {paneContent?.kind === 'milestone' && (
              <MilestonePropertiesContent
                snapId={paneContent.id}
                readOnly={isReadOnly}
                onClose={() => setPaneContent(null)}
              />
            )}
          </div>

        </div>
      </div>
      {toggle}
    </div>
  )
}

// ── RightPanel (tree + properties accordion) ──────────────────────────────────

function SequencePropertiesContent({ sequenceId, readOnly = false }: { sequenceId: string; readOnly?: boolean }) {
  const seq = useDiagramStore((s) => s.sequences[sequenceId])
  const c4Nodes = useDiagramStore((s) => s.c4Nodes)
  const c4Relations = useDiagramStore((s) => s.c4Relations)
  const renameSequence = useDiagramStore((s) => s.renameSequence)
  const removeSequence = useDiagramStore((s) => s.removeSequence)
  const removeFromSequence = useDiagramStore((s) => s.removeFromSequence)
  const reorderSequence = useDiagramStore((s) => s.reorderSequence)
  const clearSequence = useDiagramStore((s) => s.clearSequence)
  const setActiveSequence = useDiagramStore((s) => s.setActiveSequence)
  const addViewFromSequence = useDiagramStore((s) => s.addViewFromSequence)
  const views = useDiagramStore((s) => s.views)
  const [editingName, setEditingName] = useState(false)
  const [nameVal, setNameVal] = useState('')

  if (!seq) return null

  const commitName = () => {
    if (nameVal.trim()) renameSequence(seq.id, nameVal.trim())
    setEditingName(false)
  }

  const btnStyle: React.CSSProperties = {
    background: 'none', border: 'none', cursor: 'pointer',
    color: 'var(--text-muted)', padding: '2px 3px', borderRadius: 3,
    display: 'flex', alignItems: 'center', lineHeight: 1,
  }

  return (
    <div className="props-content">
      <div className="props-type-badge" style={{ background: 'var(--accent)', color: '#fff' }}>
        <Icon.Bolt /> &nbsp;SEQUENCE
      </div>
      <div>
        <div className="props-section-title">Name</div>
        <div className="props-field">
          {editingName ? (
            <div style={{ display: 'flex', gap: 4 }}>
              <input
                className="props-input"
                autoFocus
                value={nameVal}
                onChange={(e) => setNameVal(e.target.value)}
                onBlur={commitName}
                onKeyDown={(e) => { if (e.key === 'Enter') commitName(); if (e.key === 'Escape') setEditingName(false) }}
                style={{ flex: 1 }}
              />
              <button className="lp-icon-btn primary" onClick={commitName} title="Save"><Icon.Check /></button>
              <button className="lp-icon-btn" onClick={() => setEditingName(false)} title="Cancel"><Icon.Close /></button>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ flex: 1, fontSize: 13, fontWeight: 600, padding: '3px 0' }}>{seq.name}</div>
              {!readOnly && (
                <button className="lp-icon-btn" title="Rename sequence"
                  onClick={() => { setNameVal(seq.name); setEditingName(true) }}><Icon.Pencil /></button>
              )}
            </div>
          )}
        </div>
      </div>
      <div>
        <div className="props-section-title" style={{ marginTop: 10 }}>
          Steps
          <span style={{ marginLeft: 6, opacity: 0.5, fontWeight: 400 }}>({seq.relationIds.length})</span>
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 6, lineHeight: 1.4 }}>
          Click relations on canvas to add steps
        </div>
        {seq.relationIds.length === 0 ? (
          <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: '6px 4px', textAlign: 'center', opacity: 0.55, fontStyle: 'italic' }}>
            No steps yet
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 4, minWidth: 0 }}>
            {seq.relationIds.map((relId, idx) => {
              const rel = c4Relations[relId]
              const src = rel ? c4Nodes[rel.sourceId] : null
              const tgt = rel ? c4Nodes[rel.targetId] : null
              return (
                <div key={relId} className="seq-step" style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'var(--surface-2,rgba(255,255,255,0.04))', borderRadius: 5, padding: '5px 7px' }}>
                  <span style={{
                    width: 20, height: 20, borderRadius: '50%',
                    background: 'var(--accent)', color: '#fff',
                    fontSize: 10, fontWeight: 700,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0,
                  }}>{idx + 1}</span>
                  <div style={{ flex: 1, minWidth: 0, fontSize: 11, lineHeight: 1.35 }}>
                    <div style={{ color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {src?.label ?? '?'} → {tgt?.label ?? '?'}
                    </div>
                    {rel?.label && (
                      <div style={{ color: 'var(--text-muted)', fontSize: 10, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {rel.label}
                      </div>
                    )}
                  </div>
                  {!readOnly && (
                    <div className="seq-step-actions">
                      <button style={{ ...btnStyle, opacity: idx === 0 ? 0.3 : 1 }} disabled={idx === 0}
                        onClick={() => reorderSequence(seq.id, idx, idx - 1)} title="Move up"><Icon.ArrowUp /></button>
                      <button style={{ ...btnStyle, opacity: idx === seq.relationIds.length - 1 ? 0.3 : 1 }}
                        disabled={idx === seq.relationIds.length - 1}
                        onClick={() => reorderSequence(seq.id, idx, idx + 1)} title="Move down"><Icon.ArrowDown /></button>
                      <button
                        style={{ ...btnStyle, color: 'var(--danger, #ef4444)' }}
                        onClick={() => removeFromSequence(seq.id, idx)}
                        title="Remove step"
                      ><Icon.Close /></button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
        {!readOnly && seq.relationIds.length > 0 && (
          <button
            onClick={() => clearSequence(seq.id)}
            style={{
              marginTop: 8, width: '100%', fontSize: 11, padding: '4px 0',
              background: 'none', border: '1px solid var(--border)', borderRadius: 4,
              color: 'var(--text-muted)', cursor: 'pointer',
            }}
          >
            Clear all steps
          </button>
        )}
      </div>
      {!readOnly && (
        <>
          {seq.relationIds.length > 0 && (() => {
            const existingView = Object.values(views).find((v) => v.sequenceId === seq.id)
            return existingView ? (
              <div style={{ marginTop: 12, fontSize: 11, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
                <Icon.Layers />
                <span>View: <strong style={{ color: 'var(--text)' }}>{existingView.name}</strong></span>
              </div>
            ) : (
              <button
                onClick={() => addViewFromSequence(seq.id)}
                style={{
                  marginTop: 12, width: '100%', fontSize: 11, padding: '6px 0',
                  background: 'rgba(var(--accent-rgb),0.10)',
                  border: '1px solid rgba(var(--accent-rgb),0.30)',
                  borderRadius: 6, color: 'var(--accent)', cursor: 'pointer', fontWeight: 600,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                }}
                title="Create a Flow view showing only nodes and relations from this sequence"
              >
                <Icon.Plus /> Create Flow view from sequence
              </button>
            )
          })()}
          <button className="props-delete" onClick={() => { removeSequence(seq.id); setActiveSequence(null) }}>
            🗑 Delete sequence
          </button>
        </>
      )}
    </div>
  )
}

function PropertiesContent({ readOnly = false }: { readOnly?: boolean }) {
  const selectedNodeId = useDiagramStore((s) => s.selectedNodeId)
  const selectedEdgeId = useDiagramStore((s) => s.selectedEdgeId)
  const c4Nodes = useDiagramStore((s) => s.c4Nodes)
  const c4Relations = useDiagramStore((s) => s.c4Relations)
  const updateNode = useDiagramStore((s) => s.updateNode)
  const removeNode = useDiagramStore((s) => s.removeNode)
  const updateRelation = useDiagramStore((s) => s.updateRelation)
  const removeRelation = useDiagramStore((s) => s.removeRelation)
  const selectNode = useDiagramStore((s) => s.selectNode)
  const selectEdge = useDiagramStore((s) => s.selectEdge)

  // ── Node ──────────────────────────────────────────────────────────────────
  if (selectedNodeId && c4Nodes[selectedNodeId]) {
    const node = c4Nodes[selectedNodeId]

    const field = (
      label: string,
      key: keyof typeof node,
      type: 'text' | 'textarea' | 'checkbox' = 'text'
    ) => {
      const value = node[key]
      const onChange = (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        if (readOnly) return
        updateNode(node.id, {
          [key]: type === 'checkbox'
            ? (e.target as HTMLInputElement).checked
            : e.target.value,
        })
      }
      if (type === 'checkbox') {
        return (
          <div className="props-field" key={key}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
              <input type="checkbox" checked={Boolean(value)} onChange={onChange}
                disabled={readOnly}
                style={{ accentColor: 'var(--accent)' }} />
              {label}
            </label>
          </div>
        )
      }
      if (type === 'textarea') {
        return (
          <div className="props-field" key={key}>
            <label className="props-label">{label}</label>
            <textarea className="props-textarea" value={String(value ?? '')} onChange={onChange}
              readOnly={readOnly} />
          </div>
        )
      }
      return (
        <div className="props-field" key={key}>
          <label className="props-label">{label}</label>
          <input className="props-input" value={String(value ?? '')} onChange={onChange}
            readOnly={readOnly} />
        </div>
      )
    }

    const parentSelector = (node.type === 'container' || node.type === 'component' || node.type === 'database' || node.type === 'webapp' || node.type === 'queue') ? (
      <div className="props-field">
        <label className="props-label">Parent</label>
        <select
          className="props-input"
          value={node.parentId ?? ''}
          disabled={readOnly}
          onChange={(e) => !readOnly && updateNode(node.id, { parentId: e.target.value || undefined })}
        >
          <option value="">(none)</option>
          {Object.values(c4Nodes)
            .filter((n) => {
              if (n.id === node.id) return false
              if (node.type === 'container') return n.type === 'system'
              if (node.type === 'component') return n.type === 'container'
              if (node.type === 'database') return n.type === 'system' || n.type === 'container'
              if (node.type === 'webapp') return n.type === 'system' || n.type === 'container'
              if (node.type === 'queue') return n.type === 'system' || n.type === 'container'
              return false
            })
            .map((n) => <option key={n.id} value={n.id}>{n.label}</option>)}
        </select>
      </div>
    ) : null

    return (
      <div className="props-content">
        <div
          className="props-type-badge"
          style={{ background: NODE_COLORS[node.type], color: NODE_FG[node.type] }}
        >
          <svg viewBox="0 0 16 16" width="14" height="14" fill={NODE_FG[node.type]} style={{ marginRight: 6 }}>
            <path d={TYPE_ICON_PATHS[node.type]} />
          </svg>
          {TYPE_LABELS[node.type].toUpperCase()}
        </div>
        <div>
          <div className="props-section-title">Properties</div>
          {field('Label', 'label')}
          {field('Description', 'description', 'textarea')}
          {(node.type === 'container' || node.type === 'component' || node.type === 'database' || node.type === 'webapp' || node.type === 'queue') &&
            field('Technology', 'technology')}
          {field('External', 'external', 'checkbox')}
          {parentSelector}
        </div>
        {!readOnly && (
          <button className="props-delete" onClick={() => { removeNode(node.id); selectNode(null) }}>
            🗑 Delete node (and children)
          </button>
        )}
      </div>
    )
  }

  // ── Edge ──────────────────────────────────────────────────────────────────
  if (selectedEdgeId) {
    const relId = selectedEdgeId.startsWith('virtual-') ? null : selectedEdgeId
    const rel = relId ? c4Relations[relId] : null

    if (rel) {
      return (
        <div className="props-content">
          <div className="props-type-badge" style={{ background: '#334155', color: '#94a3b8' }}>
            RELATION
          </div>
          <div>
            <div className="props-section-title">Properties</div>
            <div className="props-field">
              <label className="props-label">Label</label>
              <input className="props-input" value={rel.label ?? ''}
                readOnly={readOnly}
                onChange={(e) => !readOnly && updateRelation(rel.id, { label: e.target.value })} />
            </div>
            <div className="props-field">
              <label className="props-label">Technology</label>
              <input className="props-input" value={rel.technology ?? ''}
                readOnly={readOnly}
                onChange={(e) => !readOnly && updateRelation(rel.id, { technology: e.target.value })} />
            </div>
          </div>
          {!readOnly && (
            <button className="props-delete" onClick={() => { removeRelation(rel.id); selectEdge(null) }}>
              🗑 Delete relation
            </button>
          )}
        </div>
      )
    }

    return (
      <div className="props-content">
        <div className="props-empty">
          Virtual relation (collapsed nodes)<br />
          Expand parent nodes to edit individual relations.
        </div>
      </div>
    )
  }

  return null
}

export function RightPanel({ readOnly = false, collapsed = false, onToggleCollapsed }: {
  readOnly?: boolean
  collapsed?: boolean
  onToggleCollapsed?: () => void
}) {
  const allNodes = useDiagramStore((s) => s.c4Nodes)
  const selectedNodeId = useDiagramStore((s) => s.selectedNodeId)
  const selectedEdgeId = useDiagramStore((s) => s.selectedEdgeId)
  const selectNode = useDiagramStore((s) => s.selectNode)
  const selectEdge = useDiagramStore((s) => s.selectEdge)
  const activeSequenceId = useDiagramStore((s) => s.activeSequenceId)
  const setActiveSequence = useDiagramStore((s) => s.setActiveSequence)
  const nodesCount = useDiagramStore((s) => Object.keys(s.c4Nodes).length)
  const relationsCount = useDiagramStore((s) => Object.keys(s.c4Relations).length)
  const sequencesCount = useDiagramStore((s) => Object.keys(s.sequences).length)
  const rootNodes = Object.values(allNodes).filter((n) => !n.parentId)
  const [openSection, setOpenSection] = useState<'nodes' | 'relations' | 'sequences'>('nodes')

  // Pane 2 is shown when any item is selected
  const hasSelection = !!(selectedNodeId || selectedEdgeId || activeSequenceId)

  const handleBack = () => {
    selectNode(null)
    selectEdge(null)
    setActiveSequence(null)
  }

  // Determine what to show in Pane 2
  const pane2Content = () => {
    if (selectedNodeId || selectedEdgeId) {
      return <PropertiesContent readOnly={readOnly} />
    }
    if (activeSequenceId) {
      return <SequencePropertiesContent sequenceId={activeSequenceId} readOnly={readOnly} />
    }
    return null
  }

  return (
    <div className={`right-panel${collapsed ? ' collapsed' : ''}`}>
      <div className="panel-content">
        <div className={`rp-slider${hasSelection ? ' show-props' : ''}`}>

          {/* Pane 1 — Vertical accordion: Nodes / Relations / Sequences (single open) */}
          <div className="rp-pane">
            <AccordionSection title="Nodes" count={nodesCount}
              open={openSection === 'nodes'} onToggle={() => setOpenSection('nodes')}>
              {rootNodes.length === 0
                ? <div className="lp-empty-state" style={{ padding: '4px 12px 8px' }}>No nodes.</div>
                : rootNodes.map((n) => <TreeNodeItem key={n.id} nodeId={n.id} depth={0} />)
              }
            </AccordionSection>
            <AccordionSection title="Relations" count={relationsCount}
              open={openSection === 'relations'} onToggle={() => setOpenSection('relations')}>
              <RelationsSection />
            </AccordionSection>
            <AccordionSection title="Sequences" count={sequencesCount}
              open={openSection === 'sequences'} onToggle={() => setOpenSection('sequences')}>
              <SequenceList readOnly={readOnly} compact={true} />
            </AccordionSection>
          </div>

          {/* Pane 2 — Properties (horizontal slide-in) */}
          <div className="rp-pane">
            <button className="rp-back-btn" onClick={handleBack}>
              ◀ Back
            </button>
            {pane2Content()}
          </div>

        </div>
      </div>
      {onToggleCollapsed && (
        <PanelToggle side="right" collapsed={collapsed} onToggle={onToggleCollapsed} />
      )}
    </div>
  )
}

