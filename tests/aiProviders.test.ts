import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ollamaAdapter } from '../src/renderer/src/ai/providers/ollama'
import { openaiAdapter } from '../src/renderer/src/ai/providers/openai'
import { claudeAdapter } from '../src/renderer/src/ai/providers/claude'
import { geminiAdapter } from '../src/renderer/src/ai/providers/gemini'
import { ADAPTERS, getAdapter, listAdapters } from '../src/renderer/src/ai/registry'
import type { ChatMessage, ChatRequest } from '../src/renderer/src/ai/types'

interface CapturedCall {
  url: string
  init: RequestInit
  bodyParsed: any
}

function installFetch(response: any, status = 200): { calls: CapturedCall[] } {
  const calls: CapturedCall[] = []
  ;(globalThis as any).fetch = vi.fn(async (url: string, init: RequestInit) => {
    const bodyText = typeof init?.body === 'string' ? init.body : ''
    calls.push({ url, init, bodyParsed: bodyText ? JSON.parse(bodyText) : null })
    return new Response(JSON.stringify(response), {
      status,
      headers: { 'content-type': 'application/json' },
    }) as any
  })
  return { calls }
}

const SAMPLE: ChatMessage[] = [
  { role: 'system', content: 'sys-1' },
  { role: 'user', content: 'hello' },
]

describe('AI providers', () => {
  beforeEach(() => {
    delete (globalThis as any).fetch
  })

  it('registry exposes all four adapters', () => {
    const ids = listAdapters().map((a) => a.id).sort()
    expect(ids).toEqual(['anthropic', 'gemini', 'ollama', 'openai'])
    expect(getAdapter('ollama').label).toMatch(/Ollama/)
    expect(ADAPTERS.openai).toBe(openaiAdapter)
  })

  it('Ollama: posts to /api/chat with stream:false and parses message.content', async () => {
    const { calls } = installFetch({ message: { content: 'hi from llama' }, model: 'llama3.1' })
    const req: ChatRequest = { model: 'llama3.1', messages: SAMPLE, jsonMode: true }
    const out = await ollamaAdapter.chat(req, { baseUrl: 'http://h:1234' })
    expect(out.content).toBe('hi from llama')
    expect(out.model).toBe('llama3.1')
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('http://h:1234/api/chat')
    expect(calls[0].bodyParsed.stream).toBe(false)
    expect(calls[0].bodyParsed.format).toBe('json')
    expect(calls[0].bodyParsed.messages).toEqual([
      { role: 'system', content: 'sys-1' },
      { role: 'user', content: 'hello' },
    ])
  })

  it('Ollama: throws on non-2xx', async () => {
    installFetch({ error: 'nope' }, 500)
    await expect(ollamaAdapter.chat({ model: 'm', messages: SAMPLE }, {})).rejects.toThrow(/Ollama HTTP 500/)
  })

  it('OpenAI: requires key, sends Bearer + json_object response_format', async () => {
    await expect(openaiAdapter.chat({ model: 'm', messages: SAMPLE }, {})).rejects.toThrow(/API key/)
    const { calls } = installFetch({
      model: 'gpt-4o-mini',
      choices: [{ message: { content: 'reply' } }],
    })
    const out = await openaiAdapter.chat(
      { model: 'gpt-4o-mini', messages: SAMPLE, jsonMode: true },
      { apiKey: 'sk-x' },
    )
    expect(out.content).toBe('reply')
    expect(calls[0].url).toBe('https://api.openai.com/v1/chat/completions')
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer sk-x')
    expect(calls[0].bodyParsed.response_format).toEqual({ type: 'json_object' })
  })

  it('Claude: splits system, sets x-api-key + version + browser-access headers', async () => {
    await expect(claudeAdapter.chat({ model: 'm', messages: SAMPLE }, {})).rejects.toThrow(/API key/)
    const { calls } = installFetch({
      model: 'claude-3-5-sonnet-20241022',
      content: [{ type: 'text', text: 'hello' }, { type: 'text', text: ' world' }],
    })
    const out = await claudeAdapter.chat(
      { model: 'claude-3-5-sonnet-20241022', messages: SAMPLE },
      { apiKey: 'k-claude' },
    )
    expect(out.content).toBe('hello world')
    expect(calls[0].url).toBe('https://api.anthropic.com/v1/messages')
    const headers = calls[0].init.headers as Record<string, string>
    expect(headers['x-api-key']).toBe('k-claude')
    expect(headers['anthropic-version']).toBe('2023-06-01')
    expect(headers['anthropic-dangerous-direct-browser-access']).toBe('true')
    expect(calls[0].bodyParsed.system).toBe('sys-1')
    expect(calls[0].bodyParsed.messages).toEqual([{ role: 'user', content: 'hello' }])
  })

  it('Gemini: uses key in query string, separates system_instruction', async () => {
    await expect(geminiAdapter.chat({ model: 'm', messages: SAMPLE }, {})).rejects.toThrow(/API key/)
    const { calls } = installFetch({
      modelVersion: 'gemini-1.5-flash',
      candidates: [{ content: { parts: [{ text: 'gem' }, { text: 'ini' }] } }],
    })
    const out = await geminiAdapter.chat(
      { model: 'gemini-1.5-flash', messages: SAMPLE, jsonMode: true },
      { apiKey: 'g-key' },
    )
    expect(out.content).toBe('gemini')
    expect(calls[0].url).toContain('/models/gemini-1.5-flash:generateContent')
    expect(calls[0].url).toContain('key=g-key')
    expect(calls[0].bodyParsed.system_instruction.parts[0].text).toBe('sys-1')
    expect(calls[0].bodyParsed.contents).toEqual([
      { role: 'user', parts: [{ text: 'hello' }] },
    ])
    expect(calls[0].bodyParsed.generationConfig.responseMimeType).toBe('application/json')
  })

  it('Gemini: maps assistant role to "model"', async () => {
    const { calls } = installFetch({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] })
    await geminiAdapter.chat(
      {
        model: 'gemini-1.5-flash',
        messages: [
          { role: 'user', content: 'q1' },
          { role: 'assistant', content: 'a1' },
          { role: 'user', content: 'q2' },
        ],
      },
      { apiKey: 'g' },
    )
    expect(calls[0].bodyParsed.contents.map((c: any) => c.role)).toEqual(['user', 'model', 'user'])
  })
})
