import React, { ChangeEvent, useState, useMemo } from 'react'
import { useDiagramStore } from '../store/diagramStore'
import { C4ElementType, NODE_COLORS, TYPE_LABELS, TYPE_ICON_PATHS, NODE_FG } from '../types/c4'
import { AIPanel } from './AIPanel'
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

const PALETTE_ITEMS: { type: C4ElementType; sublabel: string }[] = [
  { type: 'person',    sublabel: 'Actor / user' },
  { type: 'system',    sublabel: 'Software system' },
  { type: 'container', sublabel: 'App, DB, service…' },
  { type: 'component', sublabel: 'Class, module…' },
  { type: 'database',  sublabel: 'Database store' },
  { type: 'webapp',    sublabel: 'Web application' },
  { type: 'queue',     sublabel: 'Message queue / bus' },
]

function PaletteItem({ type, sublabel }: { type: C4ElementType; sublabel: string }) {
  const onDragStart = (event: React.DragEvent) => {
    event.dataTransfer.setData('application/c4-type', type)
    event.dataTransfer.effectAllowed = 'copy'
  }
  return (
    <div className="palette-item" draggable onDragStart={onDragStart}>
      <div className="palette-badge" style={{ background: NODE_COLORS[type] }}>
        <svg viewBox="0 0 16 16" width="16" height="16" fill="#fff">
          <path d={TYPE_ICON_PATHS[type]} />
        </svg>
      </div>
      <div>
        <div className="palette-label">{TYPE_LABELS[type]}</div>
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
  const canCollapse = (node.type === 'system' || node.type === 'container') && hasChildren
  const inView = !activeView || activeView.nodeIds.includes(nodeId)

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
          {canCollapse ? (node.collapsed ? '▶' : '▼') : '·'}
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
      {!node.collapsed && children.map((c) => (
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
  title, defaultOpen = true, children, count,
}: { title: string; defaultOpen?: boolean; children: React.ReactNode; count?: number }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="lp-section">
      <button className="lp-section-header" onClick={() => setOpen((o) => !o)}>
        <span className="lp-section-title">
          <svg className={`lp-section-chevron${open ? ' open' : ''}`} viewBox="0 0 16 16" width="10" height="10" aria-hidden>
            <path d="M5 3 L11 8 L5 13" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <span>{title}</span>
          {count != null && count > 0 && <span className="lp-section-count">{count}</span>}
        </span>
      </button>
      {open && <div className="lp-section-body">{children}</div>}
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

function SnapshotList({ readOnly = false }: { readOnly?: boolean }) {
  const snapshots = useDiagramStore((s) => s.snapshots)
  const activeSnapshotId = useDiagramStore((s) => s.activeSnapshotId)
  const createSnapshot = useDiagramStore((s) => s.createSnapshot)
  const removeSnapshot = useDiagramStore((s) => s.removeSnapshot)
  const renameSnapshot = useDiagramStore((s) => s.renameSnapshot)
  const viewMilestoneDiff = useDiagramStore((s) => s.selectMilestone)
  const clearMilestoneView = useDiagramStore((s) => s.discardMilestoneChanges)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')

  const confirmCreate = () => {
    const name = newName.trim()
    if (name) createSnapshot(name)
    setCreating(false)
    setNewName('')
  }

  const commitRename = () => {
    if (editingId && editName.trim()) renameSnapshot(editingId, editName.trim())
    setEditingId(null)
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
        const isEditing = editingId === snap.id
        const versionNum = snapshots.length - idx
        const nodeCount = Object.keys(snap.nodes).length
        return (
          <div
            key={snap.id}
            className={`lp-card lp-snap-card${isActive ? ' active' : ''}`}
            onClick={() => { if (!isEditing) viewMilestoneDiff(snap.id) }}
            title={`${new Date(snap.timestamp).toLocaleString()}\nClick to load this milestone onto the canvas`}
          >
            <div className="lp-snap-badge">v{versionNum}</div>
            <div className="lp-card-body">
              {!readOnly && isEditing ? (
                <input
                  className="lp-inline-input"
                  autoFocus
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onBlur={commitRename}
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setEditingId(null) }}
                />
              ) : (
                <div
                  className="lp-card-title"
                  onDoubleClick={readOnly ? undefined : (e) => { e.stopPropagation(); setEditingId(snap.id); setEditName(snap.name) }}
                  title={readOnly ? undefined : 'Double-click to rename'}
                >
                  {snap.name}
                </div>
              )}
              {!isEditing && (
                <div className="lp-card-meta">
                  <span>{formatRelative(snap.timestamp)}</span>
                  <span className="lp-meta-dot">·</span>
                  <span>{nodeCount} {nodeCount === 1 ? 'node' : 'nodes'}</span>
                </div>
              )}
            </div>
            {!readOnly && !isEditing && (
              <div className="lp-card-actions">
                <button
                  className="lp-icon-btn"
                  title="Rename milestone"
                  onClick={(e) => { e.stopPropagation(); setEditingId(snap.id); setEditName(snap.name) }}
                ><Icon.Pencil /></button>
                <button
                  className="lp-icon-btn danger"
                  title="Delete milestone"
                  onClick={(e) => { e.stopPropagation(); removeSnapshot(snap.id) }}
                ><Icon.Trash /></button>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── View list (left panel) ────────────────────────────────────────────────────

function ViewList({ readOnly = false }: { readOnly?: boolean }) {
  const views = useDiagramStore((s) => s.views)
  const activeViewId = useDiagramStore((s) => s.activeViewId)
  const setActiveView = useDiagramStore((s) => s.setActiveView)
  const addView = useDiagramStore((s) => s.addView)
  const removeView = useDiagramStore((s) => s.removeView)
  const renameView = useDiagramStore((s) => s.renameView)
  const totalNodes = useDiagramStore((s) => Object.keys(s.c4Nodes).length)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const viewList = Object.values(views)

  const commit = () => {
    if (editingId && editName.trim()) renameView(editingId, editName.trim())
    setEditingId(null)
  }

  return (
    <div className="lp-view-list">
      <div
        className={`lp-card lp-view-card${activeViewId === null ? ' active' : ''}`}
        onClick={() => setActiveView(null)}
      >
        <div className="lp-view-icon"><Icon.Globe /></div>
        <div className="lp-card-body">
          <div className="lp-card-title">All elements</div>
          <div className="lp-card-meta"><span>{totalNodes} {totalNodes === 1 ? 'node' : 'nodes'}</span></div>
        </div>
      </div>
      {viewList.map((v) => {
        const isActive = activeViewId === v.id
        const isEditing = editingId === v.id
        return (
          <div
            key={v.id}
            className={`lp-card lp-view-card${isActive ? ' active' : ''}`}
            onClick={() => !isEditing && setActiveView(v.id)}
          >
            <div className="lp-view-icon"><Icon.Layers /></div>
            <div className="lp-card-body">
              {!readOnly && isEditing ? (
                <input
                  className="lp-inline-input"
                  autoFocus
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onBlur={commit}
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditingId(null) }}
                />
              ) : (
                <div
                  className="lp-card-title"
                  onDoubleClick={readOnly ? undefined : (e) => { e.stopPropagation(); setEditingId(v.id); setEditName(v.name) }}
                >
                  {v.name}
                </div>
              )}
              {!isEditing && (
                <div className="lp-card-meta">
                  <span>{v.nodeIds.length} {v.nodeIds.length === 1 ? 'node' : 'nodes'}</span>
                </div>
              )}
            </div>
            {!readOnly && !isEditing && (
              <div className="lp-card-actions">
                <button
                  className="lp-icon-btn"
                  onClick={(e) => { e.stopPropagation(); setEditingId(v.id); setEditName(v.name) }}
                  title="Rename view"
                ><Icon.Pencil /></button>
                <button
                  className="lp-icon-btn danger"
                  onClick={(e) => { e.stopPropagation(); removeView(v.id) }}
                  title="Delete view"
                ><Icon.Trash /></button>
              </div>
            )}
          </div>
        )
      })}
      {!readOnly && (
        <button className="lp-add-btn" onClick={() => {
          const id = addView(`View ${viewList.length + 1}`)
          setActiveView(id)
          setEditingId(id)
          setEditName(`View ${viewList.length + 1}`)
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

  const toggle = onToggleCollapsed && (
    <PanelToggle side="left" collapsed={collapsed} onToggle={onToggleCollapsed} />
  )

  if (mode === 'viewer') {
    return (
      <div className={`left-panel${collapsed ? ' collapsed' : ''}`}>
        <div className="panel-content">
          <AccordionSection title="Views" count={viewsCount}>
            <ViewList readOnly={true} />
          </AccordionSection>
          <AccordionSection title="Milestones" defaultOpen={false} count={snapshotsCount}>
            <SnapshotList readOnly={true} />
          </AccordionSection>
        </div>
        {toggle}
      </div>
    )
  }

  return (
    <div className={`left-panel${collapsed ? ' collapsed' : ''}`}>
      <div className="panel-content">
        {mode === 'designer' && (
          <AccordionSection title="Elements">
            {PALETTE_ITEMS.map((item) => (
              <PaletteItem key={item.type} {...item} />
            ))}
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4, padding: '0 4px' }}>
              Drag to canvas · Double-click canvas to add System
            </div>
          </AccordionSection>
        )}
        {mode === 'designer' && !isReadOnly && (
          <AccordionSection title="AI Assistant" defaultOpen={false}>
            <AIPanel />
          </AccordionSection>
        )}
        <AccordionSection title="Views" count={viewsCount}>
          <ViewList readOnly={isReadOnly} />
        </AccordionSection>
        <AccordionSection title="Milestones" defaultOpen={false} count={snapshotsCount}>
          <SnapshotList readOnly={isReadOnly} />
        </AccordionSection>
      </div>
      {toggle}
    </div>
  )
}

// ── RightPanel (tree + properties accordion) ──────────────────────────────────

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
  const rootNodes = Object.values(allNodes).filter((n) => !n.parentId)
  const hasSelection = !!(selectedNodeId || selectedEdgeId)

  const handleBack = () => {
    selectNode(null)
    selectEdge(null)
  }

  return (
    <div className={`right-panel${collapsed ? ' collapsed' : ''}`}>
      <div className="panel-content">
        <div className={`rp-slider${hasSelection ? ' show-props' : ''}`}>

          {/* Pane 1 — Tree */}
          <div className="rp-pane">
            <div className="sidebar-section">
              <div className="sidebar-section-title">Model</div>
            </div>
            {rootNodes.map((n) => (
              <TreeNodeItem key={n.id} nodeId={n.id} depth={0} />
            ))}
            <div className="sidebar-section" style={{ marginTop: 12 }}>
              <div className="sidebar-section-title">Relations</div>
            </div>
            <RelationsSection />
          </div>

          {/* Pane 2 — Properties */}
          <div className="rp-pane">
            <button className="rp-back-btn" onClick={handleBack}>
              ◀ Back
            </button>
            <PropertiesContent readOnly={readOnly} />
          </div>

        </div>
      </div>
      {onToggleCollapsed && (
        <PanelToggle side="right" collapsed={collapsed} onToggle={onToggleCollapsed} />
      )}
    </div>
  )
}

