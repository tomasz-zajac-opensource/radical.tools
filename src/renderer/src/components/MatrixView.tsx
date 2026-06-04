import React, { useMemo, useState, useCallback, useRef, useEffect } from 'react'
import {
  useDiagramStore,
  computeViewCollapsedSet,
  isNodeHidden,
  getViewVisibleAncestor,
} from '../store/diagramStore'
import type { C4Node } from '../types/c4'
import { NODE_COLORS, TYPE_LABELS } from '../types/c4'
import { isRelationAllowed } from '../types/metamodel'

// ─── Tree ordering helper (hierarchical, parents before children) ────────────

function orderNodes(nodeList: C4Node[]): C4Node[] {
  const present = new Set(nodeList.map((n) => n.id))
  const byParent = new Map<string | null, C4Node[]>()
  for (const n of nodeList) {
    // Treat parents outside the visible set as roots so nothing is dropped.
    const key = n.parentId && present.has(n.parentId) ? n.parentId : null
    if (!byParent.has(key)) byParent.set(key, [])
    byParent.get(key)!.push(n)
  }
  const result: C4Node[] = []
  const walk = (parentId: string | null) => {
    for (const n of byParent.get(parentId) ?? []) {
      result.push(n)
      walk(n.id)
    }
  }
  walk(null)
  const visited = new Set(result.map((n) => n.id))
  for (const n of nodeList) if (!visited.has(n.id)) result.push(n)
  return result
}

// ─── Component ───────────────────────────────────────────────────────────────

export function MatrixView(): React.ReactElement {
  const nodes            = useDiagramStore((s) => s.c4Nodes)
  const relations        = useDiagramStore((s) => s.c4Relations)
  const metamodel        = useDiagramStore((s) => s.metamodel)
  const activeView       = useDiagramStore((s) => (s.activeViewId ? s.views[s.activeViewId] : undefined))
  const selectEdge       = useDiagramStore((s) => s.selectEdge)
  const selectNode       = useDiagramStore((s) => s.selectNode)
  const selectedEdgeId   = useDiagramStore((s) => s.selectedEdgeId)
  const addRelation      = useDiagramStore((s) => s.addRelation)
  const removeRelation   = useDiagramStore((s) => s.removeRelation)
  const pushNotification = useDiagramStore((s) => s.pushNotification)
  const appMode          = useDiagramStore((s) => s.appMode)
  const readonly         = appMode !== 'designer'

  const [hover, setHover] = useState<{ row: number; col: number } | null>(null)

  // ── Multi-relation popup ──────────────────────────────────────────────────
  type PopupState = {
    relIds: string[]
    sourceNode: C4Node
    targetNode: C4Node
    x: number
    y: number
  }
  const [popup, setPopup] = useState<PopupState | null>(null)
  const popupRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!popup) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPopup(null) }
    const onClickOutside = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) setPopup(null)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onClickOutside)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onClickOutside)
    }
  }, [popup])

  // ── Collapse-aware view state ──────────────────────────────────────────────

  const viewFilter = useMemo<Set<string> | undefined>(() => {
    if (!activeView || activeView.nodeIds.length === 0) return undefined
    return new Set(activeView.nodeIds)
  }, [activeView])

  const viewCollapsedSet = useMemo<Set<string>>(() => {
    const vcs = computeViewCollapsedSet(viewFilter, nodes)
    if (activeView?.collapsedNodeIds?.length) {
      for (const nid of activeView.collapsedNodeIds) vcs.add(nid)
    }
    return vcs
  }, [viewFilter, nodes, activeView])

  const expandedSet = useMemo<Set<string> | undefined>(() => {
    if (!activeView?.expandedNodeIds?.length) return undefined
    return new Set(activeView.expandedNodeIds)
  }, [activeView])

  // ── Visible node list (respects collapse state) ────────────────────────────

  const orderedNodes = useMemo(() => {
    const base = viewFilter
      ? Object.values(nodes).filter((n) => viewFilter.has(n.id))
      : Object.values(nodes)
    // Only include nodes that are not hidden behind a collapsed ancestor.
    const visible = base.filter((n) => !isNodeHidden(n.id, nodes, viewCollapsedSet, expandedSet))
    return orderNodes(visible)
  }, [nodes, viewFilter, viewCollapsedSet, expandedSet])

  const visibleNodeIdSet = useMemo(() => new Set(orderedNodes.map((n) => n.id)), [orderedNodes])

  // ── Relation map (rolled up through visible ancestors) ────────────────────
  // source -> target -> all relation IDs that roll up to this pair

  const relMap = useMemo(() => {
    const m = new Map<string, Map<string, string[]>>()
    for (const rel of Object.values(relations)) {
      const visSource = getViewVisibleAncestor(rel.sourceId, nodes, viewFilter, viewCollapsedSet, expandedSet)
      const visTarget = getViewVisibleAncestor(rel.targetId, nodes, viewFilter, viewCollapsedSet, expandedSet)
      if (!visSource || !visTarget || visSource === visTarget) continue
      if (!visibleNodeIdSet.has(visSource) || !visibleNodeIdSet.has(visTarget)) continue
      if (!m.has(visSource)) m.set(visSource, new Map())
      const inner = m.get(visSource)!
      const existing = inner.get(visTarget)
      if (existing) {
        existing.push(rel.id)
      } else {
        inner.set(visTarget, [rel.id])
      }
    }
    return m
  }, [relations, nodes, viewFilter, viewCollapsedSet, expandedSet, visibleNodeIdSet])

  const relColor = useCallback(
    (relationType: string | undefined): string => {
      if (relationType && metamodel?.relationTypes[relationType]?.color)
        return metamodel.relationTypes[relationType]!.color!
      return 'var(--accent)'
    },
    [metamodel],
  )

  const relLabel = useCallback(
    (relationType: string | undefined): string => {
      if (relationType && metamodel?.relationTypes[relationType]?.label)
        return metamodel.relationTypes[relationType]!.label
      return relationType ?? 'relation'
    },
    [metamodel],
  )

  const onCellClick = useCallback(
    (source: C4Node, target: C4Node, e: React.MouseEvent) => {
      if (source.id === target.id) return
      const relIds = relMap.get(source.id)?.get(target.id)
      if (relIds && relIds.length > 0) {
        if (relIds.length > 1) {
          // Multiple relations — show popup to pick one.
          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
          setPopup({ relIds, sourceNode: source, targetNode: target, x: rect.left + rect.width / 2, y: rect.bottom + 4 })
          return
        }
        const existingId = relIds[0]
        if (!readonly && selectedEdgeId === existingId) {
          removeRelation(existingId)
          pushNotification(`Removed relation: ${source.label} \u2192 ${target.label}`, 'info')
        } else {
          selectEdge(existingId)
        }
        return
      }
      if (readonly) return
      if (!isRelationAllowed(metamodel, source.type, target.type)) {
        const s = metamodel?.nodeTypes[source.type]?.label ?? source.type
        const t = metamodel?.nodeTypes[target.type]?.label ?? target.type
        pushNotification(`Relation not allowed: ${s} \u2192 ${t}.`, 'error')
        return
      }
      addRelation({ sourceId: source.id, targetId: target.id })
      pushNotification(`Added relation: ${source.label} \u2192 ${target.label}`, 'info')
    },
    [relMap, selectedEdgeId, selectEdge, removeRelation, addRelation, metamodel, pushNotification, readonly],
  )

  const n = orderedNodes.length

  if (n === 0) {
    return (
      <main className="mx-wrap">
        <div className="mx-empty">
          <div className="mx-empty-title">No nodes to display</div>
          <div className="mx-empty-sub">
            This matrix view has no nodes. Add nodes to the model or to this view to see their relations.
          </div>
        </div>
      </main>
    )
  }

  return (
    <main className="mx-wrap">
      <div className="mx-toolbar">
        <span className="mx-title">Relationship Matrix</span>
        <span className="mx-hint">
          {readonly
            ? 'rows → columns · click a marked cell to select'
            : 'rows → columns · click an empty cell to create a relation · click a marked cell to select · click again to remove'}
        </span>
      </div>
      <div className="mx-scroll">
        <table className="mx-table" style={{ ['--mx-n' as string]: n }}>
          <thead>
            <tr>
              <th className="mx-corner">
                <span className="mx-corner-from">from \ to</span>
              </th>
              {orderedNodes.map((col, ci) => (
                <th
                  key={col.id}
                  className={`mx-colhead${hover?.col === ci ? ' mx-axis-hl' : ''}`}
                  title={`${TYPE_LABELS[col.type] ?? col.type}: ${col.label}`}
                  onClick={() => selectNode(col.id)}
                >
                  <div className="mx-colhead-inner">
                    <span className="mx-swatch" style={{ background: NODE_COLORS[col.type] }} />
                    <span className="mx-colhead-text">{col.label}</span>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {orderedNodes.map((row, ri) => (
              <tr key={row.id}>
                <th
                  className={`mx-rowhead${hover?.row === ri ? ' mx-axis-hl' : ''}`}
                  title={`${TYPE_LABELS[row.type] ?? row.type}: ${row.label}`}
                  onClick={() => selectNode(row.id)}
                >
                  <span className="mx-swatch" style={{ background: NODE_COLORS[row.type] }} />
                  <span className="mx-rowhead-text">{row.label}</span>
                </th>
                {orderedNodes.map((col, ci) => {
                  const isDiag  = row.id === col.id
                  const relIds  = relMap.get(row.id)?.get(col.id)
                  const count   = relIds?.length ?? 0
                  const firstId = relIds?.[0]
                  const rel     = firstId ? relations[firstId] : undefined
                  const isSel   = !!firstId && (relIds!.includes(selectedEdgeId ?? ''))
                  const isHl    = hover?.row === ri || hover?.col === ci
                  const cls = [
                    'mx-cell',
                    isDiag ? 'mx-diag' : '',
                    rel ? 'mx-has-rel' : '',
                    isSel ? 'mx-sel' : '',
                    isHl ? 'mx-axis-hl' : '',
                    !isDiag && !rel && readonly ? 'mx-readonly' : '',
                  ].filter(Boolean).join(' ')
                  return (
                    <td
                      key={col.id}
                      className={cls}
                      onMouseEnter={() => setHover({ row: ri, col: ci })}
                      onMouseLeave={() => setHover(null)}
                      onClick={isDiag ? undefined : (e) => onCellClick(row, col, e)}
                      title={
                        isDiag
                          ? ''
                          : rel
                            ? `${row.label} \u2192 ${col.label}${count > 1 ? ` · ${count} relations` : `  (${relLabel(rel.relationType)})${rel.label ? ' · ' + rel.label : ''}`}`
                            : readonly
                              ? `${row.label} \u2192 ${col.label}`
                              : `Create relation: ${row.label} \u2192 ${col.label}`
                      }
                    >
                      {isDiag ? (
                        <span className="mx-diag-mark" />
                      ) : rel ? (
                        <span className="mx-dot" style={{ background: relColor(rel.relationType) }}>
                          {count > 1 && <span className="mx-dot-count">{count}</span>}
                        </span>
                      ) : null}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {popup && (
        <div
          ref={popupRef}
          className="mx-popup"
          style={{ left: popup.x, top: popup.y }}
        >
          <div className="mx-popup-header">
            <span className="mx-popup-from">{popup.sourceNode.label}</span>
            <span className="mx-popup-arrow">→</span>
            <span className="mx-popup-to">{popup.targetNode.label}</span>
          </div>
          <ul className="mx-popup-list">
            {popup.relIds.map((rid) => {
              const r = relations[rid]
              if (!r) return null
              const isSel = rid === selectedEdgeId
              return (
                <li key={rid} className={`mx-popup-item${isSel ? ' mx-popup-item-sel' : ''}`}>
                  <button
                    className="mx-popup-select"
                    onClick={() => { selectEdge(rid); setPopup(null) }}
                  >
                    <span className="mx-popup-dot" style={{ background: relColor(r.relationType) }} />
                    <span className="mx-popup-rel-label">
                      {r.label || relLabel(r.relationType)}
                      {r.label && r.relationType && (
                        <span className="mx-popup-rel-type"> ({relLabel(r.relationType)})</span>
                      )}
                    </span>
                  </button>
                  {!readonly && (
                    <button
                      className="mx-popup-remove"
                      title="Remove this relation"
                      onClick={() => {
                        removeRelation(rid)
                        pushNotification(`Removed relation: ${popup.sourceNode.label} \u2192 ${popup.targetNode.label}`, 'info')
                        setPopup(null)
                      }}
                    >
                      ×
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </main>
  )
}
