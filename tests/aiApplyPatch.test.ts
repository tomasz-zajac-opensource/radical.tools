import { describe, it, expect } from 'vitest'
import { applyPatch, validatePatch, type DiagramFacade } from '../src/renderer/src/ai/applyPatch'
import type { C4Node, C4Relation } from '../src/renderer/src/types/c4'

function makeFacade(): DiagramFacade & { _nodes: Record<string, C4Node>; _rels: Record<string, C4Relation>; _seq: number } {
  const nodes: Record<string, C4Node> = {}
  const rels: Record<string, C4Relation> = {}
  let seq = 0
  return {
    _nodes: nodes,
    _rels: rels,
    _seq: seq,
    getNodes: () => nodes,
    getRelations: () => rels,
    addNode: (n) => {
      const id = `n${++seq}`
      nodes[id] = { id, ...n }
      return id
    },
    updateNode: (id, u) => {
      if (nodes[id]) Object.assign(nodes[id], u)
    },
    removeNode: (id) => { delete nodes[id] },
    addRelation: (r) => {
      const id = `r${++seq}`
      rels[id] = { id, ...r }
    },
    updateRelation: (id, u) => {
      if (rels[id]) Object.assign(rels[id], u)
    },
    removeRelation: (id) => { delete rels[id] },
    clearDiagram: () => {
      for (const id of Object.keys(nodes)) delete nodes[id]
      for (const id of Object.keys(rels)) delete rels[id]
    },
  }
}

describe('validatePatch', () => {
  it('rejects non-object input', () => {
    expect(() => validatePatch(null)).toThrow()
    expect(() => validatePatch('foo')).toThrow()
    expect(() => validatePatch({ operations: 'nope' })).toThrow(/operations/)
  })

  it('rejects unknown op kind', () => {
    expect(() => validatePatch({ operations: [{ op: 'bogus' }] })).toThrow(/unknown op/)
  })

  it('rejects add_node with invalid type', () => {
    expect(() => validatePatch({
      operations: [{ op: 'add_node', tempId: 't1', type: 'spaceship', label: 'X' }],
    })).toThrow(/invalid type/)
  })

  it('rejects add_node missing label', () => {
    expect(() => validatePatch({
      operations: [{ op: 'add_node', tempId: 't1', type: 'system', label: '   ' }],
    })).toThrow(/label required/)
  })

  it('accepts a well-formed patch', () => {
    const p = validatePatch({
      summary: 'ok',
      operations: [
        { op: 'add_node', tempId: 't1', type: 'system', label: 'API' },
        { op: 'add_relation', sourceId: 't1', targetId: 't1', label: 'self' },
      ],
    })
    expect(p.summary).toBe('ok')
    expect(p.operations).toHaveLength(2)
  })
})

describe('applyPatch', () => {
  it('creates nodes and resolves tempId references', () => {
    const f = makeFacade()
    const r = applyPatch(
      validatePatch({
        operations: [
          { op: 'add_node', tempId: 't1', type: 'system', label: 'Web App' },
          { op: 'add_node', tempId: 't2', type: 'database', label: 'PG' },
          { op: 'add_relation', sourceId: 't1', targetId: 't2', label: 'reads' },
        ],
      }),
      f,
    )
    expect(r.added.nodes).toBe(2)
    expect(r.added.relations).toBe(1)
    expect(r.errors).toEqual([])
    const nodeIds = Object.keys(f._nodes)
    expect(nodeIds).toHaveLength(2)
    const rel = Object.values(f._rels)[0]
    expect(nodeIds).toContain(rel.sourceId)
    expect(nodeIds).toContain(rel.targetId)
    expect(rel.label).toBe('reads')
  })

  it('resolves parentId via tempId in same patch', () => {
    const f = makeFacade()
    applyPatch(
      validatePatch({
        operations: [
          { op: 'add_node', tempId: 'sys', type: 'system', label: 'Sys' },
          { op: 'add_node', tempId: 'c1', type: 'container', label: 'Web', parentId: 'sys' },
        ],
      }),
      f,
    )
    const sys = Object.values(f._nodes).find((n) => n.label === 'Sys')!
    const c1 = Object.values(f._nodes).find((n) => n.label === 'Web')!
    expect(c1.parentId).toBe(sys.id)
  })

  it('reports per-op errors but continues with others', () => {
    const f = makeFacade()
    const r = applyPatch(
      validatePatch({
        operations: [
          { op: 'add_node', tempId: 't1', type: 'system', label: 'A' },
          { op: 'add_relation', sourceId: 'ghost', targetId: 't1' },
          { op: 'add_node', tempId: 't2', type: 'system', label: 'B' },
        ],
      }),
      f,
    )
    expect(r.added.nodes).toBe(2)
    expect(r.added.relations).toBe(0)
    expect(r.errors).toHaveLength(1)
    expect(r.errors[0]).toMatch(/unknown sourceId/)
  })

  it('updates and deletes existing nodes and relations', () => {
    const f = makeFacade()
    f._nodes['n-existing'] = {
      id: 'n-existing', type: 'system', label: 'Old', collapsed: false,
      x: 0, y: 0, width: 100, height: 100,
    } as C4Node
    f._nodes['n-keep'] = {
      id: 'n-keep', type: 'system', label: 'K', collapsed: false,
      x: 0, y: 0, width: 100, height: 100,
    } as C4Node
    f._rels['r-existing'] = { id: 'r-existing', sourceId: 'n-existing', targetId: 'n-keep' }
    const r = applyPatch(
      validatePatch({
        operations: [
          { op: 'update_node', id: 'n-existing', label: 'New', description: 'd' },
          { op: 'delete_relation', id: 'r-existing' },
          { op: 'delete_node', id: 'n-existing' },
        ],
      }),
      f,
    )
    expect(r.updated.nodes).toBe(1)
    expect(r.deleted.nodes).toBe(1)
    expect(r.deleted.relations).toBe(1)
    expect(f._nodes['n-existing']).toBeUndefined()
    expect(f._rels['r-existing']).toBeUndefined()
    expect(f._nodes['n-keep']).toBeDefined()
  })

  it('marks add_node failure when store rejects (returns empty id)', () => {
    const f = makeFacade()
    f.addNode = () => ''
    const r = applyPatch(
      validatePatch({ operations: [{ op: 'add_node', tempId: 't1', type: 'system', label: 'X' }] }),
      f,
    )
    expect(r.added.nodes).toBe(0)
    expect(r.errors[0]).toMatch(/rejected by the metamodel/)
  })

  it('tolerates a patch with no operations field (empty patch)', () => {
    const p = validatePatch({ summary: 'nothing to do' })
    expect(p.operations).toEqual([])
    expect(p.summary).toBe('nothing to do')
  })

  it('reset_diagram clears prior graph and focus_node resolves tempIds', () => {
    const f = makeFacade()
    f._nodes['legacy'] = {
      id: 'legacy', type: 'system', label: 'Legacy', collapsed: false,
      x: 0, y: 0, width: 100, height: 100,
    } as C4Node

    const r = applyPatch(
      validatePatch({
        operations: [
          { op: 'reset_diagram' },
          { op: 'add_node', tempId: 't1', type: 'system', label: 'Fresh' },
          { op: 'focus_node', id: 't1' },
        ],
      }),
      f,
    )

    expect(r.errors).toEqual([])
    expect(Object.keys(f._nodes)).toHaveLength(1)
    expect(Object.values(f._nodes)[0].label).toBe('Fresh')
    expect(r.focusNodeId).toBe(Object.values(f._nodes)[0].id)
  })
})

describe('applyPatch — view ops', () => {
  function makeViewFacade() {
    const base = makeFacade()
    type View = { id: string; name: string; nodeIds: string[] }
    const views: Record<string, View> = {}
    let activeViewId: string | null = null
    return {
      ...base,
      _views: views,
      get _activeViewId() { return activeViewId },
      getViews: () => views,
      addView: (name: string) => {
        const id = `v${Object.keys(views).length + 1}`
        views[id] = { id, name, nodeIds: [] }
        return id
      },
      setViewNodes: (id: string, nodeIds: string[]) => {
        if (views[id]) views[id].nodeIds = nodeIds.filter((n) => n in base._nodes)
      },
      removeView: (id: string) => {
        delete views[id]
        if (activeViewId === id) activeViewId = null
      },
      setActiveView: (id: string | null) => { activeViewId = id },
    }
  }

  it('add_view + nodeIds resolves node tempIds in the same patch', () => {
    const f = makeViewFacade()
    const r = applyPatch(
      validatePatch({
        operations: [
          { op: 'add_node', tempId: 't1', type: 'system', label: 'API' },
          { op: 'add_node', tempId: 't2', type: 'database', label: 'PG' },
          { op: 'add_view', tempId: 'v1', name: 'API + DB', nodeIds: ['t1', 't2'], active: true },
        ],
      }),
      f,
    )
    expect(r.errors).toEqual([])
    expect(r.added.nodes).toBe(2)
    expect(r.added.views).toBe(1)
    const view = Object.values(f._views)[0]
    expect(view.nodeIds).toHaveLength(2)
    expect(view.nodeIds.every((id) => id in f._nodes)).toBe(true)
    expect(f._activeViewId).toBe(view.id)
  })

  it('set_view_nodes replaces the visible-node set', () => {
    const f = makeViewFacade()
    applyPatch(
      validatePatch({
        operations: [
          { op: 'add_node', tempId: 'a', type: 'system', label: 'A' },
          { op: 'add_node', tempId: 'b', type: 'system', label: 'B' },
          { op: 'add_view', tempId: 'v', name: 'V', nodeIds: ['a'] },
          { op: 'set_view_nodes', id: 'v', nodeIds: ['a', 'b'] },
        ],
      }),
      f,
    )
    const v = Object.values(f._views)[0]
    expect(v.nodeIds).toHaveLength(2)
  })

  it('reports an error when the facade has no view support', () => {
    const f = makeFacade() // no view methods
    const r = applyPatch(
      validatePatch({ operations: [{ op: 'add_view', tempId: 'v', name: 'X' }] }),
      f,
    )
    expect(r.added.views).toBe(0)
    expect(r.errors[0]).toMatch(/views are not editable/)
  })
})
