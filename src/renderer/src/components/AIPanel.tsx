import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useDiagramStore } from '../store/diagramStore'
import { runAIPrompt } from '../ai/runner'
import { loadAISettings, saveAISettings } from '../ai/settings'
import { listAdapters, getAdapter } from '../ai/registry'
import type { AIProviderId, AISettings, ChatMessage } from '../ai/types'
import type { ApplyReport } from '../ai/applyPatch'

interface ChatItem {
  id: string
  role: 'user' | 'assistant'
  text: string
  /** Optional report attached to assistant turns. */
  report?: ApplyReport
  error?: string
}

let _seq = 0
const nextId = () => `m${++_seq}-${Date.now().toString(36)}`

export function AIPanel(): React.ReactElement {
  const [settings, setSettings] = useState<AISettings>(() => loadAISettings())
  const [showSettings, setShowSettings] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [busy, setBusy] = useState(false)
  const [items, setItems] = useState<ChatItem[]>([])
  const abortRef = useRef<AbortController | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)

  // Diagram facade — re-read fresh from the store on every call.
  const diagram = useMemo(() => ({
    getNodes: () => useDiagramStore.getState().c4Nodes,
    getRelations: () => useDiagramStore.getState().c4Relations,
    addNode: (n: Parameters<ReturnType<typeof useDiagramStore.getState>['addNode']>[0]) =>
      useDiagramStore.getState().addNode(n),
    updateNode: (id: string, u: Parameters<ReturnType<typeof useDiagramStore.getState>['updateNode']>[1]) =>
      useDiagramStore.getState().updateNode(id, u),
    removeNode: (id: string) => useDiagramStore.getState().removeNode(id),
    addRelation: (r: Parameters<ReturnType<typeof useDiagramStore.getState>['addRelation']>[0]) =>
      useDiagramStore.getState().addRelation(r),
    updateRelation: (id: string, u: Parameters<ReturnType<typeof useDiagramStore.getState>['updateRelation']>[1]) =>
      useDiagramStore.getState().updateRelation(id, u),
    removeRelation: (id: string) => useDiagramStore.getState().removeRelation(id),
  }), [])

  // Auto-scroll on new messages.
  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight
  }, [items])

  const updateProvider = useCallback((next: Partial<AISettings>) => {
    setSettings((prev) => {
      const merged: AISettings = { ...prev, ...next, providers: { ...prev.providers, ...(next.providers || {}) } }
      saveAISettings(merged)
      return merged
    })
  }, [])

  const updateProviderConfig = useCallback((id: AIProviderId, patch: Partial<AISettings['providers'][AIProviderId]>) => {
    setSettings((prev) => {
      const merged: AISettings = {
        ...prev,
        providers: { ...prev.providers, [id]: { ...prev.providers[id], ...patch } },
      }
      saveAISettings(merged)
      return merged
    })
  }, [])

  const send = useCallback(async () => {
    const text = prompt.trim()
    if (!text || busy) return
    setPrompt('')
    setBusy(true)
    const history: ChatMessage[] = items.map((it) => ({ role: it.role, content: it.text }))
    const userItem: ChatItem = { id: nextId(), role: 'user', text }
    setItems((prev) => [...prev, userItem])

    const ctl = new AbortController()
    abortRef.current = ctl

    try {
      const result = await runAIPrompt({ prompt: text, settings, diagram, history, signal: ctl.signal })
      setItems((prev) => [
        ...prev,
        {
          id: nextId(),
          role: 'assistant',
          text: result.summary || 'Done.',
          report: result.report,
        },
      ])
    } catch (err) {
      const msg = (err as Error).message || String(err)
      setItems((prev) => [...prev, { id: nextId(), role: 'assistant', text: '', error: msg }])
    } finally {
      abortRef.current = null
      setBusy(false)
    }
  }, [prompt, busy, settings, diagram, items])

  const cancel = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  const adapter = getAdapter(settings.active)
  const cfg = settings.providers[settings.active]
  const needsKey = settings.active !== 'ollama' && !cfg.apiKey

  return (
    <div className="ai-panel" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <select
          value={settings.active}
          onChange={(e) => updateProvider({ active: e.target.value as AIProviderId })}
          style={{ flex: 1, fontSize: 11 }}
          aria-label="AI provider"
        >
          {listAdapters().map((a) => (
            <option key={a.id} value={a.id}>{a.label}</option>
          ))}
        </select>
        <button
          className="lp-button"
          style={{ fontSize: 11 }}
          onClick={() => setShowSettings((s) => !s)}
          title="Provider settings"
          aria-label="Provider settings"
        >
          {showSettings ? 'Done' : '⚙'}
        </button>
      </div>

      {showSettings && (
        <div
          style={{
            display: 'flex', flexDirection: 'column', gap: 4, padding: 6,
            background: 'var(--accent-soft)', borderRadius: 4, fontSize: 11,
          }}
        >
          <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ color: 'var(--text-muted)' }}>Model</span>
            <input
              value={cfg.model || ''}
              placeholder={adapter.defaultModel}
              onChange={(e) => updateProviderConfig(settings.active, { model: e.target.value })}
              style={{ fontSize: 11 }}
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ color: 'var(--text-muted)' }}>Base URL</span>
            <input
              value={cfg.baseUrl || ''}
              placeholder={adapter.defaultBaseUrl}
              onChange={(e) => updateProviderConfig(settings.active, { baseUrl: e.target.value })}
              style={{ fontSize: 11 }}
            />
          </label>
          {settings.active !== 'ollama' && (
            <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ color: 'var(--text-muted)' }}>API key</span>
              <input
                type="password"
                value={cfg.apiKey || ''}
                onChange={(e) => updateProviderConfig(settings.active, { apiKey: e.target.value })}
                style={{ fontSize: 11 }}
                autoComplete="off"
              />
              <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>
                Stored in this browser's localStorage (plain text).
              </span>
            </label>
          )}
          {settings.active === 'ollama' && (
            <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>
              For browser use, start Ollama with <code>OLLAMA_ORIGINS=*</code>.
            </span>
          )}
        </div>
      )}

      <div
        ref={listRef}
        className="ai-chat"
        style={{
          maxHeight: 240, minHeight: 60, overflowY: 'auto',
          display: 'flex', flexDirection: 'column', gap: 6,
          padding: 4, background: 'var(--bg-canvas)', borderRadius: 4, fontSize: 11,
        }}
      >
        {items.length === 0 && (
          <div style={{ color: 'var(--text-muted)', padding: 6, fontStyle: 'italic' }}>
            Describe what to add, e.g. <em>"Add a web app called Storefront with a Postgres database; the storefront uses the database via JDBC."</em>
          </div>
        )}
        {items.map((it) => (
          <div
            key={it.id}
            style={{
              alignSelf: it.role === 'user' ? 'flex-end' : 'flex-start',
              maxWidth: '92%',
              background: it.role === 'user' ? 'var(--accent-soft)' : 'var(--bg-panel)',
              color: 'var(--text-primary)',
              padding: '4px 8px', borderRadius: 6,
              border: it.error ? '1px solid #d04444' : undefined,
              whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            }}
          >
            {it.error ? (
              <span style={{ color: '#ff7777' }}>Error: {it.error}</span>
            ) : (
              <>
                <div>{it.text}</div>
                {it.report && (
                  <ReportLine report={it.report} />
                )}
              </>
            )}
          </div>
        ))}
        {busy && (
          <div style={{ color: 'var(--text-muted)', padding: 6 }}>
            Thinking… <button className="lp-button" style={{ fontSize: 10, marginLeft: 6 }} onClick={cancel}>Cancel</button>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 4 }}>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              void send()
            }
          }}
          placeholder={needsKey ? 'Set an API key in ⚙ first…' : 'Describe a change… (Cmd/Ctrl+Enter to send)'}
          rows={2}
          disabled={busy}
          style={{ flex: 1, fontSize: 11, resize: 'vertical', minHeight: 36 }}
        />
        <button
          className="lp-button"
          onClick={() => void send()}
          disabled={busy || !prompt.trim() || needsKey}
          style={{ alignSelf: 'flex-end', fontSize: 11 }}
        >
          Send
        </button>
      </div>
    </div>
  )
}

function ReportLine({ report }: { report: ApplyReport }): React.ReactElement {
  const parts: string[] = []
  if (report.added.nodes) parts.push(`+${report.added.nodes} node${report.added.nodes === 1 ? '' : 's'}`)
  if (report.added.relations) parts.push(`+${report.added.relations} relation${report.added.relations === 1 ? '' : 's'}`)
  if (report.updated.nodes) parts.push(`~${report.updated.nodes} updated`)
  if (report.deleted.nodes) parts.push(`−${report.deleted.nodes} node${report.deleted.nodes === 1 ? '' : 's'}`)
  if (report.deleted.relations) parts.push(`−${report.deleted.relations} relation${report.deleted.relations === 1 ? '' : 's'}`)
  return (
    <div style={{ marginTop: 4, fontSize: 10, color: 'var(--text-muted)' }}>
      {parts.length ? parts.join(' · ') : 'No changes'}
      {report.errors.length > 0 && (
        <div style={{ color: '#ff8888', marginTop: 2 }}>
          {report.errors.map((e, i) => <div key={i}>⚠ {e}</div>)}
        </div>
      )}
    </div>
  )
}
