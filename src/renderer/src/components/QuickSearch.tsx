import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useDiagramStore } from '../store/diagramStore'
import { useOutsideClick } from '../hooks/useOutsideClick'
import { runAIPrompt } from '../ai/runner'
import { loadAISettings } from '../ai/settings'
import { getAdapter, listAdapters } from '../ai/registry'
import { openAISettings } from './AISettingsModal'
import type { AISettings, ChatMessage } from '../ai/types'
import type { ApplyReport } from '../ai/applyPatch'

/**
 * Cmd/Ctrl+P quick-search palette.
 *
 * Searches every node label/description/type and every relation label across
 * the current model. Picking a result selects it (and pans + zooms onto a
 * node hit, so the user can find "Payment Service" in a 60-node diagram in
 * one keystroke).
 *
 * Lives outside the canvas so it is always reachable, no matter which mode
 * (designer / viewer / presenter) the user is in.
 */
export function QuickSearch(): React.ReactElement | null {
  const c4Nodes = useDiagramStore((s) => s.c4Nodes)
  const c4Relations = useDiagramStore((s) => s.c4Relations)
  const views = useDiagramStore((s) => s.views)
  const activeViewId = useDiagramStore((s) => s.activeViewId)
  const setActiveView = useDiagramStore((s) => s.setActiveView)
  const toggleCollapse = useDiagramStore((s) => s.toggleCollapse)
  const selectNode = useDiagramStore((s) => s.selectNode)
  const selectEdge = useDiagramStore((s) => s.selectEdge)
  const setSelectedNodeIds = useDiagramStore((s) => s.setSelectedNodeIds)
  const presentationActive = useDiagramStore((s) => s.presentationActive)

  const [q, setQ] = useState('')
  const [hover, setHover] = useState(0)
  const [focused, setFocused] = useState(false)
  const [aiMode, setAiMode] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)

  // ── AI agent state ──────────────────────────────────────────────────────
  const [aiSettings, setAiSettings] = useState<AISettings>(() => loadAISettings())
  const [aiBusy, setAiBusy] = useState(false)
  const [aiHistory, setAiHistory] = useState<ChatMessage[]>([])
  const [aiLast, setAiLast] = useState<{ text: string; report?: ApplyReport; error?: string; retries?: number } | null>(null)
  const aiAbortRef = useRef<AbortController | null>(null)

  // Keep AI settings fresh when the user updates them in the modal.
  useEffect(() => {
    const refresh = (): void => setAiSettings(loadAISettings())
    window.addEventListener('storage', refresh)
    window.addEventListener('radical:ai-settings-changed', refresh as EventListener)
    return () => {
      window.removeEventListener('storage', refresh)
      window.removeEventListener('radical:ai-settings-changed', refresh as EventListener)
    }
  }, [])

  // Diagram facade — read fresh from the store on every call so the AI sees
  // the latest state even mid-session.
  const aiDiagram = useMemo(() => ({
    getNodes: () => useDiagramStore.getState().c4Nodes,
    getRelations: () => useDiagramStore.getState().c4Relations,
    getMetamodel: () => useDiagramStore.getState().metamodel,
    getActiveView: () => {
      const s = useDiagramStore.getState()
      if (!s.activeViewId) return null
      const v = s.views[s.activeViewId]
      if (!v) return null
      return { id: v.id, name: v.name, nodeIds: v.nodeIds }
    },
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
    // ── views ──
    getViews: () => useDiagramStore.getState().views,
    addView: (name: string) => useDiagramStore.getState().addView(name),
    setViewNodes: (viewId: string, nodeIds: string[]) =>
      useDiagramStore.getState().setViewNodes(viewId, nodeIds),
    removeView: (id: string) => useDiagramStore.getState().removeView(id),
    setActiveView: (id: string | null) => useDiagramStore.getState().setActiveView(id),
    // ── diagram-level ──
    clearDiagram: () => {
      const s = useDiagramStore.getState()
      s.loadDiagram({
        nodes: [],
        relations: [],
        views: [],
        defaultPositions: {},
        defaultViewport: null,
        snapshots: [],
        presentations: [],
        metamodel: s.metamodel,
      })
    },
  }), [])

  const aiAdapterCfg = aiSettings.providers[aiSettings.active]
  const aiAdapter = getAdapter(aiSettings.active)
  const aiNeedsKey = aiSettings.active !== 'ollama' && !aiAdapterCfg.apiKey
  // The AI agent is only "available" when the user has explicitly enabled
  // the AI feature in settings AND the active provider has the credentials
  // it needs (Ollama: always; cloud providers: API key set). When
  // unavailable we hide every AI-related affordance from the search bar —
  // configuration lives in the logo menu (“AI providers…”).
  const aiConfigured = aiSettings.enabled && !aiNeedsKey
  const aiProviderLabel = listAdapters().find((a) => a.id === aiSettings.active)?.label ?? aiSettings.active
  const aiModelLabel = aiAdapterCfg.model || aiAdapter.defaultModel

  // If the user clears the API key while in AI mode, snap back to search.
  useEffect(() => {
    if (!aiConfigured && aiMode) setAiMode(false)
  }, [aiConfigured, aiMode])

  const runAI = useCallback(async (text: string): Promise<void> => {
    const prompt = text.trim()
    if (!prompt || aiBusy) return
    if (aiNeedsKey) {
      setAiLast({ text: '', error: `Set an API key for ${aiProviderLabel} first (“Configure…” in the ✨ menu).` })
      return
    }
    setAiBusy(true)
    setAiLast(null)
    const ctl = new AbortController()
    aiAbortRef.current = ctl
    const userTurn: ChatMessage = { role: 'user', content: prompt }
    try {
      const result = await runAIPrompt({
        prompt,
        settings: aiSettings,
        diagram: aiDiagram,
        history: aiHistory,
        signal: ctl.signal,
      })
      setAiHistory((h) => [...h, userTurn, { role: 'assistant', content: result.summary || 'Done.' }])
      setAiLast({ text: result.summary || 'Done.', report: result.report, retries: result.retries })
      // Clear the input after a successful run so the next prompt starts fresh.
      setQ('')
      // If the AI issued a focus_node op, animate the camera to that node.
      const focusId = result.report.focusNodeId
      if (focusId) {
        // Slight delay so the canvas has re-rendered after any view / node changes.
        setTimeout(() => {
          const focus = (window as unknown as { __rfFocusNode?: (id: string, opts?: { zoom?: number; duration?: number }) => void }).__rfFocusNode
          focus?.(focusId, { zoom: 1.2, duration: 600 })
        }, 120)
      }
    } catch (err) {
      const msg = (err as Error).message || String(err)
      setAiLast({ text: '', error: msg })
    } finally {
      aiAbortRef.current = null
      setAiBusy(false)
    }
  }, [aiBusy, aiNeedsKey, aiProviderLabel, aiSettings, aiDiagram, aiHistory])

  const cancelAI = useCallback((): void => {
    aiAbortRef.current?.abort()
  }, [])

  // Cmd/Ctrl+P focuses the always-visible search input. Esc clears it and
  // blurs back to the canvas. Disabled during a live presentation — the
  // host browser already binds Cmd+P to "print".
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (presentationActive) return
      const isMac = navigator.platform.toLowerCase().includes('mac')
      const mod = isMac ? e.metaKey : e.ctrlKey
      if (mod && (e.key === 'p' || e.key === 'P')) {
        e.preventDefault()
        inputRef.current?.focus()
        inputRef.current?.select()
      } else if (e.key === 'Escape' && document.activeElement === inputRef.current) {
        e.preventDefault()
        setQ('')
        inputRef.current?.blur()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [presentationActive])

  // Expose a global hook so the toolbar (and other UI) can focus the search
  // input without reaching into this component's local state.
  useEffect(() => {
    ;(window as unknown as { __radicalOpenQuickSearch?: () => void }).__radicalOpenQuickSearch = () => {
      if (presentationActive) return
      inputRef.current?.focus()
      inputRef.current?.select()
    }
    return () => {
      delete (window as unknown as { __radicalOpenQuickSearch?: () => void }).__radicalOpenQuickSearch
    }
  }, [presentationActive])

  // Close the dropdown when clicking outside the search bar — but stay
  // mounted so the input remains visible. Also blur the native input so
  // the focus ring goes away (the dropdown was the only "open" UI). Also
  // exits AI mode and dismisses any lingering AI banner so the next click
  // outside fully resets the palette.
  const closeDropdown = useCallback(() => {
    setFocused(false)
    setAiMode(false)
    setAiLast(null)
    if (inputRef.current && document.activeElement === inputRef.current) {
      inputRef.current.blur()
    }
  }, [])
  // Hook needs to fire whenever any "open" state is true — otherwise an
  // outside click in AI mode (where focused may already be false) won't be
  // detected and the dropdown stays open.
  useOutsideClick([wrapRef], focused || aiMode || !!aiLast, closeDropdown)

  const pathOf = (id: string): string => {
    const segs: string[] = []
    let cur = c4Nodes[id]
    const seen = new Set<string>()
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id)
      segs.unshift(cur.label || cur.type)
      cur = cur.parentId ? c4Nodes[cur.parentId] : (undefined as unknown as typeof cur)
    }
    return segs.join(' / ')
  }

  // For each view, compute the effective set of node IDs that are visible
  // in it (explicit nodeIds + all their ancestors). Mirrors the store's
  // computeViewNodeSet so we can answer "which views contain node X?" and
  // pick a sensible fallback view when jumping to a node that isn't in the
  // currently-active one.
  const viewNodeSets = useMemo<Record<string, Set<string>>>(() => {
    const out: Record<string, Set<string>> = {}
    for (const v of Object.values(views)) {
      const set = new Set<string>()
      for (const id of v.nodeIds) {
        let cur: string | undefined = id
        while (cur && c4Nodes[cur]) {
          set.add(cur)
          cur = c4Nodes[cur].parentId ?? undefined
        }
      }
      out[v.id] = set
    }
    return out
  }, [views, c4Nodes])

  // Pick a stable view to switch into when the user jumps to a node that
  // isn't visible in the active view. Prefers (in order): the active view
  // if it already contains the node, the smallest view containing it
  // (most focused), else any view, else null (means "no view filter").
  const pickViewForNode = (nodeId: string): string | null => {
    if (activeViewId && viewNodeSets[activeViewId]?.has(nodeId)) return activeViewId
    let best: { id: string; size: number } | null = null
    for (const [vid, set] of Object.entries(viewNodeSets)) {
      if (!set.has(nodeId)) continue
      if (!best || set.size < best.size) best = { id: vid, size: set.size }
    }
    return best?.id ?? null
  }

  type Result =
    | { kind: 'node'; id: string; label: string; sub: string; viewIds: string[]; score: number }
    | { kind: 'edge'; id: string; label: string; sub: string; viewIds: string[]; score: number }
    | { kind: 'view'; id: string; label: string; sub: string; score: number }

  const results = useMemo<Result[]>(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return []

    const score = (haystack: string): number => {
      const lower = haystack.toLowerCase()
      const idx = lower.indexOf(needle)
      if (idx === -1) return 0
      // Prefer prefix matches and shorter strings.
      let s = 1000 - idx * 10
      if (idx === 0) s += 500
      s -= Math.max(0, haystack.length - needle.length)
      return s
    }

    const out: Result[] = []
    // When a view is active, give nodes/edges that already live in it a
    // small score boost so they surface first. Results outside the active
    // view still appear (search is always over the full model) — they just
    // sort below in-view matches.
    const inViewBoost = activeViewId ? 200 : 0
    const activeViewSet = activeViewId ? viewNodeSets[activeViewId] : undefined
    for (const n of Object.values(c4Nodes)) {
      const label = n.label || n.type
      const candidates = [label, n.description ?? '', n.type, n.technology ?? '']
      const best = Math.max(...candidates.map(score))
      if (best > 0) {
        const inViews: string[] = []
        for (const [vid, set] of Object.entries(viewNodeSets)) {
          if (set.has(n.id)) inViews.push(vid)
        }
        const inActive = !!activeViewSet?.has(n.id)
        out.push({
          kind: 'node',
          id: n.id,
          label,
          sub: pathOf(n.id),
          viewIds: inViews,
          score: best + (inActive ? inViewBoost : 0),
        })
      }
    }
    for (const r of Object.values(c4Relations)) {
      const src = c4Nodes[r.sourceId]
      const tgt = c4Nodes[r.targetId]
      if (!src || !tgt) continue
      const label = r.label || `${src.label} → ${tgt.label}`
      const candidates = [r.label ?? '', src.label, tgt.label]
      const best = Math.max(...candidates.map(score))
      if (best > 0) {
        const inActive = activeViewSet
          ? activeViewSet.has(r.sourceId) && activeViewSet.has(r.targetId)
          : false
        // A relation is "in" a view when both endpoints are in that view.
        const inViews: string[] = []
        for (const [vid, set] of Object.entries(viewNodeSets)) {
          if (set.has(r.sourceId) && set.has(r.targetId)) inViews.push(vid)
        }
        out.push({
          kind: 'edge',
          id: r.id,
          label,
          sub: `${src.label} → ${tgt.label}`,
          viewIds: inViews,
          score: best + (inActive ? inViewBoost : 0),
        })
      }
    }
    for (const v of Object.values(views)) {
      const best = score(v.name)
      if (best > 0) {
        const set = viewNodeSets[v.id]
        const count = set ? set.size : v.nodeIds.length
        out.push({
          kind: 'view',
          id: v.id,
          label: v.name,
          sub: `View · ${count} node${count === 1 ? '' : 's'}`,
          // Bias views slightly above raw nodes/edges of the same score so
          // typing a view name surfaces the view itself first.
          score: best + 50,
        })
      }
    }
    out.sort((a, b) => b.score - a.score)
    return out.slice(0, 30)
    // pathOf intentionally omitted — recomputed cheaply each render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, c4Nodes, c4Relations, views, viewNodeSets, activeViewId])

  // Reset hover when the result list shape changes.
  useEffect(() => { setHover(0) }, [q])

  // The bar itself is always mounted (so it stays in the top toolbar
  // permanently); the dropdown is the only thing that opens/closes.
  if (presentationActive) return null

  // Walk the parent chain from outermost ancestor downward to the target's
  // direct parent and expand any that are currently collapsed. Outermost
  // first so each toggleCollapse call's auto-fit math runs against an
  // already-expanded outer container.
  const expandAncestors = (nodeId: string): void => {
    const chain: string[] = []
    let cur: string | undefined = c4Nodes[nodeId]?.parentId
    const seen = new Set<string>()
    while (cur && !seen.has(cur)) {
      seen.add(cur)
      chain.push(cur)
      cur = c4Nodes[cur]?.parentId
    }
    chain.reverse()
    for (const id of chain) {
      if (c4Nodes[id]?.collapsed) toggleCollapse(id)
    }
  }

  // `viewOverride` lets the caller decide where to open the result:
  //   undefined  → smart pick (current view if it has the node, else any view containing it)
  //   null       → open in "all nodes" mode (no active view filter)
  //   string     → open in that specific view id
  const pickResult = (r: Result, viewOverride?: string | null): void => {
    setFocused(false)
    setQ('')
    inputRef.current?.blur()
    // Make sure the right-side properties panel is visible so the user can
    // see the freshly-selected object's details immediately after jumping.
    const expandRight = (window as unknown as { __radicalExpandRightPanel?: () => void }).__radicalExpandRightPanel
    expandRight?.()
    if (r.kind === 'view') {
      // Just switch the view; no node selection.
      setActiveView(r.id)
      return
    }
    if (r.kind === 'node') {
      // The same node can be present in many views. If the active view does
      // not show this node, jump to a view that does — otherwise the canvas
      // would not paint the selection ring and pan would do nothing useful.
      const targetView = viewOverride === undefined ? pickViewForNode(r.id) : viewOverride
      const needSwitch = targetView !== activeViewId
      if (needSwitch) setActiveView(targetView)
      // After a view switch React Flow re-renders nodes; defer selection +
      // pan until that settles, otherwise __rfFocusNode can't find the node.
      const apply = (): void => {
        // Expand every collapsed ancestor — otherwise the target node lives
        // inside a folded parent and React Flow can neither show it nor pan
        // to it. Walk from outermost to innermost so each toggle's auto-fit
        // works on already-expanded outer levels.
        expandAncestors(r.id)
        setSelectedNodeIds([r.id])
        selectNode(r.id)
        requestAnimationFrame(() => {
          const focus = (window as unknown as { __rfFocusNode?: (id: string, opts?: { zoom?: number; duration?: number }) => void }).__rfFocusNode
          focus?.(r.id, { zoom: 1.2, duration: 500 })
        })
      }
      if (needSwitch) setTimeout(apply, 80)
      else requestAnimationFrame(apply)
    } else {
      // Edge: try to switch into a view that contains the source endpoint
      // (the target should normally be co-visible since relations only
      // render when both endpoints exist in the view).
      const rel = c4Relations[r.id]
      if (rel) {
        const targetView = viewOverride === undefined ? pickViewForNode(rel.sourceId) : viewOverride
        const needSwitch = targetView !== activeViewId
        if (needSwitch) setActiveView(targetView)
        const apply = (): void => {
          // Both endpoints need to be visible — expand collapsed ancestors
          // on either side before centring the camera.
          expandAncestors(rel.sourceId)
          expandAncestors(rel.targetId)
          selectEdge(r.id)
          requestAnimationFrame(() => {
            const focus = (window as unknown as { __rfFocusNode?: (id: string, opts?: { zoom?: number; duration?: number }) => void }).__rfFocusNode
            focus?.(rel.sourceId, { zoom: 1.0, duration: 500 })
          })
        }
        if (needSwitch) setTimeout(apply, 80)
        else requestAnimationFrame(apply)
      } else {
        selectEdge(r.id)
      }
    }
  }

  const onInputKey = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHover((h) => Math.min(h + 1, Math.max(0, results.length - 1)))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHover((h) => Math.max(0, h - 1))
    } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      // Cmd/Ctrl+Enter → always send to AI agent (when configured).
      e.preventDefault()
      if (aiConfigured) void runAI(q)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      // In AI mode plain Enter asks the AI; otherwise it picks the highlighted
      // search result (and falls back to AI when there are no search hits).
      if (aiMode) {
        if (q.trim()) void runAI(q)
        return
      }
      const r = results[hover]
      if (r) pickResult(r, e.shiftKey ? null : undefined)
      else if (q.trim() && aiConfigured) void runAI(q)
    } else if (e.key === 'Tab' && !e.shiftKey && q.trim() === '' && aiConfigured) {
      // Quick-toggle into AI mode when the input is empty.
      e.preventDefault()
      setAiMode((v) => !v)
    }
  }

  const aiExamples = useMemo(() => [
    'Add a Postgres database used by the Web App',
    'Create a payment system with API gateway and worker',
    'Create a view showing only the payment-related nodes',
    'Show me the Auth Service node',
    'List all technologies used in this model',
    'Summarize the architecture',
    'Create a complete 3-tier web app from scratch',
  ], [])

  const showDropdown = focused || aiBusy || !!aiLast || aiMode

  return (
    <div
      className={`quick-search-bar${aiMode ? ' ai-mode' : ''}`}
      ref={wrapRef}
      role="search"
      aria-label="Quick search & AI"
    >
      <div className="quick-search-inputrow">
        {aiMode ? (
          <span style={{ flexShrink: 0, fontSize: 14, color: 'var(--accent)' }} aria-hidden>✨</span>
        ) : (
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.6, flexShrink: 0 }}>
            <circle cx="7" cy="7" r="4.5" />
            <path d="M11 11l3.5 3.5" />
          </svg>
        )}
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => { setQ(e.target.value); setFocused(true) }}
          onFocus={() => setFocused(true)}
          onKeyDown={onInputKey}
          placeholder={
            aiMode
              ? `Ask ${aiProviderLabel} to change the model… (↵ to send)`
              : aiConfigured
                ? `Search ${Object.keys(c4Nodes).length} nodes · ${Object.keys(c4Relations).length} relations  —  ⌘/Ctrl+↵ to ask AI`
                : `Search ${Object.keys(c4Nodes).length} nodes · ${Object.keys(c4Relations).length} relations`
          }
          spellCheck={false}
          autoComplete="off"
        />
        <button
          type="button"
          className={`qs-mode-toggle${aiMode ? ' active' : ''}`}
          title={aiMode ? 'Switch to search mode' : 'Switch to AI mode (Tab on empty input)'}
          aria-pressed={aiMode}
          aria-label="Toggle AI mode"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => { setAiMode((v) => !v); inputRef.current?.focus() }}
          style={{ display: aiConfigured ? undefined : 'none' }}
        >
          ✨
        </button>
        {aiBusy && (
          <button
            type="button"
            className="quick-search-kbd"
            title="Cancel AI request"
            onMouseDown={(e) => e.preventDefault()}
            onClick={cancelAI}
            style={{ cursor: 'pointer' }}
          >
            Cancel
          </button>
        )}
        {!aiBusy && (
          <kbd className="quick-search-kbd" title="Focus search (⌘P / Ctrl+P)">⌘P</kbd>
        )}
      </div>
      {showDropdown && (
        <div className="quick-search-dropdown">
          {/* AI status / last result banner — visible whenever AI is in play */}
          {(aiBusy || aiLast || aiMode) && (
            <div className="qs-ai-banner">
              <div className="qs-ai-banner-row">
                <span className="qs-ai-spark" aria-hidden>✨</span>
                <span className="qs-ai-name">{aiProviderLabel}</span>
                <span className="qs-ai-model">· {aiModelLabel}</span>
                {aiNeedsKey && (
                  <span className="qs-ai-error" style={{ marginLeft: 6 }}>· no API key</span>
                )}
                <span className="qs-ai-spacer" />
                <button
                  className="qs-ai-mini-btn"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => openAISettings()}
                  title="AI providers"
                >
                  Configure
                </button>
                {(aiLast || aiHistory.length > 0) && !aiBusy && (
                  <button
                    className="qs-ai-mini-btn"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => { setAiLast(null); setAiHistory([]) }}
                    title="Clear AI conversation"
                  >
                    Reset
                  </button>
                )}
              </div>
              {aiBusy && (
                <div className="qs-ai-status"><span className="qs-ai-dot" /> Thinking…</div>
              )}
              {aiLast?.error && (
                <div className="qs-ai-error">Error: {aiLast.error}</div>
              )}
              {aiLast && !aiLast.error && (
                <div className="qs-ai-text">
                  <span style={{ whiteSpace: 'pre-line' }}>{aiLast.text}</span>
                  {aiLast.report && <AIReportLine report={aiLast.report} />}
                  {(aiLast.retries || aiHistory.length > 0) && (
                    <div className="qs-ai-meta">
                      {aiLast.retries ? (
                        <span className="qs-ai-meta-pill">
                          ↻ {aiLast.retries} corrective round{aiLast.retries === 1 ? '' : 's'}
                        </span>
                      ) : null}
                      {aiHistory.length > 0 && (
                        <span className="qs-ai-meta-pill">
                          {aiHistory.length / 2} turn{aiHistory.length / 2 === 1 ? '' : 's'} in context
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Examples shown when entering AI mode with empty input */}
          {aiMode && q.trim() === '' && !aiBusy && !aiLast && (
            <div className="qs-ai-examples">
              {aiExamples.map((ex) => (
                <button
                  key={ex}
                  className="qs-ai-example"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => { setQ(ex); inputRef.current?.focus() }}
                  type="button"
                >
                  <span className="qs-ai-example-icon" aria-hidden>›</span>{ex}
                </button>
              ))}
            </div>
          )}

          <div className="quick-search-results">
            {!aiMode && q.trim() === '' && !aiBusy && !aiLast && (
              <div className="quick-search-hint">
                Type to search. <kbd>↑</kbd> <kbd>↓</kbd> navigate, <kbd>↵</kbd> jump, <kbd>⇧</kbd>+<kbd>↵</kbd> in <em>all nodes</em>
                {aiConfigured && (<>, <kbd>⌘</kbd>+<kbd>↵</kbd> ask AI, <kbd>Tab</kbd> AI mode</>)}.
              </div>
            )}
            {!aiMode && q.trim() !== '' && results.length === 0 && !aiBusy && (
              <div className="quick-search-hint">
                No matches.
                {aiConfigured ? (<> Press <kbd>⌘</kbd>+<kbd>↵</kbd> (or click below) to ask AI.</>) : null}
              </div>
            )}
            {results.map((r, i) => (
              <div
                key={`${r.kind}:${r.id}`}
                className={`quick-search-item${i === hover ? ' active' : ''}`}
                onMouseEnter={() => setHover(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={(e) => pickResult(r, e.shiftKey ? null : undefined)}
                role="button"
                tabIndex={-1}
              >
                <span className={`quick-search-kind quick-search-kind-${r.kind}`}>
                  {r.kind === 'node' ? 'NODE' : r.kind === 'edge' ? 'REL' : 'VIEW'}
                </span>
                <span className="quick-search-item-main">
                  <span className="quick-search-item-label">{r.label}</span>
                  <span className="quick-search-item-sub">{r.sub}</span>
                </span>
                {(r.kind === 'node' || r.kind === 'edge') && (
                  <span className="quick-search-views" title="Click to open in this scope">
                    {/* "All nodes" chip — opens with no active view filter */}
                    <span
                      className={`quick-search-view-chip all${activeViewId === null ? ' active' : ''}`}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={(e) => { e.stopPropagation(); pickResult(r, null) }}
                      title="Open in All nodes (no view filter)"
                    >
                      All
                    </span>
                    {r.viewIds.slice(0, 3).map((vid) => (
                      <span
                        key={vid}
                        className={`quick-search-view-chip${vid === activeViewId ? ' active' : ''}`}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={(e) => { e.stopPropagation(); pickResult(r, vid) }}
                        title={`Open in view: ${views[vid]?.name ?? vid}`}
                      >
                        {views[vid]?.name ?? vid}
                      </span>
                    ))}
                    {r.viewIds.length > 3 && (
                      <span className="quick-search-view-chip more" title={`${r.viewIds.length - 3} more view${r.viewIds.length - 3 === 1 ? '' : 's'}`}>+{r.viewIds.length - 3}</span>
                    )}
                    {r.kind === 'node' && r.viewIds.length === 0 && (
                      <span
                        className="quick-search-view-chip model-only"
                        title="Exists in the model but not in any view"
                      >
                        model only
                      </span>
                    )}
                  </span>
                )}
              </div>
            ))}

            {/* Ask AI action — visible while typing in search mode (only when configured) */}
            {!aiMode && aiConfigured && q.trim() !== '' && !aiBusy && (
              <div
                className="quick-search-item"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => void runAI(q)}
                role="button"
                tabIndex={-1}
                style={{ borderTop: results.length > 0 ? '1px solid var(--border-subtle)' : undefined }}
                title={aiNeedsKey ? `Set an API key for ${aiProviderLabel} first` : `Ask ${aiProviderLabel} (${aiModelLabel})`}
              >
                <span className="quick-search-kind quick-search-kind-ai">AI</span>
                <span className="quick-search-item-main">
                  <span className="quick-search-item-label">✨ Ask AI: “{q.trim()}”</span>
                  <span className="quick-search-item-sub">
                    {aiNeedsKey ? `Configure → ${aiProviderLabel} (no API key)` : `${aiProviderLabel} · ${aiModelLabel}`}
                  </span>
                </span>
                <kbd className="quick-search-kbd" style={{ marginLeft: 6 }}>⌘↵</kbd>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function AIReportLine({ report }: { report: ApplyReport }): React.ReactElement {
  const parts: string[] = []
  if (report.added.nodes) parts.push(`+${report.added.nodes} node${report.added.nodes === 1 ? '' : 's'}`)
  if (report.added.relations) parts.push(`+${report.added.relations} relation${report.added.relations === 1 ? '' : 's'}`)
  if (report.added.views) parts.push(`+${report.added.views} view${report.added.views === 1 ? '' : 's'}`)
  if (report.updated.nodes) parts.push(`~${report.updated.nodes} updated`)
  if (report.updated.views) parts.push(`~${report.updated.views} view${report.updated.views === 1 ? '' : 's'}`)
  if (report.deleted.nodes) parts.push(`−${report.deleted.nodes} node${report.deleted.nodes === 1 ? '' : 's'}`)
  if (report.deleted.relations) parts.push(`−${report.deleted.relations} relation${report.deleted.relations === 1 ? '' : 's'}`)
  if (report.deleted.views) parts.push(`−${report.deleted.views} view${report.deleted.views === 1 ? '' : 's'}`)
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
