import { useState, useCallback } from 'react'
import { toPng, toSvg } from 'html-to-image'
import { useDiagramStore } from '../store/diagramStore'
import { useDocumentsStore } from '../store/documentStore'

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

export function useExport(): {
  exportBusy: boolean
  exportAs: (format: 'png' | 'svg') => void
  copyToClipboard: () => void
} {
  const [exportBusy, setExportBusy] = useState(false)

  const activeViewId = useDiagramStore((s) => s.activeViewId)
  const views = useDiagramStore((s) => s.views)
  const snapshots = useDiagramStore((s) => s.snapshots)
  const activeSnapshotId = useDiagramStore((s) => s.activeSnapshotId)

  const docs = useDocumentsStore((s) => s.docs)
  const activeDocId = useDocumentsStore((s) => s.activeId)
  const activeDoc = activeDocId ? docs.find((d) => d.id === activeDocId) ?? null : null

  const buildFilename = useCallback((): string => {
    const modelName = activeDoc?.name ?? 'model'
    const viewName = activeViewId ? (views[activeViewId]?.name ?? 'view') : 'view'
    const milestoneName = activeSnapshotId
      ? (snapshots.find((s) => s.id === activeSnapshotId)?.name ?? null)
      : null
    const parts = [modelName, viewName]
    if (milestoneName) parts.push(milestoneName)
    return sanitizeFilename(parts.join('-'))
  }, [activeDoc, activeViewId, views, activeSnapshotId, snapshots])

  const exportAs = useCallback((format: 'png' | 'svg') => {
    const el = document.querySelector('.canvas-area') as HTMLElement | null
    if (!el) return
    setExportBusy(true)
    const filename = buildFilename()
    const options = {
      cacheBust: true,
      backgroundColor: getComputedStyle(el).backgroundColor || '#1e1e2e',
      pixelRatio: window.devicePixelRatio || 2,
      filter: (node: HTMLElement | SVGElement) => {
        if (!(node instanceof Element)) return true
        const cls = node.getAttribute('class') ?? ''
        if (cls.includes('react-flow__background')) return false
        if (cls.includes('toolbar') || cls.includes('left-panel') || cls.includes('right-panel')) return false
        if (cls.includes('sel-bar') || cls.includes('edge-action') || cls.includes('quick-search')) return false
        return true
      },
    }
    const run = format === 'png'
      ? toPng(el, options).then((d) => fetch(d).then((r) => r.blob()).then((b) => downloadBlob(b, `${filename}.png`)))
      : toSvg(el, options).then((d) => fetch(d).then((r) => r.blob()).then((b) => downloadBlob(b, `${filename}.svg`)))
    run
      .catch((err) => console.error('[Export]', err))
      .finally(() => setExportBusy(false))
  }, [buildFilename])

  const copyToClipboard = useCallback(() => {
    const el = document.querySelector('.canvas-area') as HTMLElement | null
    if (!el) return
    setExportBusy(true)
    const options = {
      cacheBust: true,
      backgroundColor: getComputedStyle(el).backgroundColor || '#1e1e2e',
      pixelRatio: window.devicePixelRatio || 2,
      filter: (node: HTMLElement | SVGElement) => {
        if (!(node instanceof Element)) return true
        const cls = node.getAttribute('class') ?? ''
        if (cls.includes('react-flow__background')) return false
        if (cls.includes('toolbar') || cls.includes('left-panel') || cls.includes('right-panel')) return false
        if (cls.includes('sel-bar') || cls.includes('edge-action') || cls.includes('quick-search')) return false
        return true
      },
    }
    toPng(el, options)
      .then((dataUrl) => fetch(dataUrl).then((r) => r.blob()))
      .then((blob) => {
        const item = new ClipboardItem({ 'image/png': blob })
        return navigator.clipboard.write([item])
      })
      .catch((err) => console.error('[Export] clipboard', err))
      .finally(() => setExportBusy(false))
  }, [])

  return { exportBusy, exportAs, copyToClipboard }
}
