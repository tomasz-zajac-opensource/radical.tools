/**
 * Sequence tests.
 *
 * Covers:
 *   - addSequence creates a new empty sequence and returns its id
 *   - renameSequence updates the name
 *   - removeSequence deletes the sequence; unlinks views that reference it;
 *     clears activeSequenceId if it was the active one
 *   - setActiveSequence / toggle (set to null)
 *   - toggleRelationInSequence adds a relation the first time,
 *     removes it the second time
 *   - removeFromSequence removes a step by index
 *   - reorderSequence swaps two steps
 *   - clearSequence removes all steps
 *   - addViewFromSequence unlinks the sequence from the view when the
 *     sequence is subsequently deleted
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { useDiagramStore } from '../src/renderer/src/store/diagramStore'
import type { C4Node, C4Relation } from '../src/renderer/src/types/c4'

const initial = (() => {
  const s = useDiagramStore.getState()
  return {
    c4Nodes: JSON.parse(JSON.stringify(s.c4Nodes)) as Record<string, C4Node>,
    c4Relations: JSON.parse(JSON.stringify(s.c4Relations)) as Record<string, C4Relation>,
    sequences: JSON.parse(JSON.stringify(s.sequences)),
    views: JSON.parse(JSON.stringify(s.views)),
    activeSequenceId: s.activeSequenceId,
    activeViewId: s.activeViewId,
  }
})()

beforeEach(() => {
  useDiagramStore.setState({
    c4Nodes: JSON.parse(JSON.stringify(initial.c4Nodes)),
    c4Relations: JSON.parse(JSON.stringify(initial.c4Relations)),
    sequences: JSON.parse(JSON.stringify(initial.sequences)),
    views: JSON.parse(JSON.stringify(initial.views)),
    activeSequenceId: null,
    activeViewId: null,
    appMode: 'designer',
  } as any)
  useDiagramStore.getState()._sync()
})

describe('addSequence', () => {
  it('creates a new empty sequence and returns its id', () => {
    const id = useDiagramStore.getState().addSequence('My Seq')
    const seq = useDiagramStore.getState().sequences[id]
    expect(seq).toBeDefined()
    expect(seq.name).toBe('My Seq')
    expect(seq.relationIds).toEqual([])
  })
})

describe('renameSequence', () => {
  it('updates the sequence name', () => {
    const id = useDiagramStore.getState().addSequence('Old')
    useDiagramStore.getState().renameSequence(id, 'New')
    expect(useDiagramStore.getState().sequences[id].name).toBe('New')
  })

  it('is a no-op for unknown ids', () => {
    expect(() => useDiagramStore.getState().renameSequence('nonexistent', 'X')).not.toThrow()
  })
})

describe('removeSequence', () => {
  it('deletes the sequence', () => {
    const id = useDiagramStore.getState().addSequence('Temp')
    useDiagramStore.getState().removeSequence(id)
    expect(useDiagramStore.getState().sequences[id]).toBeUndefined()
  })

  it('clears activeSequenceId when the active sequence is removed', () => {
    const id = useDiagramStore.getState().addSequence('Active')
    useDiagramStore.getState().setActiveSequence(id)
    expect(useDiagramStore.getState().activeSequenceId).toBe(id)
    useDiagramStore.getState().removeSequence(id)
    expect(useDiagramStore.getState().activeSequenceId).toBeNull()
  })

  it('does not clear activeSequenceId when a different sequence is removed', () => {
    const id1 = useDiagramStore.getState().addSequence('Keep')
    const id2 = useDiagramStore.getState().addSequence('Remove')
    useDiagramStore.getState().setActiveSequence(id1)
    useDiagramStore.getState().removeSequence(id2)
    expect(useDiagramStore.getState().activeSequenceId).toBe(id1)
  })

  it('unlinks views that referenced the deleted sequence', () => {
    const seqId = useDiagramStore.getState().addSequence('Linked')
    const viewId = useDiagramStore.getState().addView('Linked View')
    useDiagramStore.getState().setViewSequence(viewId, seqId)
    expect(useDiagramStore.getState().views[viewId].sequenceId).toBe(seqId)

    useDiagramStore.getState().removeSequence(seqId)
    expect(useDiagramStore.getState().views[viewId].sequenceId).toBeUndefined()
  })
})

describe('setActiveSequence', () => {
  it('sets the active sequence id', () => {
    const id = useDiagramStore.getState().addSequence('S')
    useDiagramStore.getState().setActiveSequence(id)
    expect(useDiagramStore.getState().activeSequenceId).toBe(id)
  })

  it('clears with null', () => {
    const id = useDiagramStore.getState().addSequence('S')
    useDiagramStore.getState().setActiveSequence(id)
    useDiagramStore.getState().setActiveSequence(null)
    expect(useDiagramStore.getState().activeSequenceId).toBeNull()
  })
})

describe('toggleRelationInSequence', () => {
  it('adds a relation on first toggle', () => {
    const seqId = useDiagramStore.getState().addSequence('S')
    const relId = Object.keys(useDiagramStore.getState().c4Relations)[0]
    useDiagramStore.getState().toggleRelationInSequence(seqId, relId)
    expect(useDiagramStore.getState().sequences[seqId].relationIds).toContain(relId)
  })

  it('removes the relation on second toggle', () => {
    const seqId = useDiagramStore.getState().addSequence('S')
    const relId = Object.keys(useDiagramStore.getState().c4Relations)[0]
    useDiagramStore.getState().toggleRelationInSequence(seqId, relId)
    useDiagramStore.getState().toggleRelationInSequence(seqId, relId)
    expect(useDiagramStore.getState().sequences[seqId].relationIds).not.toContain(relId)
  })
})

describe('removeFromSequence', () => {
  it('removes the step at the given index', () => {
    const seqId = useDiagramStore.getState().addSequence('S')
    const relIds = Object.keys(useDiagramStore.getState().c4Relations).slice(0, 3)
    for (const r of relIds) useDiagramStore.getState().toggleRelationInSequence(seqId, r)
    // Remove step at index 1 (middle)
    useDiagramStore.getState().removeFromSequence(seqId, 1)
    const remaining = useDiagramStore.getState().sequences[seqId].relationIds
    expect(remaining.length).toBe(2)
    expect(remaining).not.toContain(relIds[1])
    expect(remaining[0]).toBe(relIds[0])
    expect(remaining[1]).toBe(relIds[2])
  })
})

describe('reorderSequence', () => {
  it('moves a step forward', () => {
    const seqId = useDiagramStore.getState().addSequence('S')
    const relIds = Object.keys(useDiagramStore.getState().c4Relations).slice(0, 3)
    for (const r of relIds) useDiagramStore.getState().toggleRelationInSequence(seqId, r)
    // Move index 0 to index 2
    useDiagramStore.getState().reorderSequence(seqId, 0, 2)
    const ids = useDiagramStore.getState().sequences[seqId].relationIds
    expect(ids[0]).toBe(relIds[1])
    expect(ids[1]).toBe(relIds[2])
    expect(ids[2]).toBe(relIds[0])
  })

  it('moves a step backward', () => {
    const seqId = useDiagramStore.getState().addSequence('S')
    const relIds = Object.keys(useDiagramStore.getState().c4Relations).slice(0, 3)
    for (const r of relIds) useDiagramStore.getState().toggleRelationInSequence(seqId, r)
    // Move index 2 to index 0
    useDiagramStore.getState().reorderSequence(seqId, 2, 0)
    const ids = useDiagramStore.getState().sequences[seqId].relationIds
    expect(ids[0]).toBe(relIds[2])
    expect(ids[1]).toBe(relIds[0])
    expect(ids[2]).toBe(relIds[1])
  })
})

describe('clearSequence', () => {
  it('removes all steps', () => {
    const seqId = useDiagramStore.getState().addSequence('S')
    const relIds = Object.keys(useDiagramStore.getState().c4Relations).slice(0, 2)
    for (const r of relIds) useDiagramStore.getState().toggleRelationInSequence(seqId, r)
    expect(useDiagramStore.getState().sequences[seqId].relationIds.length).toBe(2)
    useDiagramStore.getState().clearSequence(seqId)
    expect(useDiagramStore.getState().sequences[seqId].relationIds).toEqual([])
  })
})
