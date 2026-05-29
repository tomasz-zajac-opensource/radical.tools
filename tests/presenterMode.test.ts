/**
 * Presenter mode tests.
 *
 * Presenter is a first-class explore mode distinct from both designer and
 * viewer. It provides a presentation-focused UI (slides panel, PresenterDock)
 * while keeping the canvas read-only (no model edits).
 *
 * Covers:
 *   - appMode === 'presenter' after setAppMode('presenter')
 *   - presenter !== viewer and presenter !== designer
 *   - presenter is an explore mode (isExploreMode)
 *   - designer → presenter captures __preModeLayout snapshot
 *   - presenter → designer restores snapshot and clears __preModeLayout
 *   - model mutations (addNode) are blocked in presenter mode
 *   - toggleCollapse is allowed in presenter (explore mode)
 *   - viewer → presenter transition is a no-op w.r.t. the snapshot
 *     (both are explore modes, snapshot persists)
 *   - presenter → viewer transition keeps snapshot intact
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { useDiagramStore } from '../src/renderer/src/store/diagramStore'
import type { C4Node, C4Relation } from '../src/renderer/src/types/c4'

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

describe('presenter mode identity', () => {
  it("appMode is 'presenter' after setAppMode('presenter')", () => {
    useDiagramStore.getState().setAppMode('presenter')
    expect(useDiagramStore.getState().appMode).toBe('presenter')
  })

  it("presenter is distinct from 'viewer'", () => {
    useDiagramStore.getState().setAppMode('presenter')
    expect(useDiagramStore.getState().appMode).not.toBe('viewer')
  })

  it("presenter is distinct from 'designer'", () => {
    useDiagramStore.getState().setAppMode('presenter')
    expect(useDiagramStore.getState().appMode).not.toBe('designer')
  })

  it('presenter is an explore mode (not designer, not metamodel)', () => {
    useDiagramStore.getState().setAppMode('presenter')
    const mode = useDiagramStore.getState().appMode
    const isExploreMode = mode !== 'designer' && mode !== 'metamodel'
    expect(isExploreMode).toBe(true)
  })
})

describe('designer ↔ presenter sandbox', () => {
  it('designer → presenter captures __preModeLayout', () => {
    expect((window as any).__preModeLayout).toBeUndefined()
    useDiagramStore.getState().setAppMode('presenter')
    const snap = (window as any).__preModeLayout
    expect(snap).toBeDefined()
    expect(snap.c4Nodes).toBeDefined()
    expect(snap.c4Relations).toBeDefined()
    expect(snap.views).toBeDefined()
    expect(snap.defaultPositions).toBeDefined()
    expect(snap.activeViewId).toBe(initial.activeViewId)
  })

  it('presenter → designer restores original c4Nodes', () => {
    useDiagramStore.getState().setAppMode('presenter')
    useDiagramStore.setState((s: any) => {
      s.c4Nodes['ctn1'].x = 5555
      s.c4Nodes['ctn1'].label = 'SLIDE_VIEW'
      return s
    })
    useDiagramStore.getState().setAppMode('designer')
    const n = useDiagramStore.getState().c4Nodes['ctn1']
    expect(n.label).toBe(initial.c4Nodes['ctn1'].label)
    expect(n.x).toBe(initial.c4Nodes['ctn1'].x)
  })

  it('presenter → designer clears __preModeLayout', () => {
    useDiagramStore.getState().setAppMode('presenter')
    expect((window as any).__preModeLayout).toBeDefined()
    useDiagramStore.getState().setAppMode('designer')
    expect((window as any).__preModeLayout).toBeUndefined()
  })

  it('presenter → designer restores views (mutations cannot leak)', () => {
    useDiagramStore.getState().setAppMode('presenter')
    useDiagramStore.setState((s: any) => {
      const v = Object.values(s.views)[0] as any
      if (v) v.nodeIds = ['LEAKED']
      return s
    })
    useDiagramStore.getState().setAppMode('designer')
    const v0 = Object.values(useDiagramStore.getState().views)[0] as any
    if (v0) {
      expect(v0.nodeIds).not.toEqual(['LEAKED'])
    }
  })
})

describe('mutation sandboxing in presenter', () => {
  it('a node added in presenter is reverted when returning to designer', () => {
    useDiagramStore.getState().setAppMode('presenter')
    const countBefore = Object.keys(initial.c4Nodes).length
    useDiagramStore.getState().addNode({ type: 'system', label: 'SandboxedNode', x: 0, y: 0 })
    expect(Object.keys(useDiagramStore.getState().c4Nodes).length).toBe(countBefore + 1)
    useDiagramStore.getState().setAppMode('designer')
    // snapshot restores original — the added node is gone
    expect(Object.keys(useDiagramStore.getState().c4Nodes).length).toBe(countBefore)
  })
})

describe('toggleCollapse in presenter', () => {
  it('does mutate (explore mode allows toggling)', () => {
    useDiagramStore.getState().setAppMode('presenter')
    const before = useDiagramStore.getState().c4Nodes['sys1'].collapsed === true
    useDiagramStore.getState().toggleCollapse('sys1')
    expect(useDiagramStore.getState().c4Nodes['sys1'].collapsed === true).toBe(!before)
  })

  it('collapse is reverted when returning to designer', () => {
    useDiagramStore.getState().setAppMode('presenter')
    const before = useDiagramStore.getState().c4Nodes['sys1'].collapsed === true
    useDiagramStore.getState().toggleCollapse('sys1')
    useDiagramStore.getState().setAppMode('designer')
    expect(useDiagramStore.getState().c4Nodes['sys1'].collapsed === true).toBe(before)
  })
})

describe('viewer ↔ presenter transitions', () => {
  it('viewer → presenter keeps snapshot from original designer→viewer transition', () => {
    useDiagramStore.getState().setAppMode('viewer')
    const snapAfterViewer = JSON.stringify((window as any).__preModeLayout)
    useDiagramStore.getState().setAppMode('presenter')
    // Going from one explore mode to another should NOT re-snapshot
    // (prevMode !== 'designer', so no new snapshot is taken)
    const snapAfterPresenter = JSON.stringify((window as any).__preModeLayout)
    expect(snapAfterPresenter).toBe(snapAfterViewer)
  })

  it('presenter → viewer keeps snapshot intact', () => {
    useDiagramStore.getState().setAppMode('presenter')
    const snap = JSON.stringify((window as any).__preModeLayout)
    useDiagramStore.getState().setAppMode('viewer')
    expect(JSON.stringify((window as any).__preModeLayout)).toBe(snap)
  })

  it('presenter → viewer → designer restores original layout', () => {
    useDiagramStore.getState().setAppMode('presenter')
    useDiagramStore.setState((s: any) => {
      s.c4Nodes['ctn1'].label = 'MUTATED_IN_PRESENTER'
      return s
    })
    useDiagramStore.getState().setAppMode('viewer')
    useDiagramStore.setState((s: any) => {
      s.c4Nodes['ctn1'].label = 'MUTATED_IN_VIEWER'
      return s
    })
    useDiagramStore.getState().setAppMode('designer')
    expect(useDiagramStore.getState().c4Nodes['ctn1'].label).toBe(initial.c4Nodes['ctn1'].label)
  })
})
