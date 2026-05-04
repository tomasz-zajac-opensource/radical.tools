// ─── OpenAI / ChatGPT provider ──────────────────────────────────────────────

import type { ChatRequest, ChatResponse, ProviderAdapter, ProviderConfig } from '../types'

const DEFAULT_BASE = 'https://api.openai.com/v1'

async function openaiChat(req: ChatRequest, cfg: ProviderConfig): Promise<ChatResponse> {
  if (!cfg.apiKey) throw new Error('OpenAI: API key is required')
  const base = (cfg.baseUrl || DEFAULT_BASE).replace(/\/+$/, '')
  const url = `${base}/chat/completions`
  const body: Record<string, unknown> = {
    model: req.model,
    messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
    temperature: req.temperature ?? 0.2,
    max_tokens: req.maxTokens ?? 2048,
  }
  if (req.jsonMode) body.response_format = { type: 'json_object' }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify(body),
    signal: req.signal,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`OpenAI HTTP ${res.status}: ${text || res.statusText}`)
  }
  const data = await res.json() as {
    model?: string
    choices?: Array<{ message?: { content?: string } }>
  }
  return {
    content: data?.choices?.[0]?.message?.content ?? '',
    model: data?.model,
  }
}

export const openaiAdapter: ProviderAdapter = {
  id: 'openai',
  label: 'OpenAI (ChatGPT)',
  defaultModel: 'gpt-4o-mini',
  defaultBaseUrl: DEFAULT_BASE,
  chat: openaiChat,
}
