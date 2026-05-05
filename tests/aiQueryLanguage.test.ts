import { describe, expect, it } from 'vitest'
import { formatModelQueryResults, runModelQuery } from '../src/renderer/src/ai/queryLanguage'
import type { C4Node, C4Relation, DiagramView } from '../src/renderer/src/types/c4'

const nodes: Record<string, C4Node> = {
  sys1: {
    id: 'sys1', type: 'system', label: 'Payments', technology: 'Node.js', collapsed: false,
    x: 0, y: 0, width: 100, height: 100,
  },
  c1: {
    id: 'c1', type: 'container', label: 'API Gateway', technology: 'React', parentId: 'sys1', collapsed: false,
    x: 0, y: 0, width: 100, height: 100,
  },
  c2: {
    id: 'c2', type: 'database', label: 'Ledger DB', technology: 'Postgres', parentId: 'sys1', collapsed: false,
    x: 0, y: 0, width: 100, height: 100,
  },
  c3: {
    id: 'c3', type: 'container', label: 'Auth Service', technology: 'Go', parentId: 'sys1', collapsed: false,
    x: 0, y: 0, width: 100, height: 100,
  },
  c4: {
    id: 'c4', type: 'container', label: 'Worker', technology: 'Kafka', parentId: 'sys1', collapsed: false,
    x: 0, y: 0, width: 100, height: 100,
  },
}

const relations: Record<string, C4Relation> = {
  r1: { id: 'r1', sourceId: 'c1', targetId: 'c2', label: 'reads', technology: 'SQL' },
  r2: { id: 'r2', sourceId: 'c1', targetId: 'c3', label: 'auth', technology: 'HTTPS' },
  r3: { id: 'r3', sourceId: 'c3', targetId: 'c2', label: 'reads', technology: 'SQL' },
  r4: { id: 'r4', sourceId: 'c4', targetId: 'c3', label: 'calls', technology: 'gRPC' },
}

const views: Record<string, DiagramView> = {
  v1: {
    id: 'v1',
    name: 'Payments View',
    nodeIds: ['c1', 'c2'],
    positions: {},
    hiddenRelationIds: [],
  },
}

describe('runModelQuery', () => {
  it('lists nodes with WHERE and LIMIT', () => {
    const result = runModelQuery('LIST NODES WHERE label ~ "api" LIMIT 1', { nodes, relations, views })
    expect(result.command).toBe('LIST NODES')
    expect(result.result).toEqual({
      total: 1,
      rows: [
        expect.objectContaining({ id: 'c1', label: 'API Gateway' }),
      ],
    })
  })

  it('supports OR, NOT and parentheses in WHERE expressions', () => {
    const result = runModelQuery(
      'LIST NODES WHERE NOT type = "database" AND (technology ~ "go" OR technology ~ "react")',
      { nodes, relations, views },
    )
    expect(result.command).toBe('LIST NODES')
    expect(result.result).toEqual({
      total: 2,
      rows: [
        expect.objectContaining({ id: 'c1', label: 'API Gateway' }),
        expect.objectContaining({ id: 'c3', label: 'Auth Service' }),
      ],
    })
  })

  it('lists unique technologies with counts', () => {
    const result = runModelQuery('LIST TECHNOLOGIES', { nodes, relations, views })
    expect(result.command).toBe('LIST TECHNOLOGIES')
    expect(result.result).toEqual({
      total: 8,
      rows: expect.arrayContaining([
        expect.objectContaining({ technology: 'React', nodeCount: 1, relationCount: 0 }),
        expect.objectContaining({ technology: 'SQL', nodeCount: 0, relationCount: 2 }),
        expect.objectContaining({ technology: 'gRPC', nodeCount: 0, relationCount: 1 }),
      ]),
    })
  })

  it('returns node neighbors and relations', () => {
    const result = runModelQuery('GET NEIGHBORS OF c1', { nodes, relations, views })
    expect(result.command).toBe('GET NEIGHBORS OF')
    expect(result.result).toEqual(expect.objectContaining({
      nodeId: 'c1',
      total: 2,
      neighbors: expect.arrayContaining([
        expect.objectContaining({ id: 'c2', label: 'Ledger DB' }),
        expect.objectContaining({ id: 'c3', label: 'Auth Service' }),
      ]),
      relations: expect.arrayContaining([
        expect.objectContaining({ id: 'r1', targetId: 'c2' }),
        expect.objectContaining({ id: 'r2', targetId: 'c3' }),
      ]),
    }))
  })

  it('supports multi-hop neighbor traversal with depth information', () => {
    const result = runModelQuery('GET NEIGHBORS OF c4 DEPTH 2', { nodes, relations, views })
    expect(result.command).toBe('GET NEIGHBORS OF')
    expect(result.result).toEqual(expect.objectContaining({
      nodeId: 'c4',
      total: 3,
      rows: expect.arrayContaining([
        expect.objectContaining({ depth: 1, node: expect.objectContaining({ id: 'c3' }) }),
        expect.objectContaining({ depth: 2, node: expect.objectContaining({ id: 'c1' }) }),
        expect.objectContaining({ depth: 2, node: expect.objectContaining({ id: 'c2' }) }),
      ]),
    }))
  })

  it('supports dependency and dependent traversals across multiple hops', () => {
    const dependencies = runModelQuery('GET DEPENDENCIES OF c4 DEPTH 2', { nodes, relations, views })
    expect(dependencies.command).toBe('GET DEPENDENCIES OF')
    expect(dependencies.result).toEqual(expect.objectContaining({
      nodeId: 'c4',
      rows: expect.arrayContaining([
        expect.objectContaining({ depth: 1, node: expect.objectContaining({ id: 'c3' }) }),
        expect.objectContaining({ depth: 2, node: expect.objectContaining({ id: 'c2' }) }),
      ]),
    }))

    const dependents = runModelQuery('GET DEPENDENTS OF c2 DEPTH 2', { nodes, relations, views })
    expect(dependents.command).toBe('GET DEPENDENTS OF')
    expect(dependents.result).toEqual(expect.objectContaining({
      nodeId: 'c2',
      rows: expect.arrayContaining([
        expect.objectContaining({ depth: 1, node: expect.objectContaining({ id: 'c1' }) }),
        expect.objectContaining({ depth: 1, node: expect.objectContaining({ id: 'c3' }) }),
        expect.objectContaining({ depth: 2, node: expect.objectContaining({ id: 'c4' }) }),
      ]),
    }))
  })

  it('formats results as JSON', () => {
    const out = formatModelQueryResults([
      runModelQuery('STATS MODEL', { nodes, relations, views }),
    ])
    expect(out).toMatch(/"nodeCount": 5/)
    expect(out).toMatch(/"viewCount": 1/)
  })

  it('rejects unsupported queries', () => {
    expect(() => runModelQuery('DROP TABLE nodes', { nodes, relations, views })).toThrow(/Unsupported query/)
  })
})