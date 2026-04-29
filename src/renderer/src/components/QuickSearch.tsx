import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useDiagramStore } from '../store/diagramStore'

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
  const inputRef = useRef<HTMLInputElement | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)

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
  // mounted so the input remains visible.
  useEffect(() => {
    if (!focused) return
    const onDown = (e: MouseEvent): void => {
      if (!wrapRef.current) return
      if (!wrapRef.current.contains(e.target as Node)) setFocused(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [focused])

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
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const r = results[hover]
      if (r) pickResult(r, e.shiftKey ? null : undefined)
    }
  }

  const showDropdown = focused

  return (
    <div className="quick-search-bar" ref={wrapRef} role="search" aria-label="Quick search">
      <div className="quick-search-inputrow">
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.6, flexShrink: 0 }}>
          <circle cx="7" cy="7" r="4.5" />
          <path d="M11 11l3.5 3.5" />
        </svg>
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => { setQ(e.target.value); setFocused(true) }}
          onFocus={() => setFocused(true)}
          onKeyDown={onInputKey}
          placeholder={`Search ${Object.keys(c4Nodes).length} nodes / ${Object.keys(c4Relations).length} relations / ${Object.keys(views).length} views…`}
          spellCheck={false}
          autoComplete="off"
        />
        <kbd className="quick-search-kbd" title="Focus search (⌘P / Ctrl+P)">⌘P</kbd>
      </div>
      {showDropdown && (
        <div className="quick-search-dropdown">
          <div className="quick-search-results">
            {q.trim() === '' && (
              <div className="quick-search-hint">Type to search. <kbd>↑</kbd> <kbd>↓</kbd> to navigate, <kbd>↵</kbd> to jump in best view, <kbd>⇧</kbd>+<kbd>↵</kbd> to jump in <em>all nodes</em>. Click a view chip to open in that view.</div>
            )}
            {q.trim() !== '' && results.length === 0 && (
              <div className="quick-search-hint">No matches.</div>
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
          </div>
        </div>
      )}
    </div>
  )
}
