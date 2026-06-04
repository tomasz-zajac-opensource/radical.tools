import React, { useState, useRef, useEffect } from 'react'
import { useDiagramStore } from '../store/diagramStore'

type ViewKind = 'static' | 'dynamic' | 'treemap' | 'table'

const VIEW_KIND_OPTIONS: { kind: ViewKind; icon: string; label: string; desc: string }[] = [
  { kind: 'static',  icon: '⬡', label: 'Structure',  desc: 'C4 canvas with drag & drop' },
  { kind: 'dynamic', icon: '→', label: 'Flow',        desc: 'Sequence / interaction flow' },
  { kind: 'treemap', icon: '▦', label: 'Hierarchy',   desc: 'Nested hierarchy map' },
  { kind: 'table',   icon: '☰', label: 'Table',       desc: 'Editable spreadsheet' },
]

export function ViewBar({ readOnly = false }: { readOnly?: boolean }): React.ReactElement {
  const views = useDiagramStore((s) => s.views)
  const activeViewId = useDiagramStore((s) => s.activeViewId)
  const setActiveView = useDiagramStore((s) => s.setActiveView)
  const addView = useDiagramStore((s) => s.addView)
  const removeView = useDiagramStore((s) => s.removeView)
  const renameView = useDiagramStore((s) => s.renameView)
  const setViewLayoutMode = useDiagramStore((s) => s.setViewLayoutMode)
  const setViewKind = useDiagramStore((s) => s.setViewKind)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editingId && inputRef.current) inputRef.current.focus()
  }, [editingId])

  const viewList = Object.values(views)
  const activeView = activeViewId ? views[activeViewId] : null

  const [showAddMenu, setShowAddMenu] = useState(false)
  const [menuPos, setMenuPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 })
  const addBtnRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!showAddMenu) return
    const handler = (e: MouseEvent) => {
      const menu = document.querySelector('.vb-add-menu')
      if (
        addBtnRef.current && !addBtnRef.current.contains(e.target as Node) &&
        (!menu || !menu.contains(e.target as Node))
      ) {
        setShowAddMenu(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showAddMenu])

  const handleAddKind = (kind: ViewKind) => {
    setShowAddMenu(false)
    const name = `View ${viewList.length + 1}`
    const id = addView(name)
    setActiveView(id)
    setViewKind(id, kind)
    setEditingId(id)
    setEditName(name)
  }

  const openAddMenu = () => {
    if (addBtnRef.current) {
      const r = addBtnRef.current.getBoundingClientRect()
      setMenuPos({ top: r.bottom + 4, left: r.left })
    }
    setShowAddMenu((v) => !v)
  }

  const commitRename = () => {
    if (editingId && editName.trim()) {
      renameView(editingId, editName.trim())
    }
    setEditingId(null)
  }

  return (
    <div className="view-bar">
      <button
        className={`view-tab ${activeViewId === null ? 'active' : ''}`}
        onClick={() => setActiveView(null)}
      >
        All
      </button>
      {viewList.map((v) => (
        <div
          key={v.id}
          className={`view-tab ${activeViewId === v.id ? 'active' : ''}`}
          onClick={() => setActiveView(v.id)}
        >
          {!readOnly && editingId === v.id ? (
            <input
              ref={inputRef}
              className="view-tab-input"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename()
                if (e.key === 'Escape') setEditingId(null)
              }}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span
              onDoubleClick={readOnly ? undefined : (e) => {
                e.stopPropagation()
                setEditingId(v.id)
                setEditName(v.name)
              }}
            >
              {v.name}
            </span>
          )}
          {!readOnly && (
            <button
              className="view-tab-close"
              onClick={(e) => { e.stopPropagation(); removeView(v.id) }}
              title="Remove view"
            >
              ×
            </button>
          )}
        </div>
      ))}
      {!readOnly && (
        <>
          <button
            ref={addBtnRef}
            className="view-tab view-tab-add"
            onClick={openAddMenu}
            title="New view"
          >
            +
          </button>
          {showAddMenu && (
            <div
              className="vb-add-menu"
              style={{ position: 'fixed', top: menuPos.top, left: menuPos.left }}
            >
              {VIEW_KIND_OPTIONS.map(opt => (
                <button
                  key={opt.kind}
                  className="vb-add-item"
                  onClick={() => handleAddKind(opt.kind)}
                >
                  <span className="vb-add-icon">{opt.icon}</span>
                  <span className="vb-add-label">{opt.label}</span>
                  <span className="vb-add-desc">{opt.desc}</span>
                </button>
              ))}
            </div>
          )}
        </>
      )}
      {!readOnly && (
        <label
          className="view-layout-mode"
          title={
            activeView
              ? 'Visualization type for this view.'
              : 'Select a view to choose its visualization type.'
          }
          style={{
            marginLeft: 'auto',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 11,
            color: 'var(--text-muted)',
            padding: '0 8px',
            whiteSpace: 'nowrap',
            opacity: activeView ? 1 : 0.5,
          }}
        >
          <span>Viz:</span>
          <select
            value={activeView?.kind ?? 'static'}
            disabled={!activeView}
            onChange={(e) =>
              activeView && setViewKind(activeView.id, e.target.value as 'static' | 'dynamic' | 'treemap' | 'table')
            }
            style={{
              fontSize: 11,
              padding: '2px 4px',
              background: 'var(--input-bg, transparent)',
              color: 'inherit',
              border: '1px solid var(--border-color)',
              borderRadius: 3,
              cursor: activeView ? 'pointer' : 'not-allowed',
            }}
          >
            <option value="static">Structure</option>
            <option value="dynamic">Flow</option>
            <option value="treemap">Hierarchy</option>
            <option value="table">Table</option>
          </select>
        </label>
      )}
      {!readOnly && (activeView?.kind ?? 'static') !== 'treemap' && (activeView?.kind ?? 'static') !== 'table' && (
        <label
          className="view-layout-mode"
          title={
            activeView
              ? 'Auto-layout strategy applied when running Smart Layout for this view.'
              : 'Select a view to choose its auto-layout strategy.'
          }
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 11,
            color: 'var(--text-muted)',
            padding: '0 8px',
            whiteSpace: 'nowrap',
            opacity: activeView ? 1 : 0.5,
          }}
        >
          <span>Layout:</span>
          <select
            value={activeView?.layoutMode ?? 'auto'}
            disabled={!activeView}
            onChange={(e) =>
              activeView && setViewLayoutMode(activeView.id, e.target.value as 'auto' | 'tree')
            }
            style={{
              fontSize: 11,
              padding: '2px 4px',
              background: 'var(--input-bg, transparent)',
              color: 'inherit',
              border: '1px solid var(--border-color)',
              borderRadius: 3,
              cursor: activeView ? 'pointer' : 'not-allowed',
            }}
          >
            <option value="auto">Auto (Smart)</option>
            <option value="tree">Hierarchical tree</option>
          </select>
        </label>
      )}
    </div>
  )
}
