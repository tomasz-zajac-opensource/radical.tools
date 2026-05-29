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
