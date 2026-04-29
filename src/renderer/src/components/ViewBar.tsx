import React, { useState, useRef, useEffect } from 'react'
import { useDiagramStore } from '../store/diagramStore'

export function ViewBar({ readOnly = false }: { readOnly?: boolean }): React.ReactElement {
  const views = useDiagramStore((s) => s.views)
  const activeViewId = useDiagramStore((s) => s.activeViewId)
  const setActiveView = useDiagramStore((s) => s.setActiveView)
  const addView = useDiagramStore((s) => s.addView)
  const removeView = useDiagramStore((s) => s.removeView)
  const renameView = useDiagramStore((s) => s.renameView)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editingId && inputRef.current) inputRef.current.focus()
  }, [editingId])

  const viewList = Object.values(views)

  const handleAdd = () => {
    const id = addView(`View ${viewList.length + 1}`)
    setActiveView(id)
    setEditingId(id)
    setEditName(`View ${viewList.length + 1}`)
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
        <button className="view-tab view-tab-add" onClick={handleAdd} title="New view">
          +
        </button>
      )}
    </div>
  )
}
