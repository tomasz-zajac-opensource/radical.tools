// ─── Provider registry ──────────────────────────────────────────────────────

import { claudeAdapter } from './providers/claude'
import { geminiAdapter } from './providers/gemini'
import { ollamaAdapter } from './providers/ollama'
import { openaiAdapter } from './providers/openai'
import type { AIProviderId, ProviderAdapter } from './types'

export const ADAPTERS: Record<AIProviderId, ProviderAdapter> = {
  ollama: ollamaAdapter,
  openai: openaiAdapter,
  anthropic: claudeAdapter,
  gemini: geminiAdapter,
}

export function getAdapter(id: AIProviderId): ProviderAdapter {
  const a = ADAPTERS[id]
  if (!a) throw new Error(`Unknown AI provider: ${id}`)
  return a
}

export function listAdapters(): ProviderAdapter[] {
  return Object.values(ADAPTERS)
}
