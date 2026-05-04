import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { loadAISettings, saveAISettings } from '../ai/settings'
import { listAdapters, getAdapter } from '../ai/registry'
import type { AIProviderId, AISettings } from '../ai/types'

interface Props {
  open: boolean
  onClose: () => void
}

type TestState = { status: 'idle' | 'busy' | 'ok' | 'err'; message?: string }

const PROVIDER_ICON: Record<AIProviderId, string> = {
  ollama: '🦙',
  openai: '⚡',
  anthropic: '◆',
  gemini: '✦',
}

const PROVIDER_BLURB: Record<AIProviderId, string> = {
  ollama: 'Local — runs on your machine, no API key required.',
  openai: 'GPT models. Get a key at platform.openai.com.',
  anthropic: 'Claude models. Get a key at console.anthropic.com.',
  gemini: 'Google Gemini. Get a key at aistudio.google.com.',
}

export function AISettingsModal({ open, onClose }: Props): React.ReactElement | null {
  const [settings, setSettings] = useState<AISettings>(() => loadAISettings())
  const [editing, setEditing] = useState<AIProviderId>(settings.active)
  const [showKey, setShowKey] = useState(false)
  const [test, setTest] = useState<TestState>({ status: 'idle' })
  const [savedFlash, setSavedFlash] = useState(false)
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Refresh from storage every time the modal opens.
  useEffect(() => {
    if (open) {
      const fresh = loadAISettings()
      setSettings(fresh)
      setEditing(fresh.active)
      setShowKey(false)
      setTest({ status: 'idle' })
    }
  }, [open])

  // Esc to close.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // Reset test result when switching tabs.
  useEffect(() => { setTest({ status: 'idle' }); setShowKey(false) }, [editing])

  const persist = useCallback((next: AISettings) => {
    setSettings(next)
    saveAISettings(next)
    window.dispatchEvent(new CustomEvent('radical:ai-settings-changed'))
    setSavedFlash(true)
    if (savedTimer.current) clearTimeout(savedTimer.current)
    savedTimer.current = setTimeout(() => setSavedFlash(false), 1200)
  }, [])

  const setActive = useCallback((id: AIProviderId) => {
    persist({ ...settings, active: id })
  }, [persist, settings])

  const updateConfig = useCallback((id: AIProviderId, patch: Partial<AISettings['providers'][AIProviderId]>) => {
    persist({
      ...settings,
      providers: { ...settings.providers, [id]: { ...settings.providers[id], ...patch } },
    })
  }, [persist, settings])

  const runTest = useCallback(async (): Promise<void> => {
    const adapter = getAdapter(editing)
    const cfg = settings.providers[editing]
    if (editing !== 'ollama' && !cfg.apiKey) {
      setTest({ status: 'err', message: 'API key required' })
      return
    }
    setTest({ status: 'busy' })
    try {
      const res = await adapter.chat({
        model: cfg.model || adapter.defaultModel,
        messages: [{ role: 'user', content: 'ping — reply with the single word: pong' }],
        maxTokens: 8,
        temperature: 0,
      }, cfg)
      const text = (res.content || '').trim().slice(0, 60)
      setTest({ status: 'ok', message: text ? `OK · ${text}` : 'OK' })
    } catch (err) {
      setTest({ status: 'err', message: (err as Error).message?.slice(0, 140) || 'Request failed' })
    }
  }, [editing, settings])

  if (!open) return null

  const adapter = getAdapter(editing)
  const cfg = settings.providers[editing]
  const isActive = settings.active === editing
  const needsKey = editing !== 'ollama'
  const canTest = !needsKey || !!cfg.apiKey

  return createPortal(
    <div
      className="milestone-modal-backdrop"
      onMouseDown={(e) => {
        // Only treat this as a backdrop click when the gesture both started
        // AND ended on the backdrop itself. Without this, selecting text
        // inside an input and releasing the mouse outside the modal box
        // (or any drag that crosses the boundary) would close the dialog.
        if (e.target !== e.currentTarget) return
        const start = e.currentTarget
        const onUp = (ev: MouseEvent): void => {
          window.removeEventListener('mouseup', onUp, true)
          if (ev.target === start) onClose()
        }
        window.addEventListener('mouseup', onUp, true)
      }}
    >
      <div
        className="milestone-modal ai-settings-modal"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="AI provider settings"
      >
        <button
          type="button"
          className="ai-settings-close"
          onClick={onClose}
          aria-label="Close"
          title="Close (Esc)"
        >
          ✕
        </button>
        <h3 className="milestone-modal-title">AI providers</h3>
        <p className="milestone-modal-text" style={{ marginBottom: 4 }}>
          Configure connections to AI providers. Settings are stored in this browser&apos;s
          localStorage — do not use shared machines for sensitive keys.
        </p>

        <div className="ai-enable-row">
          <label className="ai-enable-toggle" title="Show or hide all AI features in the UI">
            <input
              type="checkbox"
              checked={settings.enabled}
              onChange={(e) => persist({ ...settings, enabled: e.target.checked })}
            />
            <span className="ai-enable-switch" aria-hidden />
            <span className="ai-enable-label">
              {settings.enabled ? 'AI features enabled' : 'AI features disabled'}
            </span>
          </label>
          <span className="ai-enable-hint">
            {settings.enabled
              ? 'Quick Search shows the ✨ AI mode and ⌘+↵ shortcut.'
              : 'Turn on to surface AI in Quick Search and elsewhere.'}
          </span>
        </div>

        <div className="ai-settings-tabs" role="tablist">
          {listAdapters().map((a) => {
            const tabActive = settings.active === a.id
            return (
              <button
                key={a.id}
                role="tab"
                aria-selected={editing === a.id}
                className={`ai-settings-tab${editing === a.id ? ' editing' : ''}`}
                onClick={() => setEditing(a.id)}
                title={tabActive ? 'Active provider' : `Edit ${a.label}`}
              >
                <span aria-hidden>{PROVIDER_ICON[a.id]}</span>
                <span>{a.label}</span>
                {tabActive && <span className="ai-settings-tab-active-dot" aria-label="active" />}
              </button>
            )
          })}
        </div>

        <div className="ai-settings-section">
          <div className="ai-settings-help" style={{ marginBottom: 2 }}>{PROVIDER_BLURB[editing]}</div>

          <div className="ai-settings-row">
            <label htmlFor="ai-model">Model</label>
            <div className="ai-settings-input-wrap">
              <input
                id="ai-model"
                value={cfg.model || ''}
                placeholder={adapter.defaultModel}
                onChange={(e) => updateConfig(editing, { model: e.target.value })}
                autoComplete="off"
                spellCheck={false}
              />
            </div>
          </div>

          <div className="ai-settings-row">
            <label htmlFor="ai-baseurl">Base URL <span style={{ opacity: 0.6 }}>(optional)</span></label>
            <div className="ai-settings-input-wrap">
              <input
                id="ai-baseurl"
                value={cfg.baseUrl || ''}
                placeholder={adapter.defaultBaseUrl}
                onChange={(e) => updateConfig(editing, { baseUrl: e.target.value })}
                autoComplete="off"
                spellCheck={false}
              />
            </div>
          </div>

          {needsKey && (
            <div className="ai-settings-row">
              <label htmlFor="ai-key">API key</label>
              <div className="ai-settings-input-wrap">
                <input
                  id="ai-key"
                  type={showKey ? 'text' : 'password'}
                  value={cfg.apiKey || ''}
                  onChange={(e) => updateConfig(editing, { apiKey: e.target.value })}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={`Paste your ${adapter.label} API key…`}
                />
                <button
                  type="button"
                  className="ai-settings-eye"
                  onClick={() => setShowKey((v) => !v)}
                  title={showKey ? 'Hide key' : 'Show key'}
                  aria-label={showKey ? 'Hide API key' : 'Show API key'}
                >
                  {showKey ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>
          )}

          {editing === 'ollama' && (
            <div className="ai-settings-help">
              For browser use, start Ollama with <code>OLLAMA_ORIGINS=*</code> so it
              accepts cross-origin requests:
              <pre>OLLAMA_ORIGINS=&apos;*&apos; ollama serve</pre>
              Then pull a model, e.g. <code>ollama pull llama3.1</code>.
            </div>
          )}

          <div className="ai-settings-actions">
            <button
              type="button"
              className="milestone-btn"
              onClick={runTest}
              disabled={!canTest || test.status === 'busy'}
              title={canTest ? 'Send a tiny ping to verify the connection' : 'Set an API key first'}
            >
              {test.status === 'busy' ? 'Testing…' : 'Test connection'}
            </button>
            {test.status === 'busy' && <span className="ai-test-result busy">connecting…</span>}
            {test.status === 'ok' && <span className="ai-test-result ok">✓ {test.message}</span>}
            {test.status === 'err' && <span className="ai-test-result err">✕ {test.message}</span>}
          </div>
        </div>

        <div className="ai-settings-footer">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {isActive ? (
              <span className="ai-active-badge" title="Currently used by the AI agent">
                ● Active
              </span>
            ) : (
              <button
                type="button"
                className="ai-set-default-btn"
                onClick={() => setActive(editing)}
                title={`Use ${adapter.label} as the active AI provider`}
              >
                Set as active
              </button>
            )}
            {savedFlash && <span className="ai-settings-saved">saved</span>}
          </div>
          <button
            className="milestone-btn primary"
            onClick={onClose}
          >
            Done
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

/** Helper to open the modal from anywhere (e.g. from QuickSearch). */
export function openAISettings(): void {
  window.dispatchEvent(new CustomEvent('radical:open-ai-settings'))
}
