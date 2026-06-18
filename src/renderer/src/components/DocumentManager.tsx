import React, { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { documents, useDocumentsStore, type DocumentMeta, type DocumentSource } from '../store/documentStore'
import { useDiagramStore } from '../store/diagramStore'
import { availableMetamodels } from '../types/metamodel'

interface Props {
  open: boolean
  onClose: () => void
}

type TabKey = DocumentSource

function fmtTime(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleString()
}

const TABS: ReadonlyArray<{ key: TabKey; label: string; hint: string }> = [
  { key: 'ls', label: 'Local storage', hint: 'Models saved inside the app (browser localStorage).' },
  { key: 'fs', label: 'Files',         hint: 'Models backed by a JSON file on disk.' },
]

export function DocumentManagerModal({ open, onClose }: Props): React.ReactElement | null {
  const docs = useDocumentsStore((s) => s.docs)
  const activeId = useDocumentsStore((s) => s.activeId)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  // Inline "create new local diagram" form. Electron's BrowserWindow has
  // window.prompt disabled (returns null silently), so we render an in-modal
  // input row instead of relying on the browser dialog.
  const [creatingNew, setCreatingNew] = useState(false)
  const [newName, setNewName] = useState('')
  const presets = useMemo(() => availableMetamodels(), [])
  const [newPresetId, setNewPresetId] = useState<string>('c4-ddd-governance-builtin')
  const saveDiagram = useDiagramStore((s) => s.saveDiagram)

  // Default the visible tab to the source of the active document so users
  // land on the section they're most likely editing.
  const activeDoc = docs.find((d) => d.id === activeId)
  const [tab, setTab] = useState<TabKey>(activeDoc?.source ?? 'ls')

  // When the modal re-opens, re-sync the tab to the active document so the
  // user sees the relevant section without having to click.
  useEffect(() => {
    if (open && activeDoc) setTab(activeDoc.source)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const counts = useMemo(() => {
    const c: Record<TabKey, number> = { ls: 0, fs: 0 }
    for (const d of docs) c[d.source]++
    return c
  }, [docs])

  const visible = useMemo(
    () => docs.filter((d) => d.source === tab).sort((a, b) => b.lastModified - a.lastModified),
    [docs, tab],
  )

  if (!open) return null

  const handleNewLSStart = (): void => {
    setCreatingNew(true)
    setNewName('Untitled')
    setNewPresetId('c4-ddd-governance-builtin')
    setTab('ls')
  }

  const handleNewLSCommit = (): void => {
    const name = newName.trim() || 'Untitled'
    const preset = presets.find((p) => p.id === newPresetId)
    const data: any = { nodes: [], relations: [] }
    if (preset) data.metamodel = preset.build()
    documents.createLSDocument(name, data)
    setCreatingNew(false)
    setNewName('')
    setTab('ls')
  }

  const handleNewLSCancel = (): void => {
    setCreatingNew(false)
    setNewName('')
  }

  const handleImportFile = async (): Promise<void> => {
    const meta = await documents.importFromFile()
    if (meta) setTab('fs')
  }

  const handleSwitch = (id: string): void => {
    if (id === activeId) return
    documents.setActiveId(id)
  }

  const handleRenameStart = (d: DocumentMeta): void => {
    setRenamingId(d.id)
    setRenameValue(d.name)
  }

  const handleRenameCommit = (): void => {
    if (renamingId) documents.renameDocument(renamingId, renameValue)
    setRenamingId(null)
    setRenameValue('')
  }

  const handleDelete = (d: DocumentMeta): void => {
    const which = d.source === 'fs'
      ? `Remove "${d.name}" from the library?\n\n(The file on disk will NOT be deleted.)`
      : `Permanently delete "${d.name}" from local storage?`
    if (!window.confirm(which)) return
    documents.deleteDocument(d.id)
  }

  const handleSaveAs = async (d: DocumentMeta): Promise<void> => {
    // Save the *current* in-memory diagram into the chosen target as a file.
    const data = saveDiagram()
    const meta = await documents.saveAsFile(d.id, data)
    if (meta) setTab('fs')
  }

  const renderToolbar = (): React.ReactElement => {
    if (tab === 'ls') {
      if (creatingNew) {
        return (
          <div className="docmgr-toolbar docmgr-toolbar-create">
            <div className="docmgr-create-row">
              <input
                className="docmgr-rename-input"
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Model name"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleNewLSCommit()
                  else if (e.key === 'Escape') handleNewLSCancel()
                }}
              />
              <button className="docmgr-btn primary" onClick={handleNewLSCommit}>Create</button>
              <button className="docmgr-btn" onClick={handleNewLSCancel}>Cancel</button>
            </div>
            <div className="docmgr-mm-picker">
              <div className="docmgr-mm-picker-title">Choose a metamodel</div>
              {presets.map((p) => {
                const active = p.id === newPresetId
                return (
                  <button
                    key={p.id}
                    type="button"
                    className={`docmgr-mm-option${active ? ' active' : ''}`}
                    onClick={() => setNewPresetId(p.id)}
                    aria-pressed={active}
                  >
                    <div className="docmgr-mm-option-name">{p.name}</div>
                    <div className="docmgr-mm-option-desc">{p.description}</div>
                  </button>
                )
              })}
            </div>
          </div>
        )
      }
      return (
        <div className="docmgr-toolbar">
          <button className="docmgr-btn primary" onClick={handleNewLSStart}>+ New local model</button>
          <span className="docmgr-toolbar-hint">Stored in your browser only — no file on disk.</span>
        </div>
      )
    }
    return (
      <div className="docmgr-toolbar">
        <button className="docmgr-btn primary" onClick={handleImportFile}>Open file…</button>
        <span className="docmgr-toolbar-hint">Pick a <code>.json</code> model on disk to add to the library.</span>
      </div>
    )
  }

  const renderEmpty = (): React.ReactElement => {
    if (tab === 'ls') {
      return (
        <div className="docmgr-empty">
          <p style={{ margin: '0 0 12px' }}>No local models yet.</p>
          <button className="docmgr-btn primary" onClick={handleNewLSStart}>Create one</button>
        </div>
      )
    }
    return (
      <div className="docmgr-empty">
        <p style={{ margin: '0 0 12px' }}>No file-backed models yet.</p>
        <button className="docmgr-btn primary" onClick={handleImportFile}>Open a file…</button>
      </div>
    )
  }

  // Render through a portal attached to <body> so the modal escapes any
  // ancestor that creates a containing block for position:fixed (the
  // toolbar uses backdrop-filter, which per CSS spec anchors fixed
  // descendants to the toolbar instead of the viewport — the modal would
  // otherwise appear glued to the top bar instead of centred on screen).
  return createPortal(
    <div
      className="docmgr-backdrop"
      onMouseDown={(e) => {
        // Backdrop closes only when the mouse gesture both starts and ends
        // on the backdrop. Without this, selecting text inside the modal
        // and releasing outside it would close the dialog.
        if (e.target !== e.currentTarget) return
        const start = e.currentTarget
        const onUp = (ev: MouseEvent): void => {
          window.removeEventListener('mouseup', onUp, true)
          if (ev.target === start) onClose()
        }
        window.addEventListener('mouseup', onUp, true)
      }}
    >
      <div
        className="docmgr-modal"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Models"
      >
        <div className="docmgr-header">
          <h2>Models</h2>
          <button className="docmgr-close" onClick={onClose} aria-label="Close" title="Close (Esc)">✕</button>
        </div>

        <div className="docmgr-tabs" role="tablist">
          {TABS.map((t) => {
            const isActive = t.key === tab
            return (
              <button
                key={t.key}
                role="tab"
                aria-selected={isActive}
                className={`docmgr-tab${isActive ? ' active' : ''}`}
                onClick={() => setTab(t.key)}
                title={t.hint}
              >
                <span>{t.label}</span>
                <span className="docmgr-tab-count">{counts[t.key]}</span>
              </button>
            )
          })}
        </div>

        {renderToolbar()}

        {visible.length === 0 ? renderEmpty() : (
          <ul className="docmgr-list">
            {visible.map((d) => {
              const isActive = d.id === activeId
              const isRenaming = renamingId === d.id
              return (
                <li key={d.id} className={`docmgr-item${isActive ? ' active' : ''}`}>
                  <div className="docmgr-item-main" onClick={() => handleSwitch(d.id)}>
                    <span className={`docmgr-badge ${d.source}`}>
                      {d.source === 'fs' ? 'FILE' : 'LOCAL'}
                    </span>
                    {isRenaming ? (
                      <input
                        className="docmgr-rename-input"
                        autoFocus
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onBlur={handleRenameCommit}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleRenameCommit()
                          else if (e.key === 'Escape') { setRenamingId(null); setRenameValue('') }
                        }}
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : (
                      <div className="docmgr-item-info">
                        <div className="docmgr-name">{d.name}{isActive && <span className="docmgr-active-tag"> · active</span>}</div>
                        <div className="docmgr-sub">
                          {d.source === 'fs' && d.filePath && <span className="docmgr-path" title={d.filePath}>{d.filePath}</span>}
                          <span className="docmgr-time">modified {fmtTime(d.lastModified)}</span>
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="docmgr-item-actions">
                    {!isRenaming && (
                      <>
                        <button className="docmgr-btn small" onClick={() => handleRenameStart(d)} title="Rename">Rename</button>
                        {d.source === 'ls' && (
                          <button className="docmgr-btn small" onClick={() => handleSaveAs(d)} title="Save current model as a file (converts this entry to file-backed)">Save as file…</button>
                        )}
                        <button className="docmgr-btn small danger" onClick={() => handleDelete(d)} title={d.source === 'fs' ? 'Remove from library (file kept)' : 'Delete from local storage'}>Delete</button>
                      </>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>,
    document.body,
  )
}
