import React, { useState, useRef, useCallback, useEffect } from 'react'
import { toPng, toSvg } from 'html-to-image'
import { useDiagramStore } from '../store/diagramStore'
import { useDocumentsStore } from '../store/documentStore'
import { useOutsideClick } from '../hooks/useOutsideClick'

// ── Icons ─────────────────────────────────────────────────────────────────────

const IconExport = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 10v3a1 1 0 001 1h10a1 1 0 001-1v-3" />
    <path d="M8 2v8M5 7l3 3 3-3" />
  </svg>
)

const IconSVG = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round">
    <rect x="1" y="3" width="14" height="10" rx="1.5" />
    <path d="M4.5 9.5c-.5 0-1-.3-1-1s.5-1 1-1h1c.5 0 1-.3 1-1s-.5-1-1-1" />
    <path d="M9 6.5l1 3 1-3" />
    <path d="M13 6.5h-1.5c-.3 0-.5.2-.5.5v.5c0 .3.2.5.5.5h1c.3 0 .5.2.5.5v.5c0 .3-.2.5-.5.5H11" />
  </svg>
)

const IconPNG = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round">
    <rect x="1" y="3" width="14" height="10" rx="1.5" />
    <path d="M3.5 9.5V6.5h1c.6 0 1 .4 1 1s-.4 1-1 1H3.5" />
    <path d="M7.5 9.5V6.5l1.5 2 1.5-2v3" />
    <path d="M12.5 6.5H11v3h1.5" />
    <path d="M11 8h1.2" />
  </svg>
)

const IconChevron = () => (
  <svg viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 6l4 4 4-4" />
  </svg>
)

// ── Helpers ───────────────────────────────────────────────────────────────────

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-z0-9_\-. ]/gi, '_').trim() || 'diagram'
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ExportMenu(): React.ReactElement | null {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  const presentationActive = useDiagramStore((s) => s.presentationActive)
  const activeViewId = useDiagramStore((s) => s.activeViewId)
  const views = useDiagramStore((s) => s.views)
  const snapshots = useDiagramStore((s) => s.snapshots)
  const activeSnapshotId = useDiagramStore((s) => s.activeSnapshotId)

  const docs = useDocumentsStore((s) => s.docs)
  const activeDocId = useDocumentsStore((s) => s.activeId)
  const activeDoc = activeDocId ? docs.find((d) => d.id === activeDocId) ?? null : null

  const activeViewName = activeViewId ? (views[activeViewId]?.name ?? 'view') : 'view'
  const activeMilestoneName = activeSnapshotId
    ? (snapshots.find((s) => s.id === activeSnapshotId)?.name ?? null)
    : null
  const modelName = activeDoc?.name ?? 'model'

  useOutsideClick([wrapRef], open, useCallback(() => setOpen(false), []))

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  if (presentationActive) return null

  const getTarget = (): HTMLElement | null =>
    document.querySelector('.canvas-area') as HTMLElement | null

  const buildFilename = (): string => {
    const parts = [modelName, activeViewName]
    if (activeMilestoneName) parts.push(activeMilestoneName)
    return sanitizeFilename(parts.join('-'))
  }

  const doExport = async (format: 'png' | 'svg') => {
    const el = getTarget()
    if (!el) return
    setBusy(true)
    setOpen(false)
    const filename = buildFilename()
    try {
      const options = {
        cacheBust: true,
        backgroundColor: getComputedStyle(el).backgroundColor || '#1e1e2e',
        pixelRatio: window.devicePixelRatio || 2,
        // Exclude UI overlays from the export
        filter: (node: HTMLElement | SVGElement) => {
          const cls = (node as HTMLElement).className ?? ''
          if (typeof cls !== 'string') return true
          // Skip toolbar, panels, action bars, badges
          if (cls.includes('toolbar') || cls.includes('left-panel') || cls.includes('right-panel')) return false
          if (cls.includes('sel-bar') || cls.includes('edge-action') || cls.includes('quick-search')) return false
          return true
        },
      }
      if (format === 'png') {
        const dataUrl = await toPng(el, options)
        const res = await fetch(dataUrl)
        const blob = await res.blob()
        downloadBlob(blob, `${filename}.png`)
      } else {
        const svgDataUrl = await toSvg(el, options)
        const res = await fetch(svgDataUrl)
        const blob = await res.blob()
        downloadBlob(blob, `${filename}.svg`)
      }
    } catch (err) {
      console.error('[Export]', err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="export-menu-wrap" ref={wrapRef}>
      <button
        className={`export-menu-btn${open ? ' open' : ''}${busy ? ' busy' : ''}`}
        onClick={() => !busy && setOpen((o) => !o)}
        title="Export current view"
        aria-haspopup="true"
        aria-expanded={open}
        disabled={busy}
      >
        <span className="export-menu-icon"><IconExport /></span>
        <span className="export-menu-label">{busy ? 'Exporting…' : 'Export'}</span>
        <span className="export-menu-caret"><IconChevron /></span>
      </button>

      {open && (
        <div className="export-menu-dropdown" role="menu">
          <div className="export-menu-title">Export view</div>
          <button
            className="export-menu-item"
            role="menuitem"
            onClick={() => void doExport('png')}
          >
            <span className="export-menu-item-icon"><IconPNG /></span>
            <span className="export-menu-item-text">
              <span className="export-menu-item-name">PNG image</span>
              <span className="export-menu-item-sub">Raster, best for slides and docs</span>
            </span>
          </button>
          <button
            className="export-menu-item"
            role="menuitem"
            onClick={() => void doExport('svg')}
          >
            <span className="export-menu-item-icon"><IconSVG /></span>
            <span className="export-menu-item-text">
              <span className="export-menu-item-name">SVG vector</span>
              <span className="export-menu-item-sub">Scalable, best for print and editing</span>
            </span>
          </button>
        </div>
      )}
    </div>
  )
}
