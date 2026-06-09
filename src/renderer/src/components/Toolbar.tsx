import React, { useCallback, useState, useEffect, useRef } from 'react'
import { useDiagramStore } from '../store/diagramStore'
import { useDocumentsStore } from '../store/documentStore'
import { DocumentManagerModal } from './DocumentManager'
import { AISettingsModal } from './AISettingsModal'
import { HubImportModal } from './HubImportModal'
import { useOutsideClick } from '../hooks/useOutsideClick'
import { useExport } from '../hooks/useExport'

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

const IconZoomIn = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5}>
    <circle cx="7" cy="7" r="5" />
    <path d="M7 5v4M5 7h4M12 12l2 2" />
  </svg>
)

const IconZoomOut = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5}>
    <circle cx="7" cy="7" r="5" />
    <path d="M5 7h4M12 12l2 2" />
  </svg>
)

// Sparkle / wand icon — indicates the "smart" auto-arrange action.
const IconSmartLayout = () => (
  <svg className="toolbar-btn-accent-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
    <path d="M8 2v2M8 12v2M2 8h2M12 8h2M3.5 3.5l1.4 1.4M11.1 11.1l1.4 1.4M3.5 12.5l1.4-1.4M11.1 4.9l1.4-1.4" />
    <circle cx="8" cy="8" r="2" />
  </svg>
)

// Hierarchical tree icon — root branching down to two children, each with two
// leaves. Used when the active view is configured for the nested-tree layout.
const IconTreeLayout = () => (
  <svg className="toolbar-btn-accent-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
    <circle cx="8" cy="2.5" r="1.2" />
    <circle cx="4" cy="8" r="1.2" />
    <circle cx="12" cy="8" r="1.2" />
    <circle cx="2.5" cy="13.5" r="1" />
    <circle cx="5.5" cy="13.5" r="1" />
    <circle cx="10.5" cy="13.5" r="1" />
    <circle cx="13.5" cy="13.5" r="1" />
    <path d="M8 3.7v1.5M8 5.2L4 6.8M8 5.2l4 1.6M4 9.2v1.5M4 10.7l-1.5 1.8M4 10.7l1.5 1.8M12 9.2v1.5M12 10.7l-1.5 1.8M12 10.7l1.5 1.8" />
  </svg>
)

const IconSearch = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5}>
    <circle cx="7" cy="7" r="4.5" />
    <path d="M10.5 10.5L14 14" strokeLinecap="round" />
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

const IconSmartFit = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5}>
    <path d="M2 5V2h3M11 2h3v3M14 11v3h-3M5 14H2v-3" />
    <path d="M8 6l1 2 2 .4-1.5 1.4.4 2L8 10.8 6.1 11.8l.4-2L5 8.4 7 8z" fill="currentColor" stroke="none" />
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

const IconModelling = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5}>
    <rect x="2" y="2" width="5" height="5" rx="1" />
    <rect x="9" y="9" width="5" height="5" rx="1" />
    <rect x="2" y="9" width="5" height="5" rx="1" />
    <path d="M9 4.5h2a1 1 0 011 1v2.5" strokeLinecap="round" />
  </svg>
)

const IconPresentation = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5}>
    <rect x="1" y="2" width="14" height="10" rx="1.5" />
    <path d="M5 14h6M8 12v2" strokeLinecap="round" />
    <path d="M6 6.5L10 8.5 6 10.5V6.5z" fill="currentColor" stroke="none" />
  </svg>
)

const IconView = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5}>
    <path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z" strokeLinejoin="round" />
    <circle cx="8" cy="8" r="2" />
  </svg>
)

const IconMetamodel = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4}>
    <rect x="1.5" y="2" width="5" height="4" rx="0.6" />
    <rect x="9.5" y="2" width="5" height="4" rx="0.6" />
    <rect x="5.5" y="10" width="5" height="4" rx="0.6" />
    <path d="M4 6v2h8V6M8 8v2" strokeLinecap="round" />
  </svg>
)

const IconAI = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 2.5l.7 1.6L7.3 4.8l-1.6.7L5 7.1l-.7-1.6L2.7 4.8l1.6-.7z" fill="currentColor" stroke="none" />
    <path d="M11.5 7l.6 1.4 1.4.6-1.4.6L11.5 11l-.6-1.4L9.5 9l1.4-.6z" fill="currentColor" stroke="none" />
    <path d="M8 9.5L8.6 11l1.4.5-1.4.5L8 13.5l-.6-1.5L6 11.5l1.4-.5z" fill="currentColor" stroke="none" />
  </svg>
)

const IconHub = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="2" width="5" height="5" rx="1" />
    <rect x="9" y="2" width="5" height="5" rx="1" />
    <rect x="2" y="9" width="5" height="5" rx="1" />
    <path d="M11.5 10v4M9.5 12h4" />
  </svg>
)

const IconExportPNG = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round">
    <rect x="1" y="3" width="14" height="10" rx="1.5" />
    <path d="M3.5 9.5V6.5h1c.6 0 1 .4 1 1s-.4 1-1 1H3.5" />
    <path d="M7.5 9.5V6.5l1.5 2 1.5-2v3" />
    <path d="M12.5 6.5H11v3h1.5" />
    <path d="M11 8h1.2" />
  </svg>
)

const IconExportSVG = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round">
    <rect x="1" y="3" width="14" height="10" rx="1.5" />
    <path d="M4.5 9.5c-.5 0-1-.3-1-1s.5-1 1-1h1c.5 0 1-.3 1-1s-.5-1-1-1" />
    <path d="M9 6.5l1 3 1-3" />
    <path d="M13 6.5h-1.5c-.3 0-.5.2-.5.5v.5c0 .3.2.5.5.5h1c.3 0 .5.2.5.5v.5c0 .3-.2.5-.5.5H11" />
  </svg>
)

const IconClipboard = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round">
    <rect x="5" y="1" width="6" height="3" rx="1" />
    <path d="M5 2H3a1 1 0 00-1 1v11a1 1 0 001 1h10a1 1 0 001-1V3a1 1 0 00-1-1h-2" />
    <path d="M5 8h6M5 11h4" />
  </svg>
)

// ── App menu (hamburger popover) ─────────────────────────────────────────────

type ConnectionMod = 'alt' | 'shift' | 'ctrl' | 'meta'

function AppMenu({
  onManage, activeDocLabel, activeDocSource,
  connectionModifier, setConnectionModifier,
  theme, onToggleTheme,
  smartFitActive, onToggleSmartFit,
  metamodelActive, onToggleMetamodel,
  onOpenAISettings,
  onOpenHub,
  onExportPNG,
  onExportSVG,
  onCopyToClipboard,
  exportBusy,
}: {
  onManage: () => void
  activeDocLabel: string | null
  activeDocSource: 'ls' | 'fs' | null
  connectionModifier: ConnectionMod
  setConnectionModifier: (m: ConnectionMod) => void
  theme: 'dark' | 'light'
  onToggleTheme: () => void
  smartFitActive: boolean
  onToggleSmartFit: () => void
  metamodelActive: boolean
  onToggleMetamodel: () => void
  onOpenAISettings: () => void
  onOpenHub: () => void
  onExportPNG: () => void
  onExportSVG: () => void
  onCopyToClipboard: () => void
  exportBusy: boolean
}) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const isMac = typeof navigator !== 'undefined' && navigator.platform?.includes('Mac')

  // Close on outside-click (covers pointerdown + mousedown, capture phase
  // so descendants that call stopPropagation can't keep the menu open).
  useOutsideClick([wrapRef], open, useCallback(() => setOpen(false), []))

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [open])

  const run = (fn: () => void) => () => { setOpen(false); fn() }

  return (
    <div className="app-menu-wrap" ref={wrapRef}>
      <button
        className={`app-brand${open ? ' open' : ''}`}
        onClick={() => setOpen((o) => !o)}
        title="Menu"
        aria-haspopup="true"
        aria-expanded={open}
      >
        <span className="app-brand-logo" aria-hidden>
          <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round">
            <path d="M10 1.8 L17.5 6 V14 L10 18.2 L2.5 14 V6 Z" fill="rgba(var(--accent-rgb),0.18)" />
            <circle cx="10" cy="10" r="2.4" fill="currentColor" stroke="none" />
          </svg>
        </span>
        <span className="app-brand-name">Radical</span>
        <span className={`app-brand-caret${open ? ' open' : ''}`} aria-hidden>
          <svg viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 6 L8 10 L12 6" />
          </svg>
        </span>
      </button>
      {open && (
        <div className="app-menu-popover" role="menu">
          <div className="app-menu-section">
            <div className="app-menu-label">Models</div>
            <button className="app-menu-item" role="menuitem" onClick={run(onManage)}>
              <span className="app-menu-icon"><IconLoad /></span>
              <span className="app-menu-text">
                Manage models…
                {activeDocLabel && (
                  <span className="app-menu-current-doc-inline">
                    <span className={`toolbar-doc-badge ${activeDocSource}`}>
                      {activeDocSource === 'fs' ? 'FILE' : 'LOCAL'}
                    </span>
                    <span className="app-menu-current-doc-name">{activeDocLabel}</span>
                  </span>
                )}
              </span>
            </button>
            <button className="app-menu-item" role="menuitem" onClick={run(onOpenHub)}>
              <span className="app-menu-icon"><IconHub /></span>
              <span className="app-menu-text">Import from Hub…</span>
            </button>
          </div>

          <div className="app-menu-divider" />

          <div className="app-menu-section">
            <div className="app-menu-label">Schema</div>
            <button
              className={`app-menu-item${metamodelActive ? ' active' : ''}`}
              role="menuitemcheckbox"
              aria-checked={metamodelActive}
              onClick={run(onToggleMetamodel)}
              title="Define object types, relations and constraints"
            >
              <span className="app-menu-icon"><IconMetamodel /></span>
              <span className="app-menu-text">
                {metamodelActive ? 'Close metamodel editor' : 'Metamodel editor…'}
              </span>
            </button>
          </div>

          <div className="app-menu-divider" />

          <div className="app-menu-section">
            <div className="app-menu-label">View</div>
            <button className="app-menu-item" role="menuitem" onClick={run(onToggleTheme)}>
              <span className="app-menu-icon">{theme === 'dark' ? <IconSun /> : <IconMoon />}</span>
              <span className="app-menu-text">{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>
            </button>
            <button
              className={`app-menu-item${smartFitActive ? ' active' : ''}`}
              role="menuitemcheckbox"
              aria-checked={smartFitActive}
              onClick={run(onToggleSmartFit)}
            >
              <span className="app-menu-icon"><IconSmartFit /></span>
              <span className="app-menu-text">Smart fit {smartFitActive ? '(on)' : '(off)'}</span>
            </button>
          </div>

          <div className="app-menu-divider" />

          <div className="app-menu-section">
            <div className="app-menu-label">Editing</div>
            <div className="app-menu-row">
              <span className="app-menu-row-label">Connect key</span>
              <select
                className="app-menu-select"
                value={connectionModifier}
                onChange={(e) => setConnectionModifier(e.target.value as ConnectionMod)}
              >
                <option value="alt">{isMac ? '⌥ Option' : 'Alt'}</option>
                <option value="shift">⇧ Shift</option>
                <option value="ctrl">Ctrl</option>
                <option value="meta">{isMac ? '⌘ Cmd' : '⊞ Win'}</option>
              </select>
            </div>
          </div>

          <div className="app-menu-divider" />

          <div className="app-menu-section">
            <div className="app-menu-label">AI</div>
            <button
              className="app-menu-item"
              role="menuitem"
              onClick={run(onOpenAISettings)}
              title="Configure AI providers (Ollama, OpenAI, Claude, Gemini)"
            >
              <span className="app-menu-icon"><IconAI /></span>
              <span className="app-menu-text">AI providers…</span>
            </button>
          </div>

          <div className="app-menu-divider" />

          <div className="app-menu-section">
            <div className="app-menu-label">Export</div>
            <button
              className="app-menu-item"
              role="menuitem"
              onClick={run(onExportPNG)}
              disabled={exportBusy}
            >
              <span className="app-menu-icon"><IconExportPNG /></span>
              <span className="app-menu-text">Export as PNG…</span>
            </button>
            <button
              className="app-menu-item"
              role="menuitem"
              onClick={run(onExportSVG)}
              disabled={exportBusy}
            >
              <span className="app-menu-icon"><IconExportSVG /></span>
              <span className="app-menu-text">Export as SVG…</span>
            </button>
            <button
              className="app-menu-item"
              role="menuitem"
              onClick={run(onCopyToClipboard)}
              disabled={exportBusy}
            >
              <span className="app-menu-icon"><IconClipboard /></span>
              <span className="app-menu-text">Copy to clipboard</span>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Toolbar ───────────────────────────────────────────────────────────────────

export function Toolbar(): React.ReactElement {
  const appMode = useDiagramStore((s) => s.appMode)
  const setAppMode = useDiagramStore((s) => s.setAppMode)
  const autoFitActive = useDiagramStore((s) => s.autoFitActive)
  const toggleAutoFit = useDiagramStore((s) => s.toggleAutoFit)
  const fitAll = useDiagramStore((s) => s.fitAll)
  const zoomIn = useDiagramStore((s) => s.zoomIn)
  const zoomOut = useDiagramStore((s) => s.zoomOut)
  const runSmartLayout = useDiagramStore((s) => s.runSmartLayout)
  const isLayoutRunning = useDiagramStore((s) => s.isLayoutRunning)
  const activeViewLayoutMode = useDiagramStore((s) =>
    s.activeViewId ? s.views[s.activeViewId]?.layoutMode ?? 'auto' : 'auto'
  )
  const activeViewKind = useDiagramStore((s) =>
    s.activeViewId ? s.views[s.activeViewId]?.kind ?? 'static' : 'static'
  )
  const connectionModifier = useDiagramStore((s) => s.connectionModifier)
  const setConnectionModifier = useDiagramStore((s) => s.setConnectionModifier)

  const undo = useDiagramStore((s) => s.undo)
  const redo = useDiagramStore((s) => s.redo)
  const canUndo = useDiagramStore((s) => s.canUndo)
  const canRedo = useDiagramStore((s) => s.canRedo)

  const docs = useDocumentsStore((s) => s.docs)
  const activeDocId = useDocumentsStore((s) => s.activeId)
  const activeDoc = activeDocId ? docs.find(d => d.id === activeDocId) ?? null : null
  const [managerOpen, setManagerOpen] = useState(false)


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

  // Keyboard shortcuts: Cmd+Z / Cmd+Shift+Z (Mac), Ctrl+Z / Ctrl+Shift+Z (Win), F5
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'F5') {
        e.preventDefault()
        const state = useDiagramStore.getState()
        if (state.presentationActive) state.stopPresentation()
        else state.startPresentation()
        return
      }
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

  const handleManage = useCallback(() => { setManagerOpen(true) }, [])

  const [aiSettingsOpen, setAISettingsOpen] = useState(false)
  const handleOpenAISettings = useCallback(() => { setAISettingsOpen(true) }, [])
  const handleCloseAISettings = useCallback(() => { setAISettingsOpen(false) }, [])

  const [hubOpen, setHubOpen] = useState(false)
  const handleOpenHub = useCallback(() => { setHubOpen(true) }, [])
  const handleCloseHub = useCallback(() => { setHubOpen(false) }, [])

  const { exportBusy, exportAs, copyToClipboard } = useExport()
  const handleExportPNG = useCallback(() => exportAs('png'), [exportAs])
  const handleExportSVG = useCallback(() => exportAs('svg'), [exportAs])

  // Allow other components (e.g. AIPanel) to open the modal via a window event.
  useEffect(() => {
    const onOpen = () => setAISettingsOpen(true)
    window.addEventListener('radical:open-ai-settings', onOpen as EventListener)
    return () => window.removeEventListener('radical:open-ai-settings', onOpen as EventListener)
  }, [])

  return (
    <div className="toolbar">
      <AISettingsModal open={aiSettingsOpen} onClose={handleCloseAISettings} />
      <HubImportModal open={hubOpen} onClose={handleCloseHub} />
      <AppMenu
        onManage={handleManage}
        activeDocLabel={activeDoc?.name ?? null}
        activeDocSource={activeDoc?.source ?? null}
        connectionModifier={connectionModifier}
        setConnectionModifier={setConnectionModifier}
        theme={theme}
        onToggleTheme={toggleTheme}
        smartFitActive={autoFitActive}
        onToggleSmartFit={toggleAutoFit}
        metamodelActive={appMode === 'metamodel'}
        onToggleMetamodel={() => setAppMode(appMode === 'metamodel' ? 'designer' : 'metamodel')}
        onOpenAISettings={handleOpenAISettings}
        onOpenHub={handleOpenHub}
        onExportPNG={handleExportPNG}
        onExportSVG={handleExportSVG}
        onCopyToClipboard={copyToClipboard}
        exportBusy={exportBusy}
      />
      <div className="toolbar-sep" />

      <button
        className="toolbar-btn"
        onClick={fitAll}
        title="Fit all visible nodes to viewport"
      >
        <IconFitAll /> Fit All
      </button>
      <button
        className="toolbar-btn"
        onClick={zoomOut}
        title="Zoom out (⌘−)"
      >
        <IconZoomOut />
      </button>
      <button
        className="toolbar-btn"
        onClick={zoomIn}
        title="Zoom in (⌘+)"
      >
        <IconZoomIn />
      </button>

      {activeViewKind !== 'treemap' && activeViewKind !== 'dynamic' && activeViewKind !== 'table' && activeViewKind !== 'matrix' && <button
        className="toolbar-btn toolbar-btn-accent"
        onClick={() => { void runSmartLayout() }}
        disabled={isLayoutRunning || appMode === 'metamodel'}
        title={
          activeViewLayoutMode === 'tree'
            ? 'Tree Layout — hierarchical nested-tree arrangement (configured for the active view).'
            : 'Smart Layout — ensemble of layered + semantic algorithms with edge-crossing minimisation, picks the cleanest result.'
        }
      >
        {activeViewLayoutMode === 'tree' ? (
          <><IconTreeLayout /> Tree Layout</>
        ) : (
          <><IconSmartLayout /> Smart Layout</>
        )}
      </button>}

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

      <div style={{ flex: 1 }} />

      <div className="toolbar-mode-switch">
        <button
          className={`toolbar-mode-btn${appMode === 'designer' ? ' active' : ''}`}
          onClick={() => setAppMode('designer')}
          title="Designer perspective — edit the model"
        >
          <IconModelling /> Designer
        </button>
        <button
          className={`toolbar-mode-btn${appMode === 'viewer' ? ' active' : ''}`}
          onClick={() => setAppMode('viewer')}
          title="Viewer perspective — explore the model"
        >
          <IconView /> Viewer
        </button>
        <button
          className={`toolbar-mode-btn${appMode === 'presenter' ? ' active' : ''}`}
          onClick={() => setAppMode('presenter')}
          title="Presenter perspective — build and play presentations"
        >
          <IconPresentation /> Presenter
        </button>
      </div>

      <DocumentManagerModal open={managerOpen} onClose={() => setManagerOpen(false)} />
    </div>
  )
}
