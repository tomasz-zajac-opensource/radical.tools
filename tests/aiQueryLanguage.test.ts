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
}

const relations: Record<string, C4Relation> = {
  r1: { id: 'r1', sourceId: 'c1', targetId: 'c2', label: 'reads', technology: 'SQL' },
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

  it('lists unique technologies with counts', () => {
    const result = runModelQuery('LIST TECHNOLOGIES', { nodes, relations, views })
    expect(result.command).toBe('LIST TECHNOLOGIES')
    expect(result.result).toEqual({
      total: 4,
      rows: expect.arrayContaining([
        expect.objectContaining({ technology: 'React', nodeCount: 1, relationCount: 0 }),
        expect.objectContaining({ technology: 'SQL', nodeCount: 0, relationCount: 1 }),
      ]),
    })
  })

  it('returns node neighbors and relations', () => {
    const result = runModelQuery('GET NEIGHBORS OF c1', { nodes, relations, views })
    expect(result.command).toBe('GET NEIGHBORS OF')
    expect(result.result).toEqual(expect.objectContaining({
      nodeId: 'c1',
      neighbors: [expect.objectContaining({ id: 'c2', label: 'Ledger DB' })],
      relations: [expect.objectContaining({ id: 'r1', targetId: 'c2' })],
    }))
  })

  it('formats results as JSON', () => {
    const out = formatModelQueryResults([
      runModelQuery('STATS MODEL', { nodes, relations, views }),
    ])
    expect(out).toMatch(/"nodeCount": 3/)
    expect(out).toMatch(/"viewCount": 1/)
  })

  it('rejects unsupported queries', () => {
    expect(() => runModelQuery('DROP TABLE nodes', { nodes, relations, views })).toThrow(/Unsupported query/)
  })
})