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
 *   - sequence mutations while in milestone view mark milestoneDirty
 *     and block switching to another milestone
 *   - renameSnapshot updates the name
 *   - removeSnapshot deletes the milestone; if active, restores live HEAD
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { useDiagramStore } from '../src/renderer/src/store/diagramStore'
import type { C4Node, C4Relation, DiagramSequence } from '../src/renderer/src/types/c4'

const initial = (() => {
  const s = useDiagramStore.getState()
  return {
    c4Nodes: JSON.parse(JSON.stringify(s.c4Nodes)) as Record<string, C4Node>,
    c4Relations: JSON.parse(JSON.stringify(s.c4Relations)) as Record<string, C4Relation>,
    snapshots: JSON.parse(JSON.stringify(s.snapshots)),
    sequences: JSON.parse(JSON.stringify(s.sequences)) as Record<string, DiagramSequence>,
    activeSnapshotId: s.activeSnapshotId,
    appMode: s.appMode,
  }
})()

beforeEach(() => {
  useDiagramStore.setState({
    c4Nodes: JSON.parse(JSON.stringify(initial.c4Nodes)),
    c4Relations: JSON.parse(JSON.stringify(initial.c4Relations)),
    snapshots: JSON.parse(JSON.stringify(initial.snapshots)),
    sequences: JSON.parse(JSON.stringify(initial.sequences)),
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

describe('renameSnapshot', () => {
  it('updates the milestone name', () => {
    useDiagramStore.getState().renameSnapshot('snap-1', 'New Name')
    const snap = useDiagramStore.getState().snapshots.find((s: any) => s.id === 'snap-1')!
    expect(snap.name).toBe('New Name')
  })

  it('is a no-op for unknown ids', () => {
    expect(() => useDiagramStore.getState().renameSnapshot('nonexistent', 'X')).not.toThrow()
  })
})

describe('removeSnapshot', () => {
  it('deletes the snapshot from the list', () => {
    const before = useDiagramStore.getState().snapshots.length
    useDiagramStore.getState().removeSnapshot('snap-2')
    expect(useDiagramStore.getState().snapshots.length).toBe(before - 1)
    expect(useDiagramStore.getState().snapshots.find((s: any) => s.id === 'snap-2')).toBeUndefined()
  })

  it('restores live HEAD and clears flags when the active milestone is removed', () => {
    // Enter milestone view mode
    useDiagramStore.getState().selectMilestone('snap-2')
    expect(useDiagramStore.getState().activeSnapshotId).toBe('snap-2')

    useDiagramStore.getState().removeSnapshot('snap-2')
    const s = useDiagramStore.getState()
    expect(s.activeSnapshotId).toBeNull()
    expect(Object.keys(s.diffHighlight)).toHaveLength(0)
    expect(s.diffBaseSnapshotId).toBeNull()
    expect(s.snapshots.find((x: any) => x.id === 'snap-2')).toBeUndefined()
  })

  it('does not affect activeSnapshotId when a different snapshot is removed', () => {
    useDiagramStore.getState().selectMilestone('snap-1')
    useDiagramStore.getState().removeSnapshot('snap-2')
    expect(useDiagramStore.getState().activeSnapshotId).toBe('snap-1')
  })
})

describe('sequence versioning in milestones', () => {
  const seqA: DiagramSequence = { id: 'seqA', name: 'Login Flow', relationIds: ['r00', 'r01'] }
  const seqB: DiagramSequence = { id: 'seqB', name: 'Data Flow', relationIds: ['r01', 'r02'] }

  it('createSnapshot captures current sequences', () => {
    useDiagramStore.setState({ sequences: { seqA: { ...seqA } } } as any)
    const id = useDiagramStore.getState().createSnapshot('with-seqs')
    const snap = useDiagramStore.getState().snapshots.find((s: any) => s.id === id)!
    expect(snap.sequences).toBeDefined()
    expect((snap.sequences as any)['seqA'].name).toBe('Login Flow')
    // Mutating live must not affect the snapshot
    useDiagramStore.setState((s: any) => { s.sequences.seqA.name = 'MUTATED'; return s })
    const snapAgain = useDiagramStore.getState().snapshots.find((s: any) => s.id === id)!
    expect((snapAgain.sequences as any)['seqA'].name).toBe('Login Flow')
  })

  it('selectMilestone restores sequences from the snapshot', () => {
    useDiagramStore.setState((s: any) => {
      s.snapshots.find((x: any) => x.id === 'snap-1').sequences = { seqA: { ...seqA } }
      return s
    })
    expect(Object.keys(useDiagramStore.getState().sequences)).toHaveLength(0)
    useDiagramStore.getState().selectMilestone('snap-1')
    expect(useDiagramStore.getState().sequences['seqA']).toBeDefined()
  })

  it('selectMilestone keeps live sequences when snapshot has none (backward compat)', () => {
    useDiagramStore.setState({ sequences: { seqA: { ...seqA } } } as any)
    // snap-2 has no sequences field — simulating an old file format
    useDiagramStore.getState().selectMilestone('snap-2')
    expect(useDiagramStore.getState().sequences['seqA']).toBeDefined()
  })

  it('liveBackup captures sequences when first entering a milestone', () => {
    useDiagramStore.setState({ sequences: { seqA: { ...seqA } } } as any)
    useDiagramStore.getState().selectMilestone('snap-1')
    const backup = useDiagramStore.getState().liveBackup as any
    expect(backup.sequences).toBeDefined()
    expect(backup.sequences['seqA'].name).toBe('Login Flow')
  })

  it('discardMilestoneChanges restores sequences from the backup', () => {
    useDiagramStore.setState({ sequences: { seqA: { ...seqA } } } as any)
    useDiagramStore.getState().selectMilestone('snap-1')
    // Replace sequences while in milestone view
    useDiagramStore.setState({ sequences: { seqB: { ...seqB } } } as any)
    useDiagramStore.getState().discardMilestoneChanges()
    const s = useDiagramStore.getState()
    expect(s.sequences['seqA']).toBeDefined()
    expect(s.sequences['seqB']).toBeUndefined()
  })

  it('removeSnapshot active restores sequences from backup', () => {
    useDiagramStore.setState({ sequences: { seqA: { ...seqA } } } as any)
    useDiagramStore.getState().selectMilestone('snap-2')
    useDiagramStore.setState({ sequences: { seqB: { ...seqB } } } as any)
    useDiagramStore.getState().removeSnapshot('snap-2')
    const s = useDiagramStore.getState()
    expect(s.sequences['seqA']).toBeDefined()
    expect(s.sequences['seqB']).toBeUndefined()
  })

  it('restoreSnapshot restores sequences from the snapshot', () => {
    useDiagramStore.setState((s: any) => {
      s.snapshots.find((x: any) => x.id === 'snap-2').sequences = { seqB: { ...seqB } }
      return s
    })
    useDiagramStore.getState().restoreSnapshot('snap-2')
    expect(useDiagramStore.getState().sequences['seqB']).toBeDefined()
  })

  it('commitMilestoneChanges mode=new saves current sequences in the new snapshot', () => {
    useDiagramStore.getState().selectMilestone('snap-1')
    useDiagramStore.setState({ sequences: { seqA: { ...seqA } }, milestoneDirty: true } as any)
    useDiagramStore.getState().commitMilestoneChanges('new', 'snap-1-edited')
    const snap = useDiagramStore.getState().snapshots.find((s: any) => s.name === 'snap-1-edited')!
    expect(snap).toBeDefined()
    expect((snap.sequences as any)?.['seqA']).toBeDefined()
  })

  it('commitMilestoneChanges mode=propagate propagates sequence additions to later milestones', () => {
    useDiagramStore.setState((s: any) => {
      s.snapshots.find((x: any) => x.id === 'snap-1').sequences = {}
      s.snapshots.find((x: any) => x.id === 'snap-2').sequences = {}
      s.snapshots.find((x: any) => x.id === 'snap-3').sequences = {}
      return s
    })
    useDiagramStore.getState().selectMilestone('snap-1')
    useDiagramStore.setState({ sequences: { seqA: { ...seqA } }, milestoneDirty: true } as any)
    useDiagramStore.getState().commitMilestoneChanges('propagate')
    const snaps = useDiagramStore.getState().snapshots
    expect((snaps.find((x: any) => x.id === 'snap-1')!.sequences as any)?.['seqA']).toBeDefined()
    expect((snaps.find((x: any) => x.id === 'snap-2')!.sequences as any)?.['seqA']).toBeDefined()
    expect((snaps.find((x: any) => x.id === 'snap-3')!.sequences as any)?.['seqA']).toBeDefined()
  })

  it('commitMilestoneChanges mode=propagate propagates sequence deletions to later milestones', () => {
    useDiagramStore.setState((s: any) => {
      s.snapshots.find((x: any) => x.id === 'snap-1').sequences = { seqA: { ...seqA } }
      s.snapshots.find((x: any) => x.id === 'snap-2').sequences = { seqA: { ...seqA } }
      s.snapshots.find((x: any) => x.id === 'snap-3').sequences = { seqA: { ...seqA } }
      return s
    })
    useDiagramStore.getState().selectMilestone('snap-1')
    // Remove seqA while editing snap-1
    useDiagramStore.setState({ sequences: {}, milestoneDirty: true } as any)
    useDiagramStore.getState().commitMilestoneChanges('propagate')
    const snaps = useDiagramStore.getState().snapshots
    expect((snaps.find((x: any) => x.id === 'snap-1')!.sequences as any)?.['seqA']).toBeUndefined()
    expect((snaps.find((x: any) => x.id === 'snap-2')!.sequences as any)?.['seqA']).toBeUndefined()
    expect((snaps.find((x: any) => x.id === 'snap-3')!.sequences as any)?.['seqA']).toBeUndefined()
  })

  it('commitMilestoneChanges mode=propagate propagates sequence renames to later milestones', () => {
    const seqAv2 = { ...seqA, name: 'Login Flow v2' }
    useDiagramStore.setState((s: any) => {
      s.snapshots.find((x: any) => x.id === 'snap-1').sequences = { seqA: { ...seqA } }
      s.snapshots.find((x: any) => x.id === 'snap-2').sequences = { seqA: { ...seqA } }
      return s
    })
    useDiagramStore.getState().selectMilestone('snap-1')
    useDiagramStore.setState({ sequences: { seqA: seqAv2 }, milestoneDirty: true } as any)
    useDiagramStore.getState().commitMilestoneChanges('propagate')
    const snaps = useDiagramStore.getState().snapshots
    expect((snaps.find((x: any) => x.id === 'snap-1')!.sequences as any)?.['seqA'].name).toBe('Login Flow v2')
    expect((snaps.find((x: any) => x.id === 'snap-2')!.sequences as any)?.['seqA'].name).toBe('Login Flow v2')
  })
})

describe('sequence mutations mark milestone dirty', () => {
  const seqA: DiagramSequence = { id: 'seqA', name: 'Login Flow', relationIds: ['r00', 'r01'] }

  // Helper: enter milestone snap-1 in designer mode.
  function enterMilestone() {
    useDiagramStore.setState({ appMode: 'designer' } as any)
    useDiagramStore.getState().selectMilestone('snap-1')
    expect(useDiagramStore.getState().activeSnapshotId).toBe('snap-1')
  }

  it('addSequence marks milestoneDirty and opens the prompt', () => {
    enterMilestone()
    useDiagramStore.getState().addSequence('New Seq')
    const s = useDiagramStore.getState()
    expect(s.milestoneDirty).toBe(true)
    expect(s.milestonePromptOpen).toBe(true)
  })

  it('removeSequence marks milestoneDirty', () => {
    useDiagramStore.setState({ sequences: { seqA: { ...seqA } } } as any)
    enterMilestone()
    useDiagramStore.getState().removeSequence('seqA')
    expect(useDiagramStore.getState().milestoneDirty).toBe(true)
  })

  it('renameSequence marks milestoneDirty', () => {
    useDiagramStore.setState({ sequences: { seqA: { ...seqA } } } as any)
    enterMilestone()
    useDiagramStore.getState().renameSequence('seqA', 'Renamed')
    expect(useDiagramStore.getState().milestoneDirty).toBe(true)
  })

  it('toggleRelationInSequence marks milestoneDirty', () => {
    useDiagramStore.setState({ sequences: { seqA: { ...seqA } } } as any)
    enterMilestone()
    useDiagramStore.getState().toggleRelationInSequence('seqA', 'r02')
    expect(useDiagramStore.getState().milestoneDirty).toBe(true)
  })

  it('removeFromSequence marks milestoneDirty', () => {
    useDiagramStore.setState({ sequences: { seqA: { ...seqA } } } as any)
    enterMilestone()
    useDiagramStore.getState().removeFromSequence('seqA', 0)
    expect(useDiagramStore.getState().milestoneDirty).toBe(true)
  })

  it('reorderSequence marks milestoneDirty', () => {
    useDiagramStore.setState({ sequences: { seqA: { ...seqA } } } as any)
    enterMilestone()
    useDiagramStore.getState().reorderSequence('seqA', 0, 1)
    expect(useDiagramStore.getState().milestoneDirty).toBe(true)
  })

  it('clearSequence marks milestoneDirty', () => {
    useDiagramStore.setState({ sequences: { seqA: { ...seqA } } } as any)
    enterMilestone()
    useDiagramStore.getState().clearSequence('seqA')
    expect(useDiagramStore.getState().milestoneDirty).toBe(true)
  })

  it('updateStepDescription marks milestoneDirty', () => {
    useDiagramStore.setState({ sequences: { seqA: { ...seqA } } } as any)
    enterMilestone()
    useDiagramStore.getState().updateStepDescription('seqA', 0, 'Step one')
    expect(useDiagramStore.getState().milestoneDirty).toBe(true)
  })

  it('sequence mutation does NOT mark dirty when not in milestone view', () => {
    // activeSnapshotId is null (live HEAD)
    expect(useDiagramStore.getState().activeSnapshotId).toBeNull()
    useDiagramStore.getState().addSequence('Live Seq')
    expect(useDiagramStore.getState().milestoneDirty).toBe(false)
  })

  it('sequence mutation does NOT mark dirty in viewer mode', () => {
    useDiagramStore.setState({ appMode: 'viewer' } as any)
    useDiagramStore.getState().selectMilestone('snap-1')
    useDiagramStore.getState().addSequence('Viewer Seq')
    expect(useDiagramStore.getState().milestoneDirty).toBe(false)
  })

  it('selectMilestone blocks (milestonePromptOpen) when sequences are dirty', () => {
    enterMilestone()
    // Mark dirty via a sequence mutation
    useDiagramStore.getState().addSequence('New Seq')
    expect(useDiagramStore.getState().milestoneDirty).toBe(true)
    // Try to switch to another milestone — must be blocked
    useDiagramStore.getState().selectMilestone('snap-2')
    const s = useDiagramStore.getState()
    expect(s.activeSnapshotId).toBe('snap-1')  // still on snap-1
    expect(s.milestonePromptOpen).toBe(true)
  })
})
