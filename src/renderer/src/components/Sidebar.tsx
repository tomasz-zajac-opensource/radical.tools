import React from 'react'
import { useDiagramStore } from '../store/diagramStore'
import { C4ElementType, NODE_COLORS, TYPE_LABELS, TYPE_ICON_PATHS } from '../types/c4'

function C4Icon({ type, size = 12 }: { type: C4ElementType; size?: number }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill={NODE_COLORS[type]} style={{ flexShrink: 0 }}>
      <path d={TYPE_ICON_PATHS[type]} />
    </svg>
  )
}

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
      <div
        className="palette-badge"
        style={{ background: NODE_COLORS[type] }}
      >
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
          onClick={(e) => {
            if (!canCollapse) return
            e.stopPropagation()
            toggleCollapse(nodeId)
          }}
          style={{ cursor: canCollapse ? 'pointer' : 'default', opacity: canCollapse ? 1 : 0.3 }}
        >
          {canCollapse ? (node.collapsed ? '▶' : '▼') : '·'}
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
      {!node.collapsed &&
        children.map((c) => (
          <TreeNodeItem key={c.id} nodeId={c.id} depth={depth + 1} />
        ))}
    </>
  )
}

// ─── Sidebar ─────────────────────────────────────────────────────────────────

export function Sidebar({ open, onToggle }: { open: boolean; onToggle: () => void }): React.ReactElement {
  const allNodes = useDiagramStore((s) => s.c4Nodes)
  const rootNodes = Object.values(allNodes).filter((n) => !n.parentId)

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
            {PALETTE_ITEMS.map((item) => (
              <PaletteItem key={item.type} {...item} />
            ))}
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
              Drag to canvas · Double-click canvas to add System
            </div>
          </div>

          {/* Diagram tree */}
          <div className="diagram-tree">
            <div className="sidebar-section">
              <div className="sidebar-section-title">Diagram</div>
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
