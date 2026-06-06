/**
 * Model CRUD tests.
 *
 * Covers addNode / updateNode / removeNode behaviour:
 *   - addNode returns an id, inserts the node, auto-adds it to the active view
 *   - updateNode mutates existing fields, ignores non-existent ids
 *   - removeNode cascades to descendants, drops touching relations,
 *     and prunes the deleted ids from every view
 *   - metamodel cardinality / parent containment is enforced
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { useDiagramStore } from '../src/renderer/src/store/diagramStore'
import type { C4Node, C4Relation, DiagramView } from '../src/renderer/src/types/c4'

// Snapshot the pristine sample on import so each test starts from the same
// state. We only need the bits the model actions touch.
const initial = (() => {
  const s = useDiagramStore.getState()
  return {
    c4Nodes: JSON.parse(JSON.stringify(s.c4Nodes)) as Record<string, C4Node>,
    c4Relations: JSON.parse(JSON.stringify(s.c4Relations)) as Record<string, C4Relation>,
    views: JSON.parse(JSON.stringify(s.views)) as Record<string, DiagramView>,
    activeViewId: s.activeViewId,
  }
})()

beforeEach(() => {
  useDiagramStore.setState({
    c4Nodes: JSON.parse(JSON.stringify(initial.c4Nodes)),
    c4Relations: JSON.parse(JSON.stringify(initial.c4Relations)),
    views: JSON.parse(JSON.stringify(initial.views)),
    activeViewId: initial.activeViewId,
  } as any)
  useDiagramStore.getState()._sync()
})

describe('addNode', () => {
  it('returns a non-empty id and inserts the node', () => {
    const id = useDiagramStore.getState().addNode({
      type: 'system',
      label: 'New System',
      collapsed: false,
      x: 0, y: 0, width: 200, height: 120,
    } as any)
    expect(id).toBeTruthy()
    const node = useDiagramStore.getState().c4Nodes[id]
    expect(node).toBeDefined()
    expect(node.label).toBe('New System')
  })

  it('auto-adds the new node to the active view', () => {
    // pick the first existing view as active
    const viewIds = Object.keys(useDiagramStore.getState().views)
    if (viewIds.length === 0) return // skip if seed has none
    useDiagramStore.setState({ activeViewId: viewIds[0] } as any)
    const before = useDiagramStore.getState().views[viewIds[0]].nodeIds.length
    const id = useDiagramStore.getState().addNode({
      type: 'system',
      label: 'Auto-added',
      collapsed: false,
      x: 0, y: 0, width: 200, height: 120,
    } as any)
    const after = useDiagramStore.getState().views[viewIds[0]].nodeIds
    expect(after).toContain(id)
    expect(after.length).toBe(before + 1)
  })

  it('rejects placing a person inside a system (allowedParents = root)', () => {
    const sysId = Object.entries(useDiagramStore.getState().c4Nodes).find(
      ([, n]) => n.type === 'system',
    )?.[0]
    expect(sysId).toBeDefined()
    const before = Object.keys(useDiagramStore.getState().c4Nodes).length
    const id = useDiagramStore.getState().addNode({
      type: 'person',
      parentId: sysId!,
      label: 'Bad',
      collapsed: false,
      x: 0, y: 0, width: 100, height: 100,
    } as any)
    expect(id).toBe('')
    expect(Object.keys(useDiagramStore.getState().c4Nodes).length).toBe(before)
  })
})

describe('updateNode', () => {
  it('updates label / description / technology fields', () => {
    const id = Object.keys(useDiagramStore.getState().c4Nodes)[0]
    useDiagramStore.getState().updateNode(id, { label: 'Renamed', description: 'desc' } as any)
    const n = useDiagramStore.getState().c4Nodes[id]
    expect(n.label).toBe('Renamed')
    expect(n.description).toBe('desc')
  })

  it('is a no-op for unknown id', () => {
    const before = JSON.stringify(useDiagramStore.getState().c4Nodes)
    useDiagramStore.getState().updateNode('does-not-exist', { label: 'x' } as any)
    expect(JSON.stringify(useDiagramStore.getState().c4Nodes)).toBe(before)
  })
})

describe('removeNode', () => {
  it('removes the node and cascades to descendants', () => {
    // sys1 has children ctn1..ctn5 in the sample
    expect(useDiagramStore.getState().c4Nodes['sys1']).toBeDefined()
    expect(useDiagramStore.getState().c4Nodes['ctn1']).toBeDefined()
    useDiagramStore.getState().removeNode('sys1')
    const after = useDiagramStore.getState().c4Nodes
    expect(after['sys1']).toBeUndefined()
    expect(after['ctn1']).toBeUndefined()
    expect(after['ctn2']).toBeUndefined()
  })

  it('drops relations that touch removed nodes', () => {
    // r00 references usr1; removing usr1 should drop r00
    expect(useDiagramStore.getState().c4Relations['r00']).toBeDefined()
    useDiagramStore.getState().removeNode('usr1')
    expect(useDiagramStore.getState().c4Relations['r00']).toBeUndefined()
  })

  it('removes the node from every view nodeIds list', () => {
    // Force-add ctn1 into every view so the prune is observable
    useDiagramStore.setState((s: any) => {
      for (const v of Object.values(s.views) as any[]) {
        if (!v.nodeIds.includes('ctn1')) v.nodeIds.push('ctn1')
      }
      return s
    })
    useDiagramStore.getState().removeNode('ctn1')
    for (const v of Object.values(useDiagramStore.getState().views)) {
      expect(v.nodeIds).not.toContain('ctn1')
    }
  })
})

describe('group nesting', () => {
  it('allows placing a group inside another group', () => {
    const outerGroupId = useDiagramStore.getState().addNode({
      type: 'group',
      label: 'Outer Group',
      collapsed: false,
      x: 0, y: 0, width: 520, height: 360,
    } as any)
    expect(outerGroupId).toBeTruthy()

    const innerGroupId = useDiagramStore.getState().addNode({
      type: 'group',
      label: 'Inner Group',
      parentId: outerGroupId,
      collapsed: false,
      x: 20, y: 120, width: 520, height: 360,
    } as any)
    expect(innerGroupId).toBeTruthy()
    expect(useDiagramStore.getState().c4Nodes[innerGroupId].parentId).toBe(outerGroupId)
  })

  it('RF nodes: parent group appears before child group', () => {
    const outerGroupId = useDiagramStore.getState().addNode({
      type: 'group',
      label: 'Outer Group',
      collapsed: false,
      x: 0, y: 0, width: 520, height: 360,
    } as any)
    const innerGroupId = useDiagramStore.getState().addNode({
      type: 'group',
      label: 'Inner Group',
      parentId: outerGroupId,
      collapsed: false,
      x: 20, y: 120, width: 520, height: 360,
    } as any)
    useDiagramStore.getState()._sync()
    const rfNodes = useDiagramStore.getState().rfNodes
    const outerIdx = rfNodes.findIndex((n: any) => n.id === outerGroupId)
    const innerIdx = rfNodes.findIndex((n: any) => n.id === innerGroupId)
    expect(outerIdx).toBeGreaterThanOrEqual(0)
    expect(innerIdx).toBeGreaterThanOrEqual(0)
    expect(outerIdx).toBeLessThan(innerIdx)
    // Verify parentNode is set on the RF node
    const innerRF = rfNodes.find((n: any) => n.id === innerGroupId) as any
    expect(innerRF.parentNode).toBe(outerGroupId)
  })

  it('allows placing a system inside a group', () => {
    const groupId = useDiagramStore.getState().addNode({
      type: 'group',
      label: 'My Group',
      collapsed: false,
      x: 0, y: 0, width: 520, height: 360,
    } as any)
    const sysId = useDiagramStore.getState().addNode({
      type: 'system',
      label: 'Sys Inside Group',
      parentId: groupId,
      collapsed: false,
      x: 20, y: 120, width: 360, height: 260,
    } as any)
    expect(sysId).toBeTruthy()
    expect(useDiagramStore.getState().c4Nodes[sysId].parentId).toBe(groupId)
  })
})
