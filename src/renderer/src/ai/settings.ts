// ─── AI settings persistence ────────────────────────────────────────────────
// Settings live in localStorage under a single key. Per the user's choice,
// API keys are stored client-side in plain text. This is an explicit trade-off
// in favour of the web build: no server, no Electron requirement.

import type { AIProviderId, AISettings, ProviderConfig } from './types'

export const AI_SETTINGS_KEY = 'radical-ai-settings'

const PROVIDER_IDS: AIProviderId[] = ['ollama', 'openai', 'anthropic', 'gemini']

const DEFAULT_MODELS: Record<AIProviderId, string> = {
  ollama: 'llama3.1',
  openai: 'gpt-4o-mini',
  anthropic: 'claude-3-5-sonnet-20241022',
  gemini: 'gemini-1.5-flash',
}

const DEFAULT_BASE_URLS: Record<AIProviderId, string> = {
  ollama: 'http://localhost:11434',
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta',
}

export function defaultProviderConfig(_id: AIProviderId): ProviderConfig {
  // Leave fields empty so the modal shows only placeholders. The runtime
  // (adapters) falls back to the per-provider defaults from AI_DEFAULTS
  // when the user hasn't overridden them. This keeps the localStorage
  // payload tiny and the UI honest about what is actually user-set.
  return {
    apiKey: '',
    baseUrl: '',
    model: '',
  }
}

export function defaultAISettings(): AISettings {
  const providers = {} as Record<AIProviderId, ProviderConfig>
  for (const id of PROVIDER_IDS) providers[id] = defaultProviderConfig(id)
  // Default active provider is OpenAI — a cloud provider with no key out of
  // the box. This keeps the AI agent hidden until the user explicitly
  // configures something (so we don't silently assume Ollama is running on
  // localhost). The user can switch to Ollama from the providers modal.
  // `enabled` defaults to false so the AI UI stays out of the way until the
  // user opts in via the explicit toggle.
  return { enabled: false, active: 'openai', providers }
}

export function normalizeAISettings(raw: unknown): AISettings {
  const base = defaultAISettings()
  if (!raw || typeof raw !== 'object') return base
  const r = raw as Partial<AISettings> & { providers?: Partial<Record<AIProviderId, ProviderConfig>> }
  const active = (PROVIDER_IDS as string[]).includes(r.active as string)
    ? (r.active as AIProviderId)
    : base.active
  const providers = { ...base.providers }
  for (const id of PROVIDER_IDS) {
    const p = r.providers?.[id]
    if (p && typeof p === 'object') {
      providers[id] = {
        apiKey: typeof p.apiKey === 'string' ? p.apiKey : '',
        baseUrl: typeof p.baseUrl === 'string' ? p.baseUrl : '',
        model: typeof p.model === 'string' ? p.model : '',
      }
    }
  }
  return { enabled: typeof r.enabled === 'boolean' ? r.enabled : base.enabled, active, providers }
}

interface MinimalStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

function getStorage(): MinimalStorage | null {
  try {
    const ls = (globalThis as { localStorage?: MinimalStorage }).localStorage
    return ls ?? null
  } catch {
    return null
  }
}

export function loadAISettings(storage?: MinimalStorage | null): AISettings {
  const ls = storage === undefined ? getStorage() : storage
  if (!ls) return defaultAISettings()
  try {
    const raw = ls.getItem(AI_SETTINGS_KEY)
    if (!raw) return defaultAISettings()
    return normalizeAISettings(JSON.parse(raw))
  } catch {
    return defaultAISettings()
  }
}

export function saveAISettings(settings: AISettings, storage?: MinimalStorage | null): void {
  const ls = storage === undefined ? getStorage() : storage
  if (!ls) return
  try {
    ls.setItem(AI_SETTINGS_KEY, JSON.stringify(settings))
  } catch {
    /* quota or similar — silently ignore */
  }
}

export const AI_DEFAULTS = { models: DEFAULT_MODELS, baseUrls: DEFAULT_BASE_URLS, providerIds: PROVIDER_IDS }
