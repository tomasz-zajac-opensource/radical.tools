// ─── Document persistence layer ──────────────────────────────────────────────
//
// Provides a small library/CRUD around DiagramData with two backends:
//   • 'ls' — payload kept in localStorage under `radical-doc:<id>`
//   • 'fs' — payload kept in a file on disk; we only track its path here
//
// The list of documents and the active id is persisted in localStorage under
// `radical-docs-index`. This module is intentionally framework-agnostic
// (plain functions + zustand store) so the diagram store can wire into it.

import { create } from 'zustand'
import type { DiagramData } from '../types/c4'

const LS_INDEX_KEY = 'radical-docs-index'
const LS_DOC_PREFIX = 'radical-doc:'
/** Legacy single-slot key from the previous persistence iteration. */
const LS_LEGACY_KEY = 'radical-diagram-v1'

export type DocumentSource = 'ls' | 'fs'

export interface DocumentMeta {
  id: string
  name: string
  source: DocumentSource
  /** Absolute path on disk (only for `source === 'fs'`). */
  filePath?: string
  /** Epoch ms of last successful save through this layer. */
  lastModified: number
}

interface DocumentsIndex {
  docs: DocumentMeta[]
  activeId: string | null
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function uid(): string {
  return crypto.randomUUID()
}

function readIndex(): DocumentsIndex {
  if (typeof localStorage === 'undefined') return { docs: [], activeId: null }
  try {
    const raw = localStorage.getItem(LS_INDEX_KEY)
    if (!raw) return { docs: [], activeId: null }
    const parsed = JSON.parse(raw) as DocumentsIndex
    if (!parsed || !Array.isArray(parsed.docs)) return { docs: [], activeId: null }
    return parsed
  } catch {
    return { docs: [], activeId: null }
  }
}

function writeIndex(idx: DocumentsIndex): void {
  if (typeof localStorage === 'undefined') return
  try { localStorage.setItem(LS_INDEX_KEY, JSON.stringify(idx)) } catch (e) {
    console.warn('[documentStore] writeIndex failed:', e)
  }
}

function lsKeyFor(id: string): string {
  return LS_DOC_PREFIX + id
}

function readLSPayload(id: string): DiagramData | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(lsKeyFor(id))
    if (!raw) return null
    const parsed = JSON.parse(raw) as DiagramData
    if (!parsed || !Array.isArray(parsed.nodes) || !Array.isArray(parsed.relations)) return null
    return parsed
  } catch (e) {
    console.warn('[documentStore] readLSPayload failed:', e)
    return null
  }
}

function writeLSPayload(id: string, data: DiagramData): void {
  if (typeof localStorage === 'undefined') return
  try { localStorage.setItem(lsKeyFor(id), JSON.stringify(data)) } catch (e) {
    console.warn('[documentStore] writeLSPayload failed:', e)
  }
}

function deleteLSPayload(id: string): void {
  if (typeof localStorage === 'undefined') return
  try { localStorage.removeItem(lsKeyFor(id)) } catch { /* noop */ }
}

function defaultNameFromPath(filePath: string): string {
  const base = filePath.split(/[\\/]/).pop() ?? filePath
  return base.replace(/\.c4\.json$/i, '').replace(/\.json$/i, '') || base
}

/** Browser-only file picker used when running outside Electron. Resolves with
 *  `{ name, content }` for the chosen file, or `null` if the user cancels.
 *  Implemented via a transient <input type="file"> that we click(). */
function defaultWebFilePicker(): Promise<{ name: string; content: string } | null> {
  if (typeof document === 'undefined') return Promise.resolve(null)
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json,application/json'
    input.style.display = 'none'
    let settled = false
    const finish = (v: { name: string; content: string } | null): void => {
      if (settled) return
      settled = true
      try { document.body.removeChild(input) } catch { /* already gone */ }
      resolve(v)
    }
    input.addEventListener('change', () => {
      const f = input.files?.[0]
      if (!f) { finish(null); return }
      const reader = new FileReader()
      reader.onload = () => finish({ name: f.name, content: String(reader.result ?? '') })
      reader.onerror = () => finish(null)
      reader.readAsText(f)
    })
    // Most browsers fire neither change nor cancel when the dialog is
    //  dismissed, so we also listen for window focus as a best-effort
    //  cancel signal (only resolves null if no file ended up selected).
    const onFocus = (): void => {
      window.removeEventListener('focus', onFocus)
      setTimeout(() => { if (!input.files || input.files.length === 0) finish(null) }, 300)
    }
    window.addEventListener('focus', onFocus)
    document.body.appendChild(input)
    input.click()
  })
}

/** One-shot migration: if the user has data under the legacy single-slot key
 *  but the new index is empty, import it as the first LS document. */
function migrateLegacyIfNeeded(index: DocumentsIndex): DocumentsIndex {
  if (typeof localStorage === 'undefined') return index
  if (index.docs.length > 0) return index
  let raw: string | null = null
  try { raw = localStorage.getItem(LS_LEGACY_KEY) } catch { return index }
  if (!raw) return index
  try {
    const parsed = JSON.parse(raw) as DiagramData
    if (!parsed || !Array.isArray(parsed.nodes)) return index
    const id = uid()
    const meta: DocumentMeta = {
      id,
      name: 'Imported (legacy)',
      source: 'ls',
      lastModified: Date.now(),
    }
    writeLSPayload(id, parsed)
    const next: DocumentsIndex = { docs: [meta], activeId: id }
    writeIndex(next)
    try { localStorage.removeItem(LS_LEGACY_KEY) } catch { /* noop */ }
    console.debug('[documentStore] migrated legacy single-slot diagram into doc', id)
    return next
  } catch {
    return index
  }
}

// ─── Public API (pure functions) ─────────────────────────────────────────────

export interface DocumentsAPI {
  listDocuments(): DocumentMeta[]
  getActiveId(): string | null
  setActiveId(id: string | null): void

  createLSDocument(name: string, seed?: DiagramData): DocumentMeta

  /** Read the payload for a document. Async because FS reads cross IPC. */
  loadDocument(id: string): Promise<DiagramData | null>

  /** Persist new payload under an existing document. */
  saveDocument(id: string, data: DiagramData): Promise<void>

  /** Update the display name. (Does NOT rename files on disk.) */
  renameDocument(id: string, newName: string): void

  /** Remove the doc from the index. Optionally delete its LS payload. */
  deleteDocument(id: string, opts?: { wipePayload?: boolean }): void

  /** Open dialog (Electron) or HTML file picker (web) -> register as a doc.
   *  Electron path adds an FS-backed doc bound to the chosen path.
   *  Web path adds an LS-backed doc seeded with the parsed JSON content.
   *  Returns the new (or re-activated) meta, or null if the user cancelled
   *  / the file was unparsable. The optional `pickerOverride` is an injection
   *  seam for tests — production callers pass nothing. */
  importFromFile(
    pickerOverride?: () => Promise<{ name: string; content: string } | null>,
  ): Promise<DocumentMeta | null>

  /** Native save dialog for an existing doc -> turn it into an FS doc bound
   *  to the chosen path (and write the current payload there). */
  saveAsFile(id: string, data: DiagramData): Promise<DocumentMeta | null>

  /** Convenience: ensure there's at least one document; create an empty LS
   *  doc if the index is empty. Returns the active doc. */
  ensureActive(seedIfEmpty: () => DiagramData): { meta: DocumentMeta; seeded: boolean }
}

export const documents: DocumentsAPI = {
  listDocuments() {
    return readIndex().docs.slice().sort((a, b) => b.lastModified - a.lastModified)
  },

  getActiveId() {
    return readIndex().activeId
  },

  setActiveId(id) {
    const idx = readIndex()
    idx.activeId = id
    writeIndex(idx)
    notify()
  },

  createLSDocument(name, seed) {
    const idx = readIndex()
    const meta: DocumentMeta = {
      id: uid(),
      name: name.trim() || 'Untitled',
      source: 'ls',
      lastModified: Date.now(),
    }
    if (seed) writeLSPayload(meta.id, seed)
    idx.docs.push(meta)
    idx.activeId = meta.id
    writeIndex(idx)
    notify()
    return meta
  },

  async loadDocument(id) {
    const meta = readIndex().docs.find(d => d.id === id)
    if (!meta) return null
    if (meta.source === 'ls') return readLSPayload(id)
    if (meta.source === 'fs' && meta.filePath && window.electronAPI?.readFile) {
      const res = await window.electronAPI.readFile(meta.filePath)
      if (!res.success || !res.content) return null
      try { return JSON.parse(res.content) as DiagramData } catch { return null }
    }
    return null
  },

  async saveDocument(id, data) {
    const idx = readIndex()
    const meta = idx.docs.find(d => d.id === id)
    if (!meta) return
    if (meta.source === 'ls') {
      writeLSPayload(id, data)
    } else if (meta.source === 'fs' && meta.filePath && window.electronAPI?.writeFile) {
      const json = JSON.stringify(data, null, 2)
      const res = await window.electronAPI.writeFile(meta.filePath, json)
      if (!res.success) {
        console.warn('[documentStore] FS write failed for', meta.filePath, res.error)
        return
      }
    } else {
      return
    }
    meta.lastModified = Date.now()
    writeIndex(idx)
    notify()
  },

  renameDocument(id, newName) {
    const idx = readIndex()
    const meta = idx.docs.find(d => d.id === id)
    if (!meta) return
    meta.name = newName.trim() || meta.name
    writeIndex(idx)
    notify()
  },

  deleteDocument(id, opts) {
    const idx = readIndex()
    const before = idx.docs.length
    idx.docs = idx.docs.filter(d => d.id !== id)
    if (idx.docs.length === before) return
    if (opts?.wipePayload !== false) deleteLSPayload(id)
    if (idx.activeId === id) idx.activeId = idx.docs[0]?.id ?? null
    writeIndex(idx)
    notify()
  },

  async importFromFile(pickerOverride) {
    // ── Electron path: native open dialog returns an absolute filePath we
    //    can read/write through preload IPC. We register an FS-backed doc.
    if (typeof window !== 'undefined' && window.electronAPI?.openDiagram) {
      const res = await window.electronAPI.openDiagram()
      if (!res.success || !res.filePath) return null
      const idx = readIndex()
      // De-dupe by path: if we already track this file, just activate it.
      const existing = idx.docs.find(d => d.source === 'fs' && d.filePath === res.filePath)
      if (existing) {
        existing.lastModified = Date.now()
        idx.activeId = existing.id
        writeIndex(idx)
        notify()
        return existing
      }
      const meta: DocumentMeta = {
        id: uid(),
        name: defaultNameFromPath(res.filePath),
        source: 'fs',
        filePath: res.filePath,
        lastModified: Date.now(),
      }
      idx.docs.push(meta)
      idx.activeId = meta.id
      writeIndex(idx)
      notify()
      return meta
    }

    // ── Web fallback: there is no filesystem path the browser can write
    //    back to, so we read the picked file's JSON and create an LS doc
    //    seeded with it. Without this branch the "Open file…" button is a
    //    silent no-op in the deployed web build.
    const picker = pickerOverride ?? defaultWebFilePicker
    const picked = await picker()
    if (!picked) return null
    let parsed: DiagramData | null = null
    try {
      parsed = JSON.parse(picked.content) as DiagramData
    } catch (e) {
      console.warn('[documentStore] importFromFile: invalid JSON', e)
      return null
    }
    if (!parsed || !Array.isArray(parsed.nodes) || !Array.isArray(parsed.relations)) {
      console.warn('[documentStore] importFromFile: not a DiagramData payload')
      return null
    }
    const name = picked.name.replace(/\.c4\.json$/i, '').replace(/\.json$/i, '') || picked.name
    return this.createLSDocument(name, parsed)
  },

  async saveAsFile(id, data) {
    if (!window.electronAPI?.saveDiagram) return null
    const json = JSON.stringify(data, null, 2)
    const res = await window.electronAPI.saveDiagram(json)
    if (!res.success || !res.filePath) return null
    const idx = readIndex()
    const meta = idx.docs.find(d => d.id === id)
    if (!meta) return null
    // Convert the doc into FS-backed and drop its LS payload.
    if (meta.source === 'ls') deleteLSPayload(id)
    meta.source = 'fs'
    meta.filePath = res.filePath
    meta.name = defaultNameFromPath(res.filePath)
    meta.lastModified = Date.now()
    writeIndex(idx)
    notify()
    return meta
  },

  ensureActive(seedIfEmpty) {
    let idx = migrateLegacyIfNeeded(readIndex())
    if (idx.docs.length === 0) {
      const seed = seedIfEmpty()
      const meta = this.createLSDocument('Untitled', seed)
      return { meta, seeded: true }
    }
    if (!idx.activeId || !idx.docs.some(d => d.id === idx.activeId)) {
      idx.activeId = idx.docs[0].id
      writeIndex(idx)
      notify()
    }
    const meta = idx.docs.find(d => d.id === idx.activeId)!
    return { meta, seeded: false }
  },
}

// ─── Reactive view for React components ──────────────────────────────────────
// Components subscribe to this to re-render the document list / active label.

interface DocumentsView {
  docs: DocumentMeta[]
  activeId: string | null
  /** Bumped on every mutation so subscribers re-read via selectors. */
  rev: number
}

export const useDocumentsStore = create<DocumentsView>(() => {
  const idx = readIndex()
  return { docs: idx.docs, activeId: idx.activeId, rev: 0 }
})

function notify(): void {
  const idx = readIndex()
  useDocumentsStore.setState((s) => ({
    docs: idx.docs,
    activeId: idx.activeId,
    rev: s.rev + 1,
  }))
}
