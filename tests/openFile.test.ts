import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { documents } from '../src/renderer/src/store/documentStore'

// In-memory localStorage shim so the documentStore (browser-only) can run
// under node. The store reads/writes the index and per-doc payloads via
// the global `localStorage` symbol.
class MemLS {
  private map = new Map<string, string>()
  getItem(k: string): string | null { return this.map.has(k) ? this.map.get(k)! : null }
  setItem(k: string, v: string): void { this.map.set(k, String(v)) }
  removeItem(k: string): void { this.map.delete(k) }
  clear(): void { this.map.clear() }
  key(i: number): string | null { return [...this.map.keys()][i] ?? null }
  get length(): number { return this.map.size }
}

describe('documents.importFromFile — "Open file…" button', () => {
  beforeEach(() => {
    ;(globalThis as any).localStorage = new MemLS()
    // Some build steps reference crypto.randomUUID
    if (!(globalThis as any).crypto?.randomUUID) {
      ;(globalThis as any).crypto = {
        randomUUID: () => 'id-' + Math.random().toString(36).slice(2),
      }
    }
    // Default: not running under Electron.
    delete (globalThis as any).window?.electronAPI
  })

  afterEach(() => {
    delete (globalThis as any).window?.electronAPI
  })

  it('web fallback: parses the picked JSON and creates an LS-backed doc', async () => {
    const payload = { nodes: [{ id: 'sys1', kind: 'system', label: 'Sys 1' }], relations: [] }
    const meta = await documents.importFromFile(async () => ({
      name: 'my-arch.c4.json',
      content: JSON.stringify(payload),
    }))
    expect(meta).not.toBeNull()
    expect(meta!.source).toBe('ls')
    // .c4.json suffix gets stripped to a friendly display name.
    expect(meta!.name).toBe('my-arch')
    // It becomes the active document and shows up in the list.
    expect(documents.getActiveId()).toBe(meta!.id)
    expect(documents.listDocuments().some(d => d.id === meta!.id)).toBe(true)
    // Payload is readable through the public API.
    const data = await documents.loadDocument(meta!.id)
    expect(data).not.toBeNull()
    expect(data!.nodes).toHaveLength(1)
    expect((data!.nodes[0] as any).id).toBe('sys1')
  })

  it('web fallback: returns null when the user cancels the picker', async () => {
    const before = documents.listDocuments().length
    const meta = await documents.importFromFile(async () => null)
    expect(meta).toBeNull()
    expect(documents.listDocuments()).toHaveLength(before)
  })

  it('web fallback: returns null on invalid JSON without crashing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const before = documents.listDocuments().length
    const meta = await documents.importFromFile(async () => ({
      name: 'broken.json',
      content: '{not json',
    }))
    expect(meta).toBeNull()
    expect(documents.listDocuments()).toHaveLength(before)
    warn.mockRestore()
  })

  it('web fallback: returns null when JSON is shaped wrong (no nodes/relations)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const meta = await documents.importFromFile(async () => ({
      name: 'wrong.json',
      content: JSON.stringify({ hello: 'world' }),
    }))
    expect(meta).toBeNull()
    warn.mockRestore()
  })

  it('electron path: uses native dialog when window.electronAPI.openDiagram is present', async () => {
    const win = (globalThis as any).window
    win.electronAPI = {
      openDiagram: vi.fn(async () => ({ success: true, filePath: '/tmp/foo/bar.c4.json' })),
    }
    const meta = await documents.importFromFile()
    expect(win.electronAPI.openDiagram).toHaveBeenCalledTimes(1)
    expect(meta).not.toBeNull()
    expect(meta!.source).toBe('fs')
    expect(meta!.filePath).toBe('/tmp/foo/bar.c4.json')
    expect(meta!.name).toBe('bar')

    // De-dupe: opening the same path again re-activates instead of inserting.
    const meta2 = await documents.importFromFile()
    expect(meta2!.id).toBe(meta!.id)
    const same = documents.listDocuments().filter(d => d.filePath === '/tmp/foo/bar.c4.json')
    expect(same).toHaveLength(1)
  })

  it('electron path: returns null when the dialog is cancelled', async () => {
    const win = (globalThis as any).window
    win.electronAPI = {
      openDiagram: vi.fn(async () => ({ success: false })),
    }
    const meta = await documents.importFromFile()
    expect(meta).toBeNull()
  })
})
