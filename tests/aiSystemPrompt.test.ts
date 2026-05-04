import { describe, it, expect } from 'vitest'
import {
  AI_SYSTEM_PROMPT,
  buildContextMessage,
  buildMessages,
  extractJsonObject,
} from '../src/renderer/src/ai/systemPrompt'
import type { C4Node, C4Relation } from '../src/renderer/src/types/c4'

const node = (over: Partial<C4Node>): C4Node => ({
  id: 'n', type: 'system', label: 'L', collapsed: false,
  x: 0, y: 0, width: 100, height: 100, ...over,
})

describe('AI_SYSTEM_PROMPT contract', () => {
  it('mentions the JSON-only output requirement', () => {
    expect(AI_SYSTEM_PROMPT).toMatch(/ONLY a single JSON object/i)
  })

  it('mentions every supported op kind', () => {
    for (const k of ['add_node', 'add_relation', 'update_node', 'delete_node', 'delete_relation']) {
      expect(AI_SYSTEM_PROMPT).toContain(k)
    }
  })

  it('lists all valid C4 element types', () => {
    for (const t of ['person', 'system', 'container', 'component', 'database', 'webapp', 'queue']) {
      expect(AI_SYSTEM_PROMPT).toContain(`"${t}"`)
    }
  })
})

describe('buildContextMessage', () => {
  it('serialises only the relevant fields', () => {
    const msg = buildContextMessage(
      { n1: node({ id: 'n1', label: 'A', type: 'system' }) },
      { r1: { id: 'r1', sourceId: 'n1', targetId: 'n1', label: 'self' } as C4Relation },
    )
    expect(msg).toContain('"id": "n1"')
    expect(msg).toContain('"label": "A"')
    expect(msg).toContain('"sourceId": "n1"')
    // x/y/width/height are NOT included (layout is the tool's job)
    expect(msg).not.toMatch(/"width"/)
  })
})

describe('buildMessages', () => {
  it('puts system prompt first, context second, history then user prompt', () => {
    const msgs = buildMessages(
      'Add a system called Foo',
      {},
      {},
      [{ role: 'assistant', content: 'previous' }],
    )
    expect(msgs[0].role).toBe('system')
    expect(msgs[0].content).toBe(AI_SYSTEM_PROMPT)
    expect(msgs[1].role).toBe('system')
    expect(msgs[1].content).toMatch(/Current diagram state/)
    expect(msgs[2]).toEqual({ role: 'assistant', content: 'previous' })
    expect(msgs[3]).toEqual({ role: 'user', content: 'Add a system called Foo' })
  })
})

describe('extractJsonObject', () => {
  it('parses a bare object', () => {
    expect(extractJsonObject('{"a":1}')).toEqual({ a: 1 })
  })

  it('strips ```json fences', () => {
    expect(extractJsonObject('```json\n{"a":2}\n```')).toEqual({ a: 2 })
  })

  it('strips bare ``` fences', () => {
    expect(extractJsonObject('```\n{"a":3}\n```')).toEqual({ a: 3 })
  })

  it('extracts the first balanced object out of surrounding prose', () => {
    const r = extractJsonObject('Sure! Here you go:\n{"operations":[{"op":"delete_node","id":"x"}]}\nThanks.')
    expect(r).toEqual({ operations: [{ op: 'delete_node', id: 'x' }] })
  })

  it('handles braces inside string values', () => {
    const r = extractJsonObject('{"a":"has } brace","b":2}')
    expect(r).toEqual({ a: 'has } brace', b: 2 })
  })

  it('throws on missing object', () => {
    expect(() => extractJsonObject('no braces here')).toThrow(/No JSON object/)
  })

  it('throws on unbalanced object', () => {
    expect(() => extractJsonObject('{"a":1')).toThrow(/Unbalanced/)
  })
})
