/**
 * Views tests.
 *
 * Covers:
 *   - addView returns id, creates an empty view
 *   - addNodeToView / removeNodeFromView mutate just that view
 *   - setActiveView in DESIGNER saves outgoing positions and applies
 *     incoming positions onto c4Nodes
 *   - setActiveView in VIEWER (explore mode) only flips activeViewId —
 *     it does NOT save current positions to the outgoing view, and does
 *     NOT load the incoming view's positions onto c4Nodes
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { useDiagramStore } from '../src/renderer/src/store/diagramStore'
import type { C4Node, C4Relation, DiagramView } from '../src/renderer/src/types/c4'

const initial = (() => {
  const s = useDiagramStore.getState()
  return {
    c4Nodes: JSON.parse(JSON.stringify(s.c4Nodes)) as Record<string, C4Node>,
    c4Relations: JSON.parse(JSON.stringify(s.c4Relations)) as Record<string, C4Relation>,
    views: JSON.parse(JSON.stringify(s.views)) as Record<string, DiagramView>,
    activeViewId: s.activeViewId,
    defaultPositions: JSON.parse(JSON.stringify(s.defaultPositions)),
  }
})()

beforeEach(() => {
  useDiagramStore.setState({
    c4Nodes: JSON.parse(JSON.stringify(initial.c4Nodes)),
    c4Relations: JSON.parse(JSON.stringify(initial.c4Relations)),
    views: JSON.parse(JSON.stringify(initial.views)),
    activeViewId: initial.activeViewId,
    defaultPositions: JSON.parse(JSON.stringify(initial.defaultPositions)),
    appMode: 'designer',
  } as any)
  useDiagramStore.getState()._sync()
})

describe('addView / addNodeToView / removeNodeFromView', () => {
  it('addView creates a new empty view and returns its id', () => {
    const before = Object.keys(useDiagramStore.getState().views).length
    const id = useDiagramStore.getState().addView('My View')
    const v = useDiagramStore.getState().views[id]
    expect(v).toBeDefined()
    expect(v.name).toBe('My View')
    expect(v.nodeIds).toEqual([])
    expect(Object.keys(useDiagramStore.getState().views).length).toBe(before + 1)
  })

  it('addNodeToView appends a node id; removeNodeFromView removes it', () => {
    const vid = useDiagramStore.getState().addView('X')
    const nid = Object.keys(useDiagramStore.getState().c4Nodes)[0]
    useDiagramStore.getState().addNodeToView(vid, nid)
    expect(useDiagramStore.getState().views[vid].nodeIds).toContain(nid)
    // adding twice does not duplicate
    useDiagramStore.getState().addNodeToView(vid, nid)
    expect(useDiagramStore.getState().views[vid].nodeIds.filter(x => x === nid).length).toBe(1)
    useDiagramStore.getState().removeNodeFromView(vid, nid)
    expect(useDiagramStore.getState().views[vid].nodeIds).not.toContain(nid)
  })
})

describe('setActiveView in designer mode', () => {
  it('saves current positions to the outgoing view (or defaultPositions for null)', () => {
    // create a brand-new view, switch to it
    const vid = useDiagramStore.getState().addView('Layouted')
    useDiagramStore.setState({ activeViewId: null } as any)
    // mutate one node's coordinates
    useDiagramStore.setState((s: any) => {
      s.c4Nodes['ctn1'].x = 999
      s.c4Nodes['ctn1'].y = 888
      return s
    })
    // switch — this should write the current positions into defaultPositions
    useDiagramStore.getState().setActiveView(vid)
    const dp = useDiagramStore.getState().defaultPositions['ctn1']
    expect(dp.x).toBe(999)
    expect(dp.y).toBe(888)
  })

  it('applies incoming view positions onto c4Nodes when switching', () => {
    // seed an explicit positions map on a fresh view
    const vid = useDiagramStore.getState().addView('Curated')
    useDiagramStore.setState((s: any) => {
      s.views[vid].positions = {
        ctn1: { x: 11, y: 22, width: 200, height: 100 },
      }
      return s
    })
    useDiagramStore.getState().setActiveView(vid)
    const n = useDiagramStore.getState().c4Nodes['ctn1']
    expect(n.x).toBe(11)
    expect(n.y).toBe(22)
  })
})

describe('setActiveView in viewer (explore) mode', () => {
  it('only flips activeViewId — no position copy in either direction', () => {
    const vid = useDiagramStore.getState().addView('Curated')
    // seed positions on the target view that DIFFER from current c4Nodes
    useDiagramStore.setState((s: any) => {
      s.views[vid].positions = {
        ctn1: { x: 11, y: 22, width: 200, height: 100 },
      }
      return s
    })
    // mutate ctn1 to a sentinel current value
    useDiagramStore.setState((s: any) => {
      s.c4Nodes['ctn1'].x = 555
      s.c4Nodes['ctn1'].y = 777
      return s
    })
    // ── enter viewer ──
    useDiagramStore.setState({ appMode: 'viewer' } as any)
    const dpBefore = JSON.stringify(useDiagramStore.getState().defaultPositions)

    useDiagramStore.getState().setActiveView(vid)

    // 1. activeViewId did flip
    expect(useDiagramStore.getState().activeViewId).toBe(vid)
    // 2. ctn1 position is UNCHANGED — view's positions were NOT applied
    const n = useDiagramStore.getState().c4Nodes['ctn1']
    expect(n.x).toBe(555)
    expect(n.y).toBe(777)
    // 3. defaultPositions were NOT overwritten with mid-explore coords
    expect(JSON.stringify(useDiagramStore.getState().defaultPositions)).toBe(dpBefore)
  })
})
