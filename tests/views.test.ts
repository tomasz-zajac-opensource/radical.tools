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
 *   - renameView updates the name
 *   - removeView deletes the view; if it was active, resets activeViewId to null
 *   - setViewKind toggles static / dynamic
 *   - setViewSequence links / unlinks a sequence
 *   - addViewFromSequence creates a dynamic view with nodes from the sequence
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

  it('removeNodeFromView cascades to all descendants', () => {
    // sys1 → ctn1 (and more children) — use a known parent from the sample
    const store = useDiagramStore.getState()
    const parentId = 'sys1'
    // Confirm sys1 has children in the sample
    const allNodes = store.c4Nodes
    const children = Object.values(allNodes).filter(n => n.parentId === parentId).map(n => n.id)
    expect(children.length).toBeGreaterThan(0)

    const vid = store.addView('CascadeTest')
    // Add parent and all children explicitly
    useDiagramStore.getState().addNodeToView(vid, parentId)
    for (const cid of children) useDiagramStore.getState().addNodeToView(vid, cid)

    // Remove the parent — children should disappear too
    useDiagramStore.getState().removeNodeFromView(vid, parentId)
    const nodeIds = useDiagramStore.getState().views[vid].nodeIds
    expect(nodeIds).not.toContain(parentId)
    for (const cid of children) {
      expect(nodeIds).not.toContain(cid)
    }
  })

  it('removeNodeFromView from "show all" view excludes node and descendants', () => {
    const store = useDiagramStore.getState()
    const parentId = 'sys1'
    const allNodes = store.c4Nodes
    const children = Object.values(allNodes).filter(n => n.parentId === parentId).map(n => n.id)

    const vid = store.addView('ShowAllCascade')
    // nodeIds is empty → "show all" mode
    expect(useDiagramStore.getState().views[vid].nodeIds).toHaveLength(0)

    // Remove parent from "show all" view → should materialise explicit list excluding parent+children
    useDiagramStore.getState().removeNodeFromView(vid, parentId)
    const nodeIds = useDiagramStore.getState().views[vid].nodeIds
    expect(nodeIds).not.toContain(parentId)
    for (const cid of children) {
      expect(nodeIds).not.toContain(cid)
    }
    // Other nodes should still be present
    expect(nodeIds.length).toBeGreaterThan(0)
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

describe('renameView', () => {
  it('updates the view name', () => {
    const vid = useDiagramStore.getState().addView('Old Name')
    useDiagramStore.getState().renameView(vid, 'New Name')
    expect(useDiagramStore.getState().views[vid].name).toBe('New Name')
  })

  it('is a no-op for unknown ids', () => {
    expect(() => useDiagramStore.getState().renameView('nonexistent', 'X')).not.toThrow()
  })
})

describe('removeView', () => {
  it('deletes the view from the store', () => {
    const vid = useDiagramStore.getState().addView('To Remove')
    useDiagramStore.getState().removeView(vid)
    expect(useDiagramStore.getState().views[vid]).toBeUndefined()
  })

  it('resets activeViewId to null when the active view is removed', () => {
    const vid = useDiagramStore.getState().addView('Active View')
    useDiagramStore.getState().setActiveView(vid)
    expect(useDiagramStore.getState().activeViewId).toBe(vid)
    useDiagramStore.getState().removeView(vid)
    expect(useDiagramStore.getState().activeViewId).toBeNull()
  })

  it('leaves activeViewId unchanged when a different view is removed', () => {
    const v1 = useDiagramStore.getState().addView('Keep')
    const v2 = useDiagramStore.getState().addView('Remove')
    useDiagramStore.getState().setActiveView(v1)
    useDiagramStore.getState().removeView(v2)
    expect(useDiagramStore.getState().activeViewId).toBe(v1)
    expect(useDiagramStore.getState().views[v2]).toBeUndefined()
  })
})

describe('setViewKind', () => {
  it('changes kind to dynamic', () => {
    const vid = useDiagramStore.getState().addView('V')
    useDiagramStore.getState().setViewKind(vid, 'dynamic')
    expect(useDiagramStore.getState().views[vid].kind).toBe('dynamic')
  })

  it('changes kind back to static', () => {
    const vid = useDiagramStore.getState().addView('V')
    useDiagramStore.getState().setViewKind(vid, 'dynamic')
    useDiagramStore.getState().setViewKind(vid, 'static')
    expect(useDiagramStore.getState().views[vid].kind).toBe('static')
  })
})

describe('setViewSequence', () => {
  it('links a sequence id onto the view', () => {
    const vid = useDiagramStore.getState().addView('V')
    useDiagramStore.getState().setViewSequence(vid, 'seq-abc')
    expect(useDiagramStore.getState().views[vid].sequenceId).toBe('seq-abc')
  })

  it('unlinks when called with null', () => {
    const vid = useDiagramStore.getState().addView('V')
    useDiagramStore.getState().setViewSequence(vid, 'seq-abc')
    useDiagramStore.getState().setViewSequence(vid, null)
    expect(useDiagramStore.getState().views[vid].sequenceId).toBeUndefined()
  })
})

describe('addViewFromSequence', () => {
  it('creates a dynamic view with nodes from the sequence relations', () => {
    // Create a sequence with two relations involving distinct nodes
    const seqId = useDiagramStore.getState().addSequence('Test Seq')
    // Pick two existing relations from the sample data
    const relIds = Object.keys(useDiagramStore.getState().c4Relations).slice(0, 2)
    for (const relId of relIds) {
      useDiagramStore.getState().toggleRelationInSequence(seqId, relId)
    }

    const viewsBefore = Object.keys(useDiagramStore.getState().views).length
    const vid = useDiagramStore.getState().addViewFromSequence(seqId)
    const view = useDiagramStore.getState().views[vid]

    expect(view).toBeDefined()
    expect(view.kind).toBe('dynamic')
    expect(view.sequenceId).toBe(seqId)
    expect(Object.keys(useDiagramStore.getState().views).length).toBe(viewsBefore + 1)

    // View nodes should include source + target of each relation
    const rels = useDiagramStore.getState().c4Relations
    const expectedNodes = new Set<string>()
    for (const relId of relIds) {
      expectedNodes.add(rels[relId].sourceId)
      expectedNodes.add(rels[relId].targetId)
    }
    for (const nid of expectedNodes) {
      expect(view.nodeIds).toContain(nid)
    }
  })

  it('activates the newly created view', () => {
    const seqId = useDiagramStore.getState().addSequence('Seq')
    const vid = useDiagramStore.getState().addViewFromSequence(seqId)
    expect(useDiagramStore.getState().activeViewId).toBe(vid)
  })
})
