/**
 * Viewer-mode and Presenter-mode "explore sandbox" tests.
 *
 * Both viewer and presenter are sandboxed exploration modes: drag,
 * collapse, smart-layout etc. are all allowed but every mutation is
 * reverted as soon as the user returns to the designer.
 *
 * Covers:
 *   - setAppMode designer→viewer captures window.__preModeLayout
 *   - mutations performed in viewer (toggleCollapse, position changes)
 *     are visible in viewer state
 *   - setAppMode viewer→designer restores the snapshotted c4Nodes /
 *     c4Relations / views / defaultPositions / activeViewId and clears
 *     window.__preModeLayout
 *   - 'presenter' is a first-class mode distinct from 'viewer'
 *   - designer→presenter captures __preModeLayout (same sandbox as viewer)
 *   - presenter→designer restores the snapshot
 *   - toggleCollapse in viewer DOES mutate (allowed in explore mode),
 *     unlike during a live presentation
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { useDiagramStore } from '../src/renderer/src/store/diagramStore'
import { documents } from '../src/renderer/src/store/documentStore'
import type { C4Node, C4Relation } from '../src/renderer/src/types/c4'

// The default node test env has no localStorage, so the document-persistence
// layer is otherwise a no-op. Provide a minimal in-memory implementation so
// the auto-persist subscriber can be exercised end-to-end.
if (typeof (globalThis as any).localStorage === 'undefined') {
  const store = new Map<string, string>()
  ;(globalThis as any).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, String(v)) },
    removeItem: (k: string) => { store.delete(k) },
    clear: () => { store.clear() },
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() { return store.size },
  }
}

const initial = (() => {
  const s = useDiagramStore.getState()
  return {
    c4Nodes: JSON.parse(JSON.stringify(s.c4Nodes)) as Record<string, C4Node>,
    c4Relations: JSON.parse(JSON.stringify(s.c4Relations)) as Record<string, C4Relation>,
    views: JSON.parse(JSON.stringify(s.views)),
    defaultPositions: JSON.parse(JSON.stringify(s.defaultPositions)),
    activeViewId: s.activeViewId,
  }
})()

beforeEach(() => {
  useDiagramStore.setState({
    c4Nodes: JSON.parse(JSON.stringify(initial.c4Nodes)),
    c4Relations: JSON.parse(JSON.stringify(initial.c4Relations)),
    views: JSON.parse(JSON.stringify(initial.views)),
    defaultPositions: JSON.parse(JSON.stringify(initial.defaultPositions)),
    activeViewId: initial.activeViewId,
    appMode: 'designer',
    presentationActive: false,
  } as any)
  ;(window as any).__preModeLayout = undefined
  useDiagramStore.getState()._sync()
})

describe('setAppMode designer ↔ viewer', () => {
  it('designer → viewer captures __preModeLayout snapshot', () => {
    expect((window as any).__preModeLayout).toBeUndefined()
    useDiagramStore.getState().setAppMode('viewer')
    const snap = (window as any).__preModeLayout
    expect(snap).toBeDefined()
    expect(snap.c4Nodes).toBeDefined()
    expect(snap.activeViewId).toBe(initial.activeViewId)
  })

  it('viewer → designer restores c4Nodes from the snapshot', () => {
    useDiagramStore.getState().setAppMode('viewer')
    // Mutate live model in viewer
    useDiagramStore.setState((s: any) => {
      s.c4Nodes['ctn1'].x = 9999
      s.c4Nodes['ctn1'].y = 9999
      s.c4Nodes['ctn1'].label = 'EXPLORED'
      return s
    })
    expect(useDiagramStore.getState().c4Nodes['ctn1'].label).toBe('EXPLORED')
    useDiagramStore.getState().setAppMode('designer')
    const restored = useDiagramStore.getState().c4Nodes['ctn1']
    expect(restored.label).toBe(initial.c4Nodes['ctn1'].label)
    expect(restored.x).toBe(initial.c4Nodes['ctn1'].x)
    expect(restored.y).toBe(initial.c4Nodes['ctn1'].y)
    expect((window as any).__preModeLayout).toBeUndefined()
  })

  it('viewer → designer restores views map (positions cannot leak)', () => {
    useDiagramStore.getState().setAppMode('viewer')
    useDiagramStore.setState((s: any) => {
      const v = Object.values(s.views)[0] as any
      if (v) v.nodeIds = ['MUTATED']
      return s
    })
    useDiagramStore.getState().setAppMode('designer')
    const v0 = Object.values(useDiagramStore.getState().views)[0] as any
    if (v0) {
      expect(v0.nodeIds).not.toEqual(['MUTATED'])
    }
  })

  it("'presenter' is a first-class mode distinct from 'viewer'", () => {
    useDiagramStore.getState().setAppMode('presenter')
    expect(useDiagramStore.getState().appMode).toBe('presenter')
    expect(useDiagramStore.getState().appMode).not.toBe('viewer')
  })
})

describe('toggleCollapse in viewer', () => {
  it('does mutate c4Nodes (explore mode allows it)', () => {
    useDiagramStore.getState().setAppMode('viewer')
    const before = useDiagramStore.getState().c4Nodes['sys1'].collapsed === true
    useDiagramStore.getState().toggleCollapse('sys1')
    const after = useDiagramStore.getState().c4Nodes['sys1'].collapsed === true
    expect(after).toBe(!before)
  })

  it('returning to designer reverts the collapse', () => {
    useDiagramStore.getState().setAppMode('viewer')
    const before = useDiagramStore.getState().c4Nodes['sys1'].collapsed === true
    useDiagramStore.getState().toggleCollapse('sys1')
    useDiagramStore.getState().setAppMode('designer')
    const after = useDiagramStore.getState().c4Nodes['sys1'].collapsed === true
    expect(after).toBe(before)
  })
})

describe('setAppMode designer ↔ presenter', () => {
  it('designer → presenter captures __preModeLayout snapshot', () => {
    expect((window as any).__preModeLayout).toBeUndefined()
    useDiagramStore.getState().setAppMode('presenter')
    const snap = (window as any).__preModeLayout
    expect(snap).toBeDefined()
    expect(snap.c4Nodes).toBeDefined()
    expect(snap.activeViewId).toBe(initial.activeViewId)
  })

  it('presenter → designer restores c4Nodes from the snapshot', () => {
    useDiagramStore.getState().setAppMode('presenter')
    useDiagramStore.setState((s: any) => {
      s.c4Nodes['ctn1'].x = 7777
      s.c4Nodes['ctn1'].y = 7777
      s.c4Nodes['ctn1'].label = 'PRESENTED'
      return s
    })
    expect(useDiagramStore.getState().c4Nodes['ctn1'].label).toBe('PRESENTED')
    useDiagramStore.getState().setAppMode('designer')
    const restored = useDiagramStore.getState().c4Nodes['ctn1']
    expect(restored.label).toBe(initial.c4Nodes['ctn1'].label)
    expect(restored.x).toBe(initial.c4Nodes['ctn1'].x)
    expect(restored.y).toBe(initial.c4Nodes['ctn1'].y)
    expect((window as any).__preModeLayout).toBeUndefined()
  })

  it('presenter → designer restores views map', () => {
    useDiagramStore.getState().setAppMode('presenter')
    useDiagramStore.setState((s: any) => {
      const v = Object.values(s.views)[0] as any
      if (v) v.nodeIds = ['MUTATED_IN_PRESENTER']
      return s
    })
    useDiagramStore.getState().setAppMode('designer')
    const v0 = Object.values(useDiagramStore.getState().views)[0] as any
    if (v0) {
      expect(v0.nodeIds).not.toEqual(['MUTATED_IN_PRESENTER'])
    }
  })
})

describe('toggleCollapse in presenter', () => {
  it('does mutate c4Nodes (explore mode allows it)', () => {
    useDiagramStore.getState().setAppMode('presenter')
    const before = useDiagramStore.getState().c4Nodes['sys1'].collapsed === true
    useDiagramStore.getState().toggleCollapse('sys1')
    const after = useDiagramStore.getState().c4Nodes['sys1'].collapsed === true
    expect(after).toBe(!before)
  })

  it('returning to designer reverts the collapse', () => {
    useDiagramStore.getState().setAppMode('presenter')
    const before = useDiagramStore.getState().c4Nodes['sys1'].collapsed === true
    useDiagramStore.getState().toggleCollapse('sys1')
    useDiagramStore.getState().setAppMode('designer')
    const after = useDiagramStore.getState().c4Nodes['sys1'].collapsed === true
    expect(after).toBe(before)
  })
})

describe('presentation edits in presenter mode persist (regression)', () => {
  it('removing a slide in presenter mode is written to the active document', async () => {
    // Seed a fresh LS document and make it active so the auto-persist
    // subscriber has a target.
    const seed = useDiagramStore.getState().saveDiagram()
    const meta = documents.createLSDocument('persist-regression', seed)
    documents.setActiveId(meta.id)
    // The active-document switch triggers an async reload that suspends
    // persistence; let it settle before mutating so our edits aren't
    // clobbered by the seed reload.
    await new Promise((r) => setTimeout(r, 100))

    // Build a presentation with two slides while in designer.
    useDiagramStore.getState().setAppMode('designer')
    const presId = useDiagramStore.getState().addPresentation('Regression')
    useDiagramStore.getState().setActivePresentation(presId)
    useDiagramStore.getState().addPresentationSlide('Slide A')
    useDiagramStore.getState().addPresentationSlide('Slide B')
    const slidesBefore = useDiagramStore.getState().presentationSlides.slice()
    expect(slidesBefore.length).toBe(2)

    // Let the designer-mode persist settle.
    await new Promise((r) => setTimeout(r, 600))

    // Enter presenter mode (captures __preModeLayout) and delete a slide.
    useDiagramStore.getState().setAppMode('presenter')
    useDiagramStore.getState().removePresentationSlide(slidesBefore[0].id)
    expect(useDiagramStore.getState().presentationSlides.length).toBe(1)

    // Wait past the 400 ms debounce so the layout-safe persist flushes.
    await new Promise((r) => setTimeout(r, 600))

    // Read the document straight back from storage — the deletion must
    // have been written even though we were in presenter (explore) mode.
    const persisted = await documents.loadDocument(meta.id)
    const pres = persisted?.presentations?.find((p) => p.id === presId)
    expect(pres).toBeDefined()
    expect(pres!.slides.length).toBe(1)
    expect(pres!.slides.some((s) => s.id === slidesBefore[0].id)).toBe(false)
    expect(pres!.slides.some((s) => s.id === slidesBefore[1].id)).toBe(true)

    // Cleanup.
    documents.deleteDocument(meta.id, { wipePayload: true })
    useDiagramStore.getState().setAppMode('designer')
    useDiagramStore.getState().removePresentation(presId)
  })
})
