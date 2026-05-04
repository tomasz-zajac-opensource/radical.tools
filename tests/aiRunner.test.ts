import { describe, it, expect, beforeEach, vi } from 'vitest'
import { runAIPrompt } from '../src/renderer/src/ai/runner'
import { defaultAISettings } from '../src/renderer/src/ai/settings'
import type { DiagramFacade } from '../src/renderer/src/ai/applyPatch'
import type { C4Node, C4Relation } from '../src/renderer/src/types/c4'

function makeFacade(): DiagramFacade & { _nodes: Record<string, C4Node>; _rels: Record<string, C4Relation> } {
  const nodes: Record<string, C4Node> = {}
  const rels: Record<string, C4Relation> = {}
  let seq = 0
  return {
    _nodes: nodes,
    _rels: rels,
    getNodes: () => nodes,
    getRelations: () => rels,
    addNode: (n) => {
      const id = `n${++seq}`
      nodes[id] = { id, ...n }
      return id
    },
    updateNode: (id, u) => { if (nodes[id]) Object.assign(nodes[id], u) },
    removeNode: (id) => { delete nodes[id] },
    addRelation: (r) => { const id = `r${++seq}`; rels[id] = { id, ...r } },
    updateRelation: (id, u) => { if (rels[id]) Object.assign(rels[id], u) },
    removeRelation: (id) => { delete rels[id] },
  }
}

function fakeOllamaFetch(content: string) {
  ;(globalThis as any).fetch = vi.fn(async () =>
    new Response(JSON.stringify({ message: { content }, model: 'llama3.1' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  )
}

describe('runAIPrompt — end-to-end with mocked Ollama', () => {
  beforeEach(() => { delete (globalThis as any).fetch })

  it('parses assistant JSON, applies it, returns a report', async () => {
    fakeOllamaFetch(JSON.stringify({
      summary: 'Created Web App and DB',
      operations: [
        { op: 'add_node', tempId: 't1', type: 'system', label: 'Web App' },
        { op: 'add_node', tempId: 't2', type: 'database', label: 'DB' },
        { op: 'add_relation', sourceId: 't1', targetId: 't2', label: 'reads' },
      ],
    }))
    const facade = makeFacade()
    const settings = defaultAISettings()
    const result = await runAIPrompt({
      prompt: 'Make a web app and a DB it reads from',
      settings,
      diagram: facade,
    })
    expect(result.summary).toMatch(/Created/)
    expect(result.report.added.nodes).toBe(2)
    expect(result.report.added.relations).toBe(1)
    expect(Object.keys(facade._nodes)).toHaveLength(2)
  })

  it('tolerates ```json fenced output from the model', async () => {
    fakeOllamaFetch('Here you go:\n```json\n{"operations":[{"op":"add_node","tempId":"t1","type":"person","label":"User"}]}\n```')
    const facade = makeFacade()
    const result = await runAIPrompt({
      prompt: 'add a user',
      settings: defaultAISettings(),
      diagram: facade,
    })
    expect(result.report.added.nodes).toBe(1)
    expect(Object.values(facade._nodes)[0].label).toBe('User')
  })

  it('surfaces parse errors from invalid model output', async () => {
    fakeOllamaFetch('not json at all')
    await expect(runAIPrompt({
      prompt: 'x',
      settings: defaultAISettings(),
      diagram: makeFacade(),
    })).rejects.toThrow(/No JSON object/)
  })
})
