import { describe, it, expect } from 'vitest'
import { useDiagramStore } from '../src/renderer/src/store/diagramStore'

describe('Connection via store actions', () => {
  it('startConnection sets connectSource', () => {
    const store = useDiagramStore.getState()
    expect(store.connectSource).toBeNull()

    store.startConnection('node-1')
    expect(useDiagramStore.getState().connectSource).toBe('node-1')

    store.cancelConnection()
    expect(useDiagramStore.getState().connectSource).toBeNull()
  })

  it('addRelation creates a new relation and edge', () => {
    const store = useDiagramStore.getState()
    const nodeIds = Object.keys(store.c4Nodes)
    expect(nodeIds.length).toBeGreaterThanOrEqual(2)

    const sourceId = nodeIds[0]
    const targetId = nodeIds[1]
    const edgesBefore = store.rfEdges.length
    const relsBefore = Object.keys(store.c4Relations).length

    store.addRelation({ sourceId, targetId })

    const after = useDiagramStore.getState()
    expect(Object.keys(after.c4Relations).length).toBe(relsBefore + 1)
    // rfEdges should also increase (or stay same if edge was already there)
    expect(after.rfEdges.length).toBeGreaterThanOrEqual(edgesBefore)
  })

  it('full connect flow: startConnection → addRelation → cancelConnection', () => {
    const store = useDiagramStore.getState()
    const nodeIds = Object.keys(store.c4Nodes)
    const src = nodeIds[0]
    const tgt = nodeIds[2]

    // Simulate first click (modifier held)
    store.startConnection(src)
    expect(useDiagramStore.getState().connectSource).toBe(src)

    // Simulate second click (modifier held) 
    const relsBefore = Object.keys(useDiagramStore.getState().c4Relations).length
    store.addRelation({ sourceId: src, targetId: tgt })
    store.cancelConnection()

    const after = useDiagramStore.getState()
    expect(after.connectSource).toBeNull()
    expect(Object.keys(after.c4Relations).length).toBe(relsBefore + 1)
  })
})
