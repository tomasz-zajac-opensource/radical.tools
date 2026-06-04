import React, { useMemo, useState, useCallback } from 'react'
import { useDiagramStore } from '../store/diagramStore'
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

  const [hover, setHover] = useState<{ row: number; col: number } | null>(null)

  const visibleNodeIds = useMemo<Set<string> | null>(() => {
    if (!activeView || activeView.nodeIds.length === 0) return null
    return new Set(activeView.nodeIds)
  }, [activeView])

  const orderedNodes = useMemo(() => {
    const list = visibleNodeIds
      ? Object.values(nodes).filter((n) => visibleNodeIds.has(n.id))
      : Object.values(nodes)
    return orderNodes(list)
  }, [nodes, visibleNodeIds])

  // source -> target -> relation (first match wins for the cell marker)
  const relMap = useMemo(() => {
    const m = new Map<string, Map<string, string>>()
    for (const rel of Object.values(relations)) {
      if (!m.has(rel.sourceId)) m.set(rel.sourceId, new Map())
      const inner = m.get(rel.sourceId)!
      if (!inner.has(rel.targetId)) inner.set(rel.targetId, rel.id)
    }
    return m
  }, [relations])

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
    (source: C4Node, target: C4Node) => {
      if (source.id === target.id) return
      const existingId = relMap.get(source.id)?.get(target.id)
      if (existingId) {
        if (selectedEdgeId === existingId) {
          // Second click on the selected cell removes the relation.
          removeRelation(existingId)
          pushNotification(`Removed relation: ${source.label} \u2192 ${target.label}`, 'info')
        } else {
          selectEdge(existingId)
        }
        return
      }
      // Empty cell → attempt to create a relation, honouring metamodel rules.
      if (!isRelationAllowed(metamodel, source.type, target.type)) {
        const s = metamodel?.nodeTypes[source.type]?.label ?? source.type
        const t = metamodel?.nodeTypes[target.type]?.label ?? target.type
        pushNotification(`Relation not allowed: ${s} \u2192 ${t}.`, 'error')
        return
      }
      addRelation({ sourceId: source.id, targetId: target.id })
      pushNotification(`Added relation: ${source.label} \u2192 ${target.label}`, 'info')
    },
    [relMap, selectedEdgeId, selectEdge, removeRelation, addRelation, metamodel, pushNotification],
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
          rows → columns · click an empty cell to create a relation · click a marked cell to select · click again to remove
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
                  const isDiag = row.id === col.id
                  const relId = relMap.get(row.id)?.get(col.id)
                  const rel = relId ? relations[relId] : undefined
                  const isSel = relId !== undefined && relId === selectedEdgeId
                  const isHl = hover?.row === ri || hover?.col === ci
                  const cls = [
                    'mx-cell',
                    isDiag ? 'mx-diag' : '',
                    rel ? 'mx-has-rel' : '',
                    isSel ? 'mx-sel' : '',
                    isHl ? 'mx-axis-hl' : '',
                  ].filter(Boolean).join(' ')
                  return (
                    <td
                      key={col.id}
                      className={cls}
                      onMouseEnter={() => setHover({ row: ri, col: ci })}
                      onMouseLeave={() => setHover(null)}
                      onClick={isDiag ? undefined : () => onCellClick(row, col)}
                      title={
                        isDiag
                          ? ''
                          : rel
                            ? `${row.label} \u2192 ${col.label}  (${relLabel(rel.relationType)})${rel.label ? ' · ' + rel.label : ''}`
                            : `Create relation: ${row.label} \u2192 ${col.label}`
                      }
                    >
                      {isDiag ? (
                        <span className="mx-diag-mark" />
                      ) : rel ? (
                        <span className="mx-dot" style={{ background: relColor(rel.relationType) }} />
                      ) : null}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  )
}
