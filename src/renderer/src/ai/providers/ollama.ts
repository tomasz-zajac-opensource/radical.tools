// ─── Ollama provider (local, no key needed) ─────────────────────────────────
// Uses /api/chat with stream:false. Ollama must be running with OLLAMA_ORIGINS
// set so the browser can talk to it from radical.tools (or localhost during dev).

import type { ChatRequest, ChatResponse, ProviderAdapter, ProviderConfig } from '../types'

const DEFAULT_BASE = 'http://localhost:11434'

async function ollamaChat(req: ChatRequest, cfg: ProviderConfig): Promise<ChatResponse> {
  const base = (cfg.baseUrl || DEFAULT_BASE).replace(/\/+$/, '')
  const url = `${base}/api/chat`
  const body = {
    model: req.model,
    messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
    stream: false,
    format: req.jsonMode ? 'json' : undefined,
    options: {
      temperature: req.temperature ?? 0.2,
      num_predict: req.maxTokens ?? 2048,
    },
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: req.signal,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Ollama HTTP ${res.status}: ${text || res.statusText}`)
  }
  const data = await res.json() as { message?: { content?: string }; model?: string }
  return {
    content: data?.message?.content ?? '',
    model: data?.model,
  }
}

export const ollamaAdapter: ProviderAdapter = {
  id: 'ollama',
  label: 'Ollama (local)',
  defaultModel: 'llama3.1',
  defaultBaseUrl: DEFAULT_BASE,
  chat: ollamaChat,
}
