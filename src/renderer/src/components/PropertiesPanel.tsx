import React, { useCallback, ChangeEvent } from 'react'
import { useDiagramStore } from '../store/diagramStore'
import { C4ElementType, NODE_COLORS, TYPE_LABELS, TYPE_ICON_PATHS, NODE_FG } from '../types/c4'

const TYPE_BG: Record<C4ElementType, string> = NODE_COLORS

export function PropertiesPanel({ open, onToggle }: { open: boolean; onToggle: () => void }): React.ReactElement {
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

  // ── Node properties ──────────────────────────────────────────────────────
  if (selectedNodeId && c4Nodes[selectedNodeId]) {
    const node = c4Nodes[selectedNodeId]

    const field = (
      label: string,
      key: keyof typeof node,
      type: 'text' | 'textarea' | 'checkbox' = 'text'
    ) => {
      const value = node[key]
      const onChange = (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
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
              <input
                type="checkbox"
                checked={Boolean(value)}
                onChange={onChange}
                style={{ accentColor: 'var(--accent)' }}
              />
              {label}
            </label>
          </div>
        )
      }
      if (type === 'textarea') {
        return (
          <div className="props-field" key={key}>
            <label className="props-label">{label}</label>
            <textarea
              className="props-textarea"
              value={String(value ?? '')}
              onChange={onChange}
            />
          </div>
        )
      }
      return (
        <div className="props-field" key={key}>
          <label className="props-label">{label}</label>
          <input
            className="props-input"
            value={String(value ?? '')}
            onChange={onChange}
          />
        </div>
      )
    }

    const parentSelector = node.type === 'container' || node.type === 'component' || node.type === 'database' || node.type === 'webapp' || node.type === 'queue' ? (
      <div className="props-field">
        <label className="props-label">Parent</label>
        <select
          className="props-input"
          value={node.parentId ?? ''}
          onChange={(e) => updateNode(node.id, { parentId: e.target.value || undefined })}
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
            .map((n) => (
              <option key={n.id} value={n.id}>
                {n.label}
              </option>
            ))}
        </select>
      </div>
    ) : null

    return (
      <div className={`props-panel ${open ? '' : 'props-panel--closed'}`}>
        <button className="props-toggle" onClick={onToggle} title={open ? 'Collapse panel' : 'Expand panel'}>
          {open ? '▶' : '◀'}
        </button>
        {open && (
          <div className="props-content">
            <div
              className="props-type-badge"
              style={{ background: TYPE_BG[node.type], color: NODE_FG[node.type] }}
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

            <button
              className="props-delete"
              onClick={() => {
                removeNode(node.id)
                selectNode(null)
              }}
            >
              🗑 Delete node (and children)
            </button>
          </div>
        )}
      </div>
    )
  }

  // ── Edge properties ──────────────────────────────────────────────────────
  if (selectedEdgeId) {
    // Find the C4 relation. Virtual edges have id like "virtual-src→tgt"
    const relId = selectedEdgeId.startsWith('virtual-')
      ? null
      : selectedEdgeId
    const rel = relId ? c4Relations[relId] : null

    if (rel) {
      return (
        <div className={`props-panel ${open ? '' : 'props-panel--closed'}`}>
          <button className="props-toggle" onClick={onToggle} title={open ? 'Collapse panel' : 'Expand panel'}>
            {open ? '▶' : '◀'}
          </button>
          {open && (
            <div className="props-content">
              <div className="props-type-badge" style={{ background: '#334155', color: '#94a3b8' }}>
                RELATION
              </div>
              <div>
                <div className="props-section-title">Properties</div>
                <div className="props-field">
                  <label className="props-label">Label</label>
                  <input
                    className="props-input"
                    value={rel.label ?? ''}
                    onChange={(e) => updateRelation(rel.id, { label: e.target.value })}
                  />
                </div>
                <div className="props-field">
                  <label className="props-label">Technology</label>
                  <input
                    className="props-input"
                    value={rel.technology ?? ''}
                    onChange={(e) => updateRelation(rel.id, { technology: e.target.value })}
                  />
                </div>
              </div>
              <button
                className="props-delete"
                onClick={() => {
                  removeRelation(rel.id)
                  selectEdge(null)
                }}
              >
                🗑 Delete relation
              </button>
            </div>
          )}
        </div>
      )
    }

    return (
      <div className={`props-panel ${open ? '' : 'props-panel--closed'}`}>
        <button className="props-toggle" onClick={onToggle} title={open ? 'Collapse panel' : 'Expand panel'}>
          {open ? '▶' : '◀'}
        </button>
        {open && (
          <div className="props-content">
            <div className="props-empty">
              Virtual relation (collapsed nodes)
              <br />
              Expand parent nodes to edit individual relations.
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className={`props-panel ${open ? '' : 'props-panel--closed'}`}>
      <button className="props-toggle" onClick={onToggle} title={open ? 'Collapse panel' : 'Expand panel'}>
        {open ? '▶' : '◀'}
      </button>
    </div>
  )
}
