import { describe, it, expect, beforeEach } from 'vitest'
import {
  AI_SETTINGS_KEY,
  defaultAISettings,
  loadAISettings,
  normalizeAISettings,
  saveAISettings,
} from '../src/renderer/src/ai/settings'

function makeStore(): {
  getItem: (k: string) => string | null
  setItem: (k: string, v: string) => void
  data: Record<string, string>
} {
  const data: Record<string, string> = {}
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = v },
  }
}

describe('aiSettings', () => {
  let store: ReturnType<typeof makeStore>
  beforeEach(() => { store = makeStore() })

  it('returns defaults when nothing is persisted', () => {
    const s = loadAISettings(store)
    expect(s.active).toBe('ollama')
    expect(s.providers.ollama.baseUrl).toBe('http://localhost:11434')
    expect(s.providers.openai.model).toMatch(/^gpt/)
    expect(s.providers.anthropic.model).toMatch(/^claude/)
    expect(s.providers.gemini.model).toMatch(/^gemini/)
  })

  it('round-trips via save/load', () => {
    const s = defaultAISettings()
    s.active = 'openai'
    s.providers.openai.apiKey = 'sk-test'
    s.providers.openai.model = 'gpt-4o'
    saveAISettings(s, store)
    expect(store.data[AI_SETTINGS_KEY]).toBeTypeOf('string')
    const loaded = loadAISettings(store)
    expect(loaded.active).toBe('openai')
    expect(loaded.providers.openai.apiKey).toBe('sk-test')
    expect(loaded.providers.openai.model).toBe('gpt-4o')
    // Other providers keep their defaults
    expect(loaded.providers.ollama.baseUrl).toBe('http://localhost:11434')
  })

  it('falls back to defaults on bogus active provider', () => {
    const s = normalizeAISettings({ active: 'nope', providers: {} })
    expect(s.active).toBe('ollama')
  })

  it('falls back to defaults on bogus provider config fields', () => {
    const s = normalizeAISettings({
      active: 'openai',
      providers: { openai: { apiKey: 123, baseUrl: '', model: null } },
    })
    expect(s.providers.openai.apiKey).toBe('')
    expect(s.providers.openai.baseUrl).toMatch(/^https:\/\//)
    expect(s.providers.openai.model).toBe('gpt-4o-mini')
  })

  it('survives malformed JSON in storage', () => {
    store.data[AI_SETTINGS_KEY] = '{not json'
    const s = loadAISettings(store)
    expect(s.active).toBe('ollama')
  })

  it('writes valid JSON that re-parses', () => {
    const s = defaultAISettings()
    saveAISettings(s, store)
    const parsed = JSON.parse(store.data[AI_SETTINGS_KEY])
    expect(parsed.providers.gemini.baseUrl).toBe('https://generativelanguage.googleapis.com/v1beta')
  })
})
