import React from 'react'
import { useDiagramStore, nodeEffectivelyCollapsedInView } from '../store/diagramStore'
import { C4ElementType, NODE_COLORS, TYPE_LABELS, TYPE_ICON_PATHS } from '../types/c4'

function C4Icon({ type, size = 12 }: { type: C4ElementType; size?: number }) {
  const mm = useDiagramStore((s) => s.metamodel)
  const def = mm?.nodeTypes[type]
  const color = def?.color ?? NODE_COLORS[type] ?? '#666'
  const icon  = def?.iconPath ?? TYPE_ICON_PATHS[type] ?? ''
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill={color} style={{ flexShrink: 0 }}>
      <path d={icon} />
    </svg>
  )
}

/** Optional sub-labels for the well-known C4 types; shown under the type name. */
const C4_SUBLABELS: Record<string, string> = {
  person:    'Actor / user',
  system:    'Software system',
  container: 'App, DB, service…',
  component: 'Class, module…',
  database:  'Database store',
  webapp:    'Web application',
  queue:     'Message queue / bus',
  domain:    'DDD problem space',
}

function PaletteItem({ typeId }: { typeId: string }) {
  const mm = useDiagramStore((s) => s.metamodel)
  const def = mm?.nodeTypes[typeId]
  const color = def?.color ?? NODE_COLORS[typeId as C4ElementType] ?? '#666'
  const icon  = def?.iconPath ?? TYPE_ICON_PATHS[typeId as C4ElementType] ?? ''
  const label = def?.label ?? TYPE_LABELS[typeId as C4ElementType] ?? typeId
  const sublabel = C4_SUBLABELS[typeId] ?? ''

  const onDragStart = (event: React.DragEvent) => {
    event.dataTransfer.setData('application/c4-type', typeId)
    event.dataTransfer.effectAllowed = 'copy'
  }

  return (
    <div className="palette-item" draggable onDragStart={onDragStart}>
      <div
        className="palette-badge"
        style={{ background: color }}
      >
        <svg viewBox="0 0 16 16" width="16" height="16" fill="#fff">
          <path d={icon} />
        </svg>
      </div>
      <div>
        <div className="palette-label">{label}</div>
        {sublabel && <div className="palette-sublabel">{sublabel}</div>}
      </div>
    </div>
  )
}

// ─── Tree view ────────────────────────────────────────────────────────────────

interface TreeNodeProps {
  nodeId: string
  depth: number
}

function TreeNodeItem({ nodeId, depth }: TreeNodeProps) {
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
  // For hierarchy/wiki views: empty nodeIds means "show all" (no filter), so all nodes are "in view".
  // For other view kinds: empty nodeIds means "nothing selected", so nodes are dimmed.
  const isHierarchy = activeView?.kind === 'treemap' || activeView?.kind === 'wiki'
  const inView = !activeView
    || (isHierarchy && activeView.nodeIds.length === 0)
    || activeView.nodeIds.includes(nodeId)
  // Effective collapsed: per-view if a named view is active, else model-level.
  // A model-collapsed node can be overridden in this view via expandedNodeIds.
  const isEffectivelyCollapsed = nodeEffectivelyCollapsedInView(node, activeViewId, activeView)

  const onDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData('application/c4-node-id', nodeId)
    e.dataTransfer.effectAllowed = 'copy'
    e.stopPropagation()
  }

  return (
    <>
      <div
        className={`tree-node ${isSelected ? 'selected' : ''}`}
        style={{ paddingLeft: 12 + depth * 14, opacity: inView ? 1 : 0.35 }}
        draggable
        onDragStart={onDragStart}
        onClick={() => selectNode(nodeId)}
      >
        <span
          className="tree-toggle"
          onClick={(e) => {
            if (!canCollapse) return
            e.stopPropagation()
            toggleCollapse(nodeId)
          }}
          style={{ cursor: canCollapse ? 'pointer' : 'default', opacity: canCollapse ? 1 : 0.3 }}
        >
          {canCollapse ? (isEffectivelyCollapsed ? '▶' : '▼') : '·'}
        </span>
        <span
          className="tree-badge"
        >
          <C4Icon type={node.type} size={10} />
        </span>
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
      {!isEffectivelyCollapsed &&
        children.map((c) => (
          <TreeNodeItem key={c.id} nodeId={c.id} depth={depth + 1} />
        ))}
    </>
  )
}

// ─── Sidebar ─────────────────────────────────────────────────────────────────

export function Sidebar({ open, onToggle }: { open: boolean; onToggle: () => void }): React.ReactElement {
  const allNodes = useDiagramStore((s) => s.c4Nodes)
  const metamodel = useDiagramStore((s) => s.metamodel)
  const rootNodes = Object.values(allNodes).filter((n) => !n.parentId)

  // Order: domain first (when present), then standard C4 order, then any custom types last.
  const C4_ORDER = ['domain', 'person', 'system', 'container', 'component', 'database', 'webapp', 'queue']
  const allTypeIds = metamodel ? Object.keys(metamodel.nodeTypes) : C4_ORDER
  const paletteIds = [
    ...C4_ORDER.filter(t => allTypeIds.includes(t)),
    ...allTypeIds.filter(t => !C4_ORDER.includes(t)),
  ]

  return (
    <div className={`sidebar ${open ? '' : 'sidebar--closed'}`}>
      <button className="sidebar-toggle" onClick={onToggle} title={open ? 'Collapse sidebar' : 'Expand sidebar'}>
        {open ? '◀' : '▶'}
      </button>
      {open && (
        <>
          {/* Palette */}
          <div className="sidebar-section">
            <div className="sidebar-section-title">Elements</div>
            {paletteIds.map((typeId) => (
              <PaletteItem key={typeId} typeId={typeId} />
            ))}
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
              Drag to canvas · Double-click canvas to add System
            </div>
          </div>

          {/* Diagram tree */}
          <div className="diagram-tree">
            <div className="sidebar-section">
              <div className="sidebar-section-title">Model</div>
            </div>
            {rootNodes.map((n) => (
              <TreeNodeItem key={n.id} nodeId={n.id} depth={0} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
