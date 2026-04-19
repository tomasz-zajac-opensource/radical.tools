import React, { useCallback, useState, useEffect, useRef } from 'react'
import { useDiagramStore } from '../store/diagramStore'

// ── SVG icons ────────────────────────────────────────────────────────────────

const IconELK = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5}>
    <path d="M8 2v12M2 8h12" />
    <circle cx="8" cy="8" r="3" />
  </svg>
)

const IconCola = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5}>
    <circle cx="4" cy="4" r="2" />
    <circle cx="12" cy="4" r="2" />
    <circle cx="4" cy="12" r="2" />
    <circle cx="12" cy="12" r="2" />
    <path d="M6 4h4M4 6v4M12 6v4M6 12h4" />
  </svg>
)

const IconRadical = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5}>
    <path d="M8 1v14M1 8h14" />
    <path d="M3 3l10 10M13 3L3 13" />
    <circle cx="8" cy="8" r="2" fill="currentColor" />
  </svg>
)

const IconHola = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5}>
    <rect x="2" y="2" width="5" height="5" rx="1" />
    <rect x="9" y="2" width="5" height="5" rx="1" />
    <rect x="5.5" y="9" width="5" height="5" rx="1" />
    <path d="M4.5 7v2.5H6M11.5 7v2.5H10" />
  </svg>
)

const IconSave = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5}>
    <rect x="2" y="2" width="12" height="12" rx="2" />
    <path d="M5 2v4h6V2M5 10h6" />
  </svg>
)

const IconNew = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5}>
    <rect x="3" y="1" width="10" height="14" rx="1.5" />
    <path d="M6 8h4M8 6v4" />
  </svg>
)

const IconLoad = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5}>
    <path d="M3 12V4a1 1 0 011-1h3l2 2h3a1 1 0 011 1v6a1 1 0 01-1 1H4a1 1 0 01-1-1z" />
    <path d="M8 7v5M6 10l2 2 2-2" />
  </svg>
)

const IconReset = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5}>
    <path d="M3 8a5 5 0 105-5H6M6 1L3 4l3 3" />
  </svg>
)

const IconFitAll = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5}>
    <path d="M2 5V2h3M11 2h3v3M14 11v3h-3M5 14H2v-3" />
    <rect x="5" y="5" width="6" height="6" rx="1" />
  </svg>
)

const IconReference = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5}>
    <rect x="1" y="1" width="14" height="14" rx="2" />
    <path d="M1 6h14M6 6v9M10 6v9" />
    <circle cx="3.5" cy="3.5" r="1" fill="currentColor" />
  </svg>
)

const IconSun = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5}>
    <circle cx="8" cy="8" r="3" />
    <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.41 1.41M11.54 11.54l1.41 1.41M3.05 12.95l1.41-1.41M11.54 4.46l1.41-1.41" />
  </svg>
)

const IconMoon = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5}>
    <path d="M13.5 8.5a5.5 5.5 0 01-7-7 5.5 5.5 0 107 7z" />
  </svg>
)

const IconUndo = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5}>
    <path d="M3 7h7a3 3 0 110 6H8" />
    <path d="M6 4L3 7l3 3" />
  </svg>
)

const IconRedo = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5}>
    <path d="M13 7H6a3 3 0 100 6h2" />
    <path d="M10 4l3 3-3 3" />
  </svg>
)

const IconSnapshot = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5}>
    <rect x="2" y="3" width="12" height="10" rx="1.5" />
    <circle cx="8" cy="8" r="2.5" />
    <circle cx="11" cy="5.5" r="0.8" fill="currentColor" />
  </svg>
)

// ── Toolbar ───────────────────────────────────────────────────────────────────

export function Toolbar(): React.ReactElement {
  const newDiagram = useDiagramStore((s) => s.newDiagram)
  const saveDiagram = useDiagramStore((s) => s.saveDiagram)
  const loadDiagram = useDiagramStore((s) => s.loadDiagram)
  const resetDiagram = useDiagramStore((s) => s.resetDiagram)
  const autoFitActive = useDiagramStore((s) => s.autoFitActive)
  const toggleAutoFit = useDiagramStore((s) => s.toggleAutoFit)
  const connectionModifier = useDiagramStore((s) => s.connectionModifier)
  const setConnectionModifier = useDiagramStore((s) => s.setConnectionModifier)

  const undo = useDiagramStore((s) => s.undo)
  const redo = useDiagramStore((s) => s.redo)
  const canUndo = useDiagramStore((s) => s.canUndo)
  const canRedo = useDiagramStore((s) => s.canRedo)

  const snapshots = useDiagramStore((s) => s.snapshots)
  const createSnapshot = useDiagramStore((s) => s.createSnapshot)
  const restoreSnapshot = useDiagramStore((s) => s.restoreSnapshot)
  const removeSnapshot = useDiagramStore((s) => s.removeSnapshot)
  const renameSnapshot = useDiagramStore((s) => s.renameSnapshot)

  const [snapshotMenuOpen, setSnapshotMenuOpen] = useState(false)
  const snapshotMenuRef = useRef<HTMLDivElement>(null)
  const [editingSnapshotId, setEditingSnapshotId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [creatingSnapshot, setCreatingSnapshot] = useState(false)
  const [newSnapshotName, setNewSnapshotName] = useState('')

  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    return (localStorage.getItem('radical-theme') as 'dark' | 'light') || 'dark'
  })

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('radical-theme', theme)
  }, [theme])

  const toggleTheme = useCallback(() => {
    setTheme((t) => (t === 'dark' ? 'light' : 'dark'))
  }, [])

  // Close snapshot menu on outside click
  useEffect(() => {
    if (!snapshotMenuOpen) return
    const handler = (e: MouseEvent) => {
      if (snapshotMenuRef.current && !snapshotMenuRef.current.contains(e.target as Node)) {
        setSnapshotMenuOpen(false)
        setEditingSnapshotId(null)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [snapshotMenuOpen])

  // Keyboard shortcuts: Cmd+Z / Cmd+Shift+Z (Mac), Ctrl+Z / Ctrl+Shift+Z (Win)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (!mod) return
      if (e.key === 'z' && !e.shiftKey) {
        e.preventDefault()
        useDiagramStore.getState().undo()
      } else if ((e.key === 'z' && e.shiftKey) || e.key === 'y') {
        e.preventDefault()
        useDiagramStore.getState().redo()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const handleStartCreate = useCallback(() => {
    setNewSnapshotName(`v${snapshots.length + 1}`)
    setCreatingSnapshot(true)
  }, [snapshots.length])

  const handleConfirmCreate = useCallback(() => {
    const name = newSnapshotName.trim()
    if (name) createSnapshot(name)
    setCreatingSnapshot(false)
    setNewSnapshotName('')
  }, [createSnapshot, newSnapshotName])

  const handleRestoreSnapshot = useCallback((id: string) => {
    if (window.confirm('Restore this snapshot? Current state will be saved to undo history.')) {
      restoreSnapshot(id)
    }
  }, [restoreSnapshot])

  const handleNew = useCallback(() => {
    if (window.confirm('Create a new empty diagram? All unsaved changes will be lost.')) {
      newDiagram()
    }
  }, [newDiagram])

  const handleSave = useCallback(async () => {
    const data = saveDiagram()
    const json = JSON.stringify(data, null, 2)
    if (window.electronAPI?.saveDiagram) {
      const result = await window.electronAPI.saveDiagram(json)
      if (!result.success) return // user cancelled
    } else {
      // Fallback for browser / non-electron context
      const blob = new Blob([json], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'diagram.c4.json'
      a.click()
      URL.revokeObjectURL(url)
    }
  }, [saveDiagram])

  const handleLoad = useCallback(async () => {
    if (window.electronAPI?.openDiagram) {
      const result = await window.electronAPI.openDiagram()
      if (!result.success || !result.content) return
      try {
        const data = JSON.parse(result.content)
        loadDiagram(data)
      } catch {
        alert('Invalid diagram file.')
      }
    } else {
      // Fallback for browser / non-electron context
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = '.json,.c4.json'
      input.onchange = async (e) => {
        const file = (e.target as HTMLInputElement).files?.[0]
        if (!file) return
        try {
          const text = await file.text()
          const data = JSON.parse(text)
          loadDiagram(data)
        } catch {
          alert('Invalid diagram file.')
        }
      }
      input.click()
    }
  }, [loadDiagram])

  const handleReset = useCallback(() => {
    if (window.confirm('Reset diagram to example? All changes will be lost.')) {
      resetDiagram()
    }
  }, [resetDiagram])

  return (
    <div className="toolbar">
      <span className="toolbar-title">⬡ Radical Diagram</span>

      <div className="toolbar-sep" />

      <button className="toolbar-btn" onClick={handleNew} title="New empty diagram">
        <IconNew /> New
      </button>
      <button className="toolbar-btn" onClick={handleSave} title="Save diagram as JSON">
        <IconSave /> Save
      </button>
      <button className="toolbar-btn" onClick={handleLoad} title="Load diagram from JSON">
        <IconLoad /> Load
      </button>
      <button className="toolbar-btn danger" onClick={handleReset} title="Reset to example">
        <IconReset /> Reset
      </button>
      <button
        className={`toolbar-btn${autoFitActive ? ' active' : ''}`}
        onClick={toggleAutoFit}
        title={autoFitActive ? 'Disable auto-fit' : 'Enable auto-fit'}
      >
        <IconFitAll /> Auto Fit
      </button>

      <div className="toolbar-sep" />

      <button
        className="toolbar-btn"
        onClick={undo}
        disabled={!canUndo}
        title="Undo (⌘Z)"
      >
        <IconUndo /> Undo
      </button>
      <button
        className="toolbar-btn"
        onClick={redo}
        disabled={!canRedo}
        title="Redo (⌘⇧Z)"
      >
        <IconRedo /> Redo
      </button>

      <div className="toolbar-sep" />

      <div className="toolbar-dropdown" ref={snapshotMenuRef}>
        <button
          className="toolbar-btn"
          onClick={() => setSnapshotMenuOpen((o) => !o)}
          title="Snapshots (versions)"
        >
          <IconSnapshot /> Snapshots{snapshots.length > 0 ? ` (${snapshots.length})` : ''}
        </button>
        {snapshotMenuOpen && (
          <div className="toolbar-dropdown-menu">
            {creatingSnapshot ? (
              <div className="toolbar-dropdown-item create-input">
                <input
                  className="snapshot-rename-input"
                  autoFocus
                  placeholder="Snapshot name"
                  value={newSnapshotName}
                  onChange={(e) => setNewSnapshotName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleConfirmCreate()
                    else if (e.key === 'Escape') { setCreatingSnapshot(false); setNewSnapshotName('') }
                  }}
                />
                <button className="snapshot-action restore" onClick={handleConfirmCreate} title="Create">✓</button>
                <button className="snapshot-action delete" onClick={() => { setCreatingSnapshot(false); setNewSnapshotName('') }} title="Cancel">✕</button>
              </div>
            ) : (
              <button className="toolbar-dropdown-item create" onClick={handleStartCreate}>
                + Create snapshot
              </button>
            )}
            {snapshots.length === 0 && (
              <div className="toolbar-dropdown-empty">No snapshots yet</div>
            )}
            {[...snapshots].reverse().map((snap) => (
              <div key={snap.id} className="toolbar-dropdown-item snapshot-item">
                {editingSnapshotId === snap.id ? (
                  <input
                    className="snapshot-rename-input"
                    autoFocus
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                    onBlur={() => {
                      if (editingName.trim()) renameSnapshot(snap.id, editingName.trim())
                      setEditingSnapshotId(null)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        if (editingName.trim()) renameSnapshot(snap.id, editingName.trim())
                        setEditingSnapshotId(null)
                      } else if (e.key === 'Escape') {
                        setEditingSnapshotId(null)
                      }
                    }}
                  />
                ) : (
                  <span
                    className="snapshot-name"
                    onDoubleClick={() => { setEditingSnapshotId(snap.id); setEditingName(snap.name) }}
                    title="Double-click to rename"
                  >
                    {snap.name}
                  </span>
                )}
                <span className="snapshot-time">
                  {new Date(snap.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
                <button
                  className="snapshot-action restore"
                  onClick={() => handleRestoreSnapshot(snap.id)}
                  title="Restore"
                >
                  ↩
                </button>
                <button
                  className="snapshot-action delete"
                  onClick={() => removeSnapshot(snap.id)}
                  title="Delete"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="toolbar-sep" />

      <label className="toolbar-label" title="Key to hold when clicking nodes to create connections">
        Connect key
        <select
          className="toolbar-select"
          value={connectionModifier}
          onChange={(e) => setConnectionModifier(e.target.value as any)}
        >
          <option value="alt">{navigator.platform?.includes('Mac') ? '⌥ Option' : 'Alt'}</option>
          <option value="shift">⇧ Shift</option>
          <option value="ctrl">Ctrl</option>
          <option value="meta">{navigator.platform?.includes('Mac') ? '⌘ Cmd' : '⊞ Win'}</option>
        </select>
      </label>

      <div style={{ flex: 1 }} />

      <button
        className="toolbar-btn"
        onClick={toggleTheme}
        title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      >
        {theme === 'dark' ? <IconSun /> : <IconMoon />}
        {theme === 'dark' ? 'Light' : 'Dark'}
      </button>
    </div>
  )
}
