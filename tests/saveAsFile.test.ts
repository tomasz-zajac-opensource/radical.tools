import { describe, it, expect, beforeEach, vi } from 'vitest'
import { documents } from '../src/renderer/src/store/documentStore'

class MemLS {
  private map = new Map<string, string>()
  getItem(k: string): string | null { return this.map.has(k) ? this.map.get(k)! : null }
  setItem(k: string, v: string): void { this.map.set(k, String(v)) }
  removeItem(k: string): void { this.map.delete(k) }
  clear(): void { this.map.clear() }
  key(i: number): string | null { return [...this.map.keys()][i] ?? null }
  get length(): number { return this.map.size }
}

const SAMPLE = { nodes: [{ id: 'sys1', kind: 'system', label: 'S' }], relations: [] }

describe('documents.saveAsFile — "Save as file…" action', () => {
  beforeEach(() => {
    ;(globalThis as any).localStorage = new MemLS()
    if (!(globalThis as any).crypto?.randomUUID) {
      ;(globalThis as any).crypto = { randomUUID: () => 'id-' + Math.random().toString(36).slice(2) }
    }
    delete (globalThis as any).window?.electronAPI
  })

  it('web fallback: triggers the downloader and keeps the doc LS-backed', async () => {
    const meta = documents.createLSDocument('My Diagram', SAMPLE as any)
    const dl = vi.fn(async (filename: string, json: string) => {
      // Verify what we asked the browser to save.
      expect(filename).toBe('My Diagram.c4.json')
      const parsed = JSON.parse(json)
      expect(parsed.nodes).toHaveLength(1)
      return filename
    })
    const result = await documents.saveAsFile(meta.id, SAMPLE as any, dl)
    expect(dl).toHaveBeenCalledTimes(1)
    expect(result).not.toBeNull()
    // Doc stays LS-backed (browser has no writable absolute path).
    expect(result!.source).toBe('ls')
    // Display name reflects the chosen filename, with .c4.json stripped.
    expect(result!.name).toBe('My Diagram')
    // lastModified bumped.
    expect(result!.lastModified).toBeGreaterThanOrEqual(meta.lastModified)
    // Payload is persisted (loadDocument returns the data).
    const loaded = await documents.loadDocument(meta.id)
    expect(loaded).not.toBeNull()
    expect(loaded!.nodes).toHaveLength(1)
  })

  it('web fallback: returns null when the downloader bails (e.g. blocked)', async () => {
    const meta = documents.createLSDocument('Doc B', SAMPLE as any)
    const before = meta.name
    const result = await documents.saveAsFile(meta.id, SAMPLE as any, async () => null)
    expect(result).toBeNull()
    // Meta is unchanged.
    const stillThere = documents.listDocuments().find(d => d.id === meta.id)!
    expect(stillThere.name).toBe(before)
    expect(stillThere.source).toBe('ls')
  })

  it('web fallback: sanitises slashes in the suggested filename', async () => {
    const meta = documents.createLSDocument('weird/name\\with:slashes', SAMPLE as any)
    let captured = ''
    await documents.saveAsFile(meta.id, SAMPLE as any, async (filename) => {
      captured = filename
      return filename
    })
    expect(captured).not.toMatch(/[\\/]/)
    expect(captured.endsWith('.c4.json')).toBe(true)
  })

  it('returns null for an unknown document id (web path)', async () => {
    const dl = vi.fn(async (n: string) => n)
    const result = await documents.saveAsFile('does-not-exist', SAMPLE as any, dl)
    expect(result).toBeNull()
    // The downloader should not even be called for an unknown id.
    // (It's safe either way, but we want the failure to be cheap.)
  })

  it('electron path: uses native Save dialog and converts to FS-backed', async () => {
    const win = (globalThis as any).window
    win.electronAPI = {
      saveDiagram: vi.fn(async () => ({ success: true, filePath: '/tmp/export/saved.c4.json' })),
    }
    const meta = documents.createLSDocument('Original Name', SAMPLE as any)
    const result = await documents.saveAsFile(meta.id, SAMPLE as any)
    expect(win.electronAPI.saveDiagram).toHaveBeenCalledTimes(1)
    expect(result).not.toBeNull()
    expect(result!.source).toBe('fs')
    expect(result!.filePath).toBe('/tmp/export/saved.c4.json')
    expect(result!.name).toBe('saved')
  })

  it('electron path: returns null when the Save dialog is cancelled', async () => {
    const win = (globalThis as any).window
    win.electronAPI = { saveDiagram: vi.fn(async () => ({ success: false })) }
    const meta = documents.createLSDocument('Doc C', SAMPLE as any)
    const result = await documents.saveAsFile(meta.id, SAMPLE as any)
    expect(result).toBeNull()
    // Doc remains LS-backed and untouched.
    const stillThere = documents.listDocuments().find(d => d.id === meta.id)!
    expect(stillThere.source).toBe('ls')
    expect(stillThere.name).toBe('Doc C')
  })
})
