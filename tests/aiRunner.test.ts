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

// All runner tests target the Ollama adapter (no API key required), so we
// override the default-active provider (which is intentionally OpenAI in
// production so that the AI agent stays hidden until the user sets a key).
function ollamaSettings() {
  const s = defaultAISettings()
  s.active = 'ollama'
  return s
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
    const settings = ollamaSettings()
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
      settings: ollamaSettings(),
      diagram: facade,
    })
    expect(result.report.added.nodes).toBe(1)
    expect(Object.values(facade._nodes)[0].label).toBe('User')
  })

  it('surfaces parse errors from invalid model output via the report', async () => {
    fakeOllamaFetch('not json at all')
    const result = await runAIPrompt({
      prompt: 'x',
      settings: ollamaSettings(),
      diagram: makeFacade(),
    })
    expect(result.report.errors.join('\n')).toMatch(/Patch parse failed/)
    expect(result.report.added.nodes).toBe(0)
  })

  it('feedback loop: re-asks the model when an op was rejected, and merges the result', async () => {
    // First round: tries to add a "database" with no parent → store rejects it
    // (database needs allowedParents=['system']). The relation referencing the
    // failed tempId then also fails.
    // Second round: model adds the system first, then the database with parentId.
    const responses = [
      JSON.stringify({
        summary: 'attempt 1',
        operations: [
          { op: 'add_node', tempId: 't1', type: 'database', label: 'DB' },
          { op: 'add_relation', sourceId: 't1', targetId: 't1', label: 'self' },
        ],
      }),
      JSON.stringify({
        summary: 'attempt 2',
        operations: [
          { op: 'add_node', tempId: 's1', type: 'system', label: 'Sys' },
          { op: 'add_node', tempId: 'd1', type: 'database', label: 'DB', parentId: 's1' },
        ],
      }),
    ]
    let call = 0
    ;(globalThis as any).fetch = vi.fn(async () => {
      const content = responses[call++] ?? '{"operations":[]}'
      return new Response(JSON.stringify({ message: { content }, model: 'llama3.1' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })

    // Facade that mimics the real store's metamodel rejection: addNode for
    // 'database' without a parent returns '' (rejected), and metamodel info
    // is exposed so the AI can see the rule.
    const base = makeFacade()
    const facade: DiagramFacade = {
      ...base,
      getMetamodel: () => ({
        id: 'c4', name: 'C4',
        nodeTypes: {
          system: { id: 'system', label: 'System', color: '', fg: '', iconPath: '', width: 0, height: 0, allowedAtRoot: true },
          database: { id: 'database', label: 'DB', color: '', fg: '', iconPath: '', width: 0, height: 0, allowedParents: ['system'] },
        },
        relationTypes: {},
      }) as any,
      addNode: (n) => {
        if (n.type === 'database' && !n.parentId) return '' // rejected by metamodel
        return base.addNode(n)
      },
    }

    const result = await runAIPrompt({
      prompt: 'add a database',
      settings: ollamaSettings(),
      diagram: facade,
      maxRetries: 2,
    })

    expect(result.retries).toBe(1)
    expect(result.report.added.nodes).toBe(2) // system + database from round 2
    expect(result.report.errors).toEqual([])
  })

  it('preserves focus_node in the aggregated report', async () => {
    fakeOllamaFetch(JSON.stringify({
      summary: 'Focused API',
      operations: [
        { op: 'add_node', tempId: 't1', type: 'system', label: 'API' },
        { op: 'focus_node', id: 't1' },
      ],
    }))

    const result = await runAIPrompt({
      prompt: 'show me the API',
      settings: ollamaSettings(),
      diagram: makeFacade(),
    })

    expect(result.report.errors).toEqual([])
    expect(result.report.focusNodeId).toBeDefined()
    expect(result.report.focusNodeId).toMatch(/^n\d+$/)
  })

  it('executes query_model locally and continues with the next AI round', async () => {
    const responses = [
      JSON.stringify({
        operations: [
          { op: 'query_model', query: 'LIST TECHNOLOGIES' },
        ],
      }),
      JSON.stringify({
        summary: 'Technologies in use:\n- React\n- HTTPS',
        operations: [],
      }),
    ]
    let call = 0
    ;(globalThis as any).fetch = vi.fn(async () => {
      const content = responses[call++] ?? '{"operations":[]}'
      return new Response(JSON.stringify({ message: { content }, model: 'llama3.1' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })

    const facade = makeFacade()
    facade.addNode({
      type: 'system',
      label: 'Web App',
      technology: 'React',
      collapsed: false,
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    })
    facade.addRelation({ sourceId: 'n1', targetId: 'n1', technology: 'HTTPS' })

    const result = await runAIPrompt({
      prompt: 'List all technologies in the model',
      settings: ollamaSettings(),
      diagram: facade,
    })

    expect(result.report.errors).toEqual([])
    expect(result.summary).toMatch(/React/)
    expect(result.summary).toMatch(/HTTPS/)
    expect((globalThis as any).fetch).toHaveBeenCalledTimes(2)
  })
})
