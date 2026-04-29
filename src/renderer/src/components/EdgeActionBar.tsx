import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useDiagramStore } from '../store/diagramStore'
import { isRelationAllowed } from '../types/metamodel'

/**
 * Floating action bar that appears over the canvas whenever a single
 * relation (edge) is selected. Mirrors `SelectionActionBar` in look & feel.
 *
 * Surfaces:
 *   • current source → target labels for context,
 *   • a "Change source…" menu (every node the metamodel allows as the new
 *     source, given the current target),
 *   • a "Change destination…" menu (every node the metamodel allows as the
 *     new target, given the current source),
 *   • a destructive Delete button.
 *
 * The two endpoint pickers are intentionally keyboard-free menus (no
 * drag-an-endpoint UI yet) — they're explicit, testable, and metamodel-aware.
 */
export function EdgeActionBar(): React.ReactElement | null {
  const selectedEdgeId = useDiagramStore((s) => s.selectedEdgeId)
  const c4Relations = useDiagramStore((s) => s.c4Relations)
  const c4Nodes = useDiagramStore((s) => s.c4Nodes)
  const metamodel = useDiagramStore((s) => s.metamodel)
  const updateRelation = useDiagramStore((s) => s.updateRelation)
  const removeRelation = useDiagramStore((s) => s.removeRelation)
  const selectEdge = useDiagramStore((s) => s.selectEdge)
  const appMode = useDiagramStore((s) => s.appMode)
  const selectedNodeIds = useDiagramStore((s) => s.selectedNodeIds)
  const activeViewId = useDiagramStore((s) => s.activeViewId)
  const hideRelationFromView = useDiagramStore((s) => s.hideRelationFromView)

  const [sourceMenuOpen, setSourceMenuOpen] = useState(false)
  const [targetMenuOpen, setTargetMenuOpen] = useState(false)
  const sourceRef = useRef<HTMLDivElement | null>(null)
  const targetRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!sourceMenuOpen && !targetMenuOpen) return
    const onDown = (e: MouseEvent): void => {
      if (sourceMenuOpen && sourceRef.current && !sourceRef.current.contains(e.target as Node)) {
        setSourceMenuOpen(false)
      }
      if (targetMenuOpen && targetRef.current && !targetRef.current.contains(e.target as Node)) {
        setTargetMenuOpen(false)
      }
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [sourceMenuOpen, targetMenuOpen])

  const rel = selectedEdgeId ? c4Relations[selectedEdgeId] : undefined
  const source = rel ? c4Nodes[rel.sourceId] : undefined
  const target = rel ? c4Nodes[rel.targetId] : undefined

  // Build node-path helper (same convention as the move menu in
  // SelectionActionBar) so multi-named nodes are easy to disambiguate.
  const pathOf = useMemo(() => {
    return (id: string): string => {
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
  }, [c4Nodes])

  // Candidate sources: every node except the current source, where a
  // (candidate → currentTarget) relation is allowed by the metamodel.
  const sourceCandidates = useMemo(() => {
    if (!rel || !target) return [] as { id: string; label: string; path: string }[]
    const out: { id: string; label: string; path: string }[] = []
    for (const n of Object.values(c4Nodes)) {
      if (n.id === rel.sourceId) continue
      if (n.id === rel.targetId) continue // self-loops disallowed
      if (!isRelationAllowed(metamodel, n.type, target.type)) continue
      const typeLabel = metamodel?.nodeTypes[n.type]?.label ?? n.type
      out.push({
        id: n.id,
        label: `${n.label || n.type} (${typeLabel})`,
        path: pathOf(n.id),
      })
    }
    return out.sort((a, b) => a.path.localeCompare(b.path))
  }, [rel, target, c4Nodes, metamodel, pathOf])

  // Candidate targets: every node except the current target, where a
  // (currentSource → candidate) relation is allowed.
  const targetCandidates = useMemo(() => {
    if (!rel || !source) return [] as { id: string; label: string; path: string }[]
    const out: { id: string; label: string; path: string }[] = []
    for (const n of Object.values(c4Nodes)) {
      if (n.id === rel.targetId) continue
      if (n.id === rel.sourceId) continue
      if (!isRelationAllowed(metamodel, source.type, n.type)) continue
      const typeLabel = metamodel?.nodeTypes[n.type]?.label ?? n.type
      out.push({
        id: n.id,
        label: `${n.label || n.type} (${typeLabel})`,
        path: pathOf(n.id),
      })
    }
    return out.sort((a, b) => a.path.localeCompare(b.path))
  }, [rel, source, c4Nodes, metamodel, pathOf])

  if (appMode !== 'designer') return null
  // Don't compete with the node selection bar — node selection wins.
  if (selectedNodeIds.length > 0) return null
  if (!rel || !source || !target) return null

  const sourceLabel = source.label || source.type
  const targetLabel = target.label || target.type

  const onDelete = (): void => {
    selectEdge(null)
    removeRelation(rel.id)
  }

  return (
    <div className="sel-bar" role="toolbar" aria-label="Relation actions">
      <div className="sel-bar-count">
        <span className="sel-bar-label" title={`${pathOf(rel.sourceId)} → ${pathOf(rel.targetId)}`}>
          <strong>{sourceLabel}</strong>
          <span style={{ opacity: 0.6, padding: '0 6px' }}>→</span>
          <strong>{targetLabel}</strong>
        </span>
      </div>
      <div className="sel-bar-divider" />
      <div className="sel-bar-wrap" ref={sourceRef}>
        <button
          type="button"
          className="sel-bar-btn"
          onClick={() => { setSourceMenuOpen((o) => !o); setTargetMenuOpen(false) }}
          title="Re-route this relation from a different source node"
          disabled={sourceCandidates.length === 0}
        >
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
            <circle cx="4" cy="8" r="2" />
            <path d="M6 8h7M10 5l3 3-3 3" />
          </svg>
          Change source…
          <svg viewBox="0 0 10 10" width="9" height="9" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.7 }}>
            <path d="M2 4l3 3 3-3" />
          </svg>
        </button>
        {sourceMenuOpen && sourceCandidates.length > 0 && (
          <div className="sel-bar-menu" role="menu">
            {sourceCandidates.map((c) => (
              <button
                key={c.id}
                type="button"
                role="menuitem"
                className="sel-bar-menu-item"
                onClick={() => {
                  setSourceMenuOpen(false)
                  updateRelation(rel.id, { sourceId: c.id })
                }}
              >
                <span>{c.label}</span>
                <span className="sel-bar-menu-reason">{c.path}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="sel-bar-divider" />
      <div className="sel-bar-wrap" ref={targetRef}>
        <button
          type="button"
          className="sel-bar-btn"
          onClick={() => { setTargetMenuOpen((o) => !o); setSourceMenuOpen(false) }}
          title="Re-route this relation to a different destination node"
          disabled={targetCandidates.length === 0}
        >
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 8h7M7 5l3 3-3 3" />
            <circle cx="13" cy="8" r="2" />
          </svg>
          Change destination…
          <svg viewBox="0 0 10 10" width="9" height="9" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.7 }}>
            <path d="M2 4l3 3 3-3" />
          </svg>
        </button>
        {targetMenuOpen && targetCandidates.length > 0 && (
          <div className="sel-bar-menu" role="menu">
            {targetCandidates.map((c) => (
              <button
                key={c.id}
                type="button"
                role="menuitem"
                className="sel-bar-menu-item"
                onClick={() => {
                  setTargetMenuOpen(false)
                  updateRelation(rel.id, { targetId: c.id })
                }}
              >
                <span>{c.label}</span>
                <span className="sel-bar-menu-reason">{c.path}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="sel-bar-divider" />
      {activeViewId && (
        <>
          <button
            type="button"
            className="sel-bar-btn"
            onClick={() => {
              const id = rel.id
              selectEdge(null)
              hideRelationFromView(activeViewId, id)
            }}
            title="Hide this relation from the active view (model is not changed)"
          >
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 8s2.5-4 6-4 6 4 6 4-2.5 4-6 4-6-4-6-4z" />
              <path d="M2 2l12 12" />
            </svg>
            Hide from view
          </button>
          <div className="sel-bar-divider" />
        </>
      )}
      <button
        type="button"
        className="sel-bar-btn sel-bar-btn-danger"
        onClick={onDelete}
        title="Delete this relation"
      >
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 4h10M6 4V2.5h4V4M5 4l1 9h4l1-9" />
        </svg>
        Delete
      </button>
    </div>
  )
}
