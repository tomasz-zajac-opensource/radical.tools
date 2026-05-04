/**
 * Undo / redo tests.
 *
 * Covers:
 *   - addNode → undo restores prior c4Nodes; redo reapplies
 *   - updateNode round-trip
 *   - removeNode round-trip (cascade is also undone in one shot)
 *   - canUndo / canRedo flags reflect the stack state
 *   - undo on an empty stack is a no-op
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { useDiagramStore } from '../src/renderer/src/store/diagramStore'
import type { C4Node, C4Relation } from '../src/renderer/src/types/c4'

const initial = (() => {
  const s = useDiagramStore.getState()
  return {
    c4Nodes: JSON.parse(JSON.stringify(s.c4Nodes)) as Record<string, C4Node>,
    c4Relations: JSON.parse(JSON.stringify(s.c4Relations)) as Record<string, C4Relation>,
  }
})()

beforeEach(() => {
  useDiagramStore.setState({
    c4Nodes: JSON.parse(JSON.stringify(initial.c4Nodes)),
    c4Relations: JSON.parse(JSON.stringify(initial.c4Relations)),
    canUndo: false,
    canRedo: false,
    appMode: 'designer',
    presentationActive: false,
  } as any)
  // Drain any leftover undo stack from previous tests by undoing until canUndo=false
  let safety = 100
  while (useDiagramStore.getState().canUndo && safety-- > 0) {
    useDiagramStore.getState().undo()
  }
  // After draining, restore baseline again so we start clean
  useDiagramStore.setState({
    c4Nodes: JSON.parse(JSON.stringify(initial.c4Nodes)),
    c4Relations: JSON.parse(JSON.stringify(initial.c4Relations)),
    canUndo: false,
    canRedo: false,
  } as any)
  useDiagramStore.getState()._sync()
})

describe('undo / redo', () => {
  it('undo on an empty stack is a no-op', () => {
    const before = JSON.stringify(useDiagramStore.getState().c4Nodes)
    useDiagramStore.getState().undo()
    expect(JSON.stringify(useDiagramStore.getState().c4Nodes)).toBe(before)
  })

  it('addNode → undo removes it; redo reapplies', () => {
    const before = Object.keys(useDiagramStore.getState().c4Nodes).length
    const id = useDiagramStore.getState().addNode({
      type: 'system', label: 'X', collapsed: false, x: 0, y: 0, width: 200, height: 100,
    } as any)
    expect(Object.keys(useDiagramStore.getState().c4Nodes).length).toBe(before + 1)
    expect(useDiagramStore.getState().canUndo).toBe(true)

    useDiagramStore.getState().undo()
    expect(useDiagramStore.getState().c4Nodes[id]).toBeUndefined()
    expect(Object.keys(useDiagramStore.getState().c4Nodes).length).toBe(before)
    expect(useDiagramStore.getState().canRedo).toBe(true)

    useDiagramStore.getState().redo()
    expect(useDiagramStore.getState().c4Nodes[id]).toBeDefined()
  })

  it('updateNode round-trip restores the original label', () => {
    const id = Object.keys(useDiagramStore.getState().c4Nodes)[0]
    const original = useDiagramStore.getState().c4Nodes[id].label
    useDiagramStore.getState().updateNode(id, { label: 'TEMPORARY' } as any)
    expect(useDiagramStore.getState().c4Nodes[id].label).toBe('TEMPORARY')
    useDiagramStore.getState().undo()
    expect(useDiagramStore.getState().c4Nodes[id].label).toBe(original)
    useDiagramStore.getState().redo()
    expect(useDiagramStore.getState().c4Nodes[id].label).toBe('TEMPORARY')
  })

  it('removeNode (with cascade) round-trip restores the whole subtree', () => {
    // sys1 + its children
    const sys1Children = Object.values(useDiagramStore.getState().c4Nodes).filter(
      (n) => n.parentId === 'sys1',
    ).length
    expect(sys1Children).toBeGreaterThan(0)
    useDiagramStore.getState().removeNode('sys1')
    expect(useDiagramStore.getState().c4Nodes['sys1']).toBeUndefined()
    useDiagramStore.getState().undo()
    expect(useDiagramStore.getState().c4Nodes['sys1']).toBeDefined()
    const restoredChildren = Object.values(useDiagramStore.getState().c4Nodes).filter(
      (n) => n.parentId === 'sys1',
    ).length
    expect(restoredChildren).toBe(sys1Children)
  })
})
