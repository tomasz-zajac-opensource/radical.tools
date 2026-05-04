// ─── Anthropic Claude provider ──────────────────────────────────────────────
// The Messages API takes the system prompt as a top-level field and excludes
// it from `messages`. The header `anthropic-dangerous-direct-browser-access`
// is required when calling from a browser with a user-provided key.

import type { ChatMessage, ChatRequest, ChatResponse, ProviderAdapter, ProviderConfig } from '../types'

const DEFAULT_BASE = 'https://api.anthropic.com/v1'
const ANTHROPIC_VERSION = '2023-06-01'

function splitSystem(messages: ChatMessage[]): { system: string; rest: ChatMessage[] } {
  const systems: string[] = []
  const rest: ChatMessage[] = []
  for (const m of messages) {
    if (m.role === 'system') systems.push(m.content)
    else rest.push(m)
  }
  return { system: systems.join('\n\n'), rest }
}

async function claudeChat(req: ChatRequest, cfg: ProviderConfig): Promise<ChatResponse> {
  if (!cfg.apiKey) throw new Error('Anthropic: API key is required')
  const base = (cfg.baseUrl || DEFAULT_BASE).replace(/\/+$/, '')
  const url = `${base}/messages`
  const { system, rest } = splitSystem(req.messages)
  const body: Record<string, unknown> = {
    model: req.model,
    max_tokens: req.maxTokens ?? 2048,
    temperature: req.temperature ?? 0.2,
    messages: rest.map((m) => ({ role: m.role, content: m.content })),
  }
  if (system) body.system = system

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': cfg.apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify(body),
    signal: req.signal,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Anthropic HTTP ${res.status}: ${text || res.statusText}`)
  }
  const data = await res.json() as {
    model?: string
    content?: Array<{ type?: string; text?: string }>
  }
  const content = (data?.content ?? [])
    .filter((c) => c?.type === 'text' && typeof c.text === 'string')
    .map((c) => c.text!)
    .join('')
  return { content, model: data?.model }
}

export const claudeAdapter: ProviderAdapter = {
  id: 'anthropic',
  label: 'Anthropic (Claude)',
  defaultModel: 'claude-3-5-sonnet-20241022',
  defaultBaseUrl: DEFAULT_BASE,
  chat: claudeChat,
}
