/**
 * Milestone (snapshot) tests.
 *
 * Covers:
 *   - createSnapshot deep-copies current state
 *   - selectMilestone for the OLDEST milestone (idx === 0) clears the
 *     diff overlay (it is the baseline — there is no "before")
 *   - selectMilestone for a later milestone produces a diff vs the
 *     previous one
 *   - setDiffBase(null) on the oldest milestone clears the diff
 *     instead of falling back to live HEAD
 *   - selectMilestone in VIEWER preserves the user's current x/y for
 *     surviving nodes (only newly-introduced nodes take their snapshot
 *     positions)
 *   - restoreSnapshot loads the snapshot into c4Nodes/c4Relations
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { useDiagramStore } from '../src/renderer/src/store/diagramStore'
import type { C4Node, C4Relation } from '../src/renderer/src/types/c4'

const initial = (() => {
  const s = useDiagramStore.getState()
  return {
    c4Nodes: JSON.parse(JSON.stringify(s.c4Nodes)) as Record<string, C4Node>,
    c4Relations: JSON.parse(JSON.stringify(s.c4Relations)) as Record<string, C4Relation>,
    snapshots: JSON.parse(JSON.stringify(s.snapshots)),
    activeSnapshotId: s.activeSnapshotId,
    appMode: s.appMode,
  }
})()

beforeEach(() => {
  useDiagramStore.setState({
    c4Nodes: JSON.parse(JSON.stringify(initial.c4Nodes)),
    c4Relations: JSON.parse(JSON.stringify(initial.c4Relations)),
    snapshots: JSON.parse(JSON.stringify(initial.snapshots)),
    activeSnapshotId: null,
    liveBackup: null,
    diffHighlight: {},
    diffBaseSnapshotId: null,
    diffGhostNodes: {},
    diffGhostRelations: {},
    milestoneDirty: false,
    milestonePromptOpen: false,
    appMode: 'designer',
  } as any)
  useDiagramStore.getState()._sync()
})

describe('createSnapshot', () => {
  it('deep-copies current nodes/relations into the new snapshot', () => {
    const id = useDiagramStore.getState().createSnapshot('test')
    const snap = useDiagramStore.getState().snapshots.find((s: any) => s.id === id)!
    expect(snap.name).toBe('test')
    // Mutate live and verify snapshot is not affected
    useDiagramStore.setState((s: any) => {
      const k = Object.keys(s.c4Nodes)[0]
      s.c4Nodes[k].label = 'MUTATED'
      return s
    })
    const snapAgain = useDiagramStore.getState().snapshots.find((s: any) => s.id === id)!
    const k = Object.keys(snapAgain.nodes)[0]
    expect(snapAgain.nodes[k].label).not.toBe('MUTATED')
  })
})

describe('selectMilestone', () => {
  it('v1 (oldest) clears the diff overlay — it is the baseline', () => {
    useDiagramStore.getState().selectMilestone('snap-1')
    const s = useDiagramStore.getState()
    expect(s.activeSnapshotId).toBe('snap-1')
    expect(s.diffBaseSnapshotId).toBeNull()
    expect(Object.keys(s.diffHighlight)).toHaveLength(0)
    expect(Object.keys(s.diffGhostNodes)).toHaveLength(0)
    expect(Object.keys(s.diffGhostRelations)).toHaveLength(0)
  })

  it('v2 produces a diff against v1 (auto base = previous milestone)', () => {
    useDiagramStore.getState().selectMilestone('snap-2')
    const s = useDiagramStore.getState()
    expect(s.activeSnapshotId).toBe('snap-2')
    expect(s.diffBaseSnapshotId).toBe('snap-1')
    // ctn3 (Database) was added in v2 — it should appear as a diff entry
    expect(s.diffHighlight['ctn3']).toBeDefined()
  })

  it('in viewer, surviving nodes keep the user current positions', () => {
    // Enter viewer and move ctn1 to a sentinel position
    useDiagramStore.setState({ appMode: 'viewer' } as any)
    useDiagramStore.setState((s: any) => {
      s.c4Nodes['ctn1'].x = 1234
      s.c4Nodes['ctn1'].y = 5678
      return s
    })
    useDiagramStore.getState().selectMilestone('snap-2')
    // ctn1 exists in both snap-1 and snap-2 → live x/y should win
    const ctn1 = useDiagramStore.getState().c4Nodes['ctn1']
    expect(ctn1.x).toBe(1234)
    expect(ctn1.y).toBe(5678)
  })
})

describe('setDiffBase', () => {
  it('null on the oldest milestone clears the diff (no live HEAD fallback)', () => {
    useDiagramStore.getState().selectMilestone('snap-1')
    useDiagramStore.getState().setDiffBase(null)
    const s = useDiagramStore.getState()
    expect(Object.keys(s.diffHighlight)).toHaveLength(0)
    expect(s.diffBaseSnapshotId).toBeNull()
  })

  it('explicit id recomputes the diff against that base', () => {
    useDiagramStore.getState().selectMilestone('snap-3')
    useDiagramStore.getState().setDiffBase('snap-1')
    const s = useDiagramStore.getState()
    expect(s.diffBaseSnapshotId).toBe('snap-1')
    // ctn3, ctn4, ctn5 all introduced after v1 → all should appear in diff
    expect(s.diffHighlight['ctn3']).toBeDefined()
    expect(s.diffHighlight['ctn4']).toBeDefined()
    expect(s.diffHighlight['ctn5']).toBeDefined()
  })
})

describe('restoreSnapshot', () => {
  it('replaces c4Nodes/c4Relations with the snapshot content', () => {
    // sanity: live HEAD has ctn4 (added in v3)
    expect(useDiagramStore.getState().c4Nodes['ctn4']).toBeDefined()
    useDiagramStore.getState().restoreSnapshot('snap-1')
    const s = useDiagramStore.getState()
    expect(s.c4Nodes['ctn4']).toBeUndefined()
    expect(s.activeSnapshotId).toBe('snap-1')
    // v1 had only sys1 + ctn1 + ctn2 + usr1
    expect(Object.keys(s.c4Nodes).sort()).toEqual(['ctn1', 'ctn2', 'sys1', 'usr1'])
  })
})
