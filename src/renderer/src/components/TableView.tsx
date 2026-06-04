import React, { useState, useCallback, useMemo } from 'react'
import { useDiagramStore } from '../store/diagramStore'
import type { C4Node, C4Relation } from '../types/c4'
import { NODE_COLORS, NODE_FG, TYPE_LABELS } from '../types/c4'

// ─── Column definitions ──────────────────────────────────────────────────────

type CellType = 'text' | 'textarea' | 'enum' | 'boolean' | 'readonly'

interface ColDef {
  key: string
  label: string
  width: number
  type: CellType
  options?: string[]
}

const ALL_NODES_COLS: ColDef[] = [
  { key: '_type',       label: 'Type',        width: 130, type: 'readonly' },
  { key: 'label',       label: 'Name',        width: 220, type: 'text' },
  { key: 'description', label: 'Description', width: 280, type: 'textarea' },
  { key: 'technology',  label: 'Technology',  width: 160, type: 'text' },
  { key: '_parent',     label: 'Parent',      width: 180, type: 'readonly' },
]

const ADR_COLS: ColDef[] = [
  { key: 'label',        label: 'Name',                    width: 220, type: 'text' },
  { key: 'status',       label: 'Status',                  width: 130, type: 'enum', options: ['proposed', 'accepted', 'deprecated', 'superseded'] },
  { key: 'date',         label: 'Date',                    width: 110, type: 'text' },
  { key: 'context',      label: 'Context',                 width: 260, type: 'textarea' },
  { key: 'decision',     label: 'Decision',                width: 280, type: 'textarea' },
  { key: 'consequences', label: 'Consequences',            width: 240, type: 'textarea' },
  { key: 'alternatives', label: 'Alternatives considered', width: 240, type: 'textarea' },
]

const FF_COLS: ColDef[] = [
  { key: 'label',     label: 'Name',      width: 220, type: 'text' },
  { key: 'status',    label: 'Status',    width: 130, type: 'enum', options: ['proposed', 'active', 'deprecated'] },
  { key: 'category',  label: 'Category',  width: 150, type: 'enum', options: ['structural', 'operational', 'process', 'holistic'] },
  { key: 'automated', label: 'Automated', width: 100, type: 'boolean' },
  { key: 'trigger',   label: 'Trigger',   width: 130, type: 'enum', options: ['on-deploy', 'continuous', 'periodic'] },
  { key: 'threshold', label: 'Threshold / Success criteria', width: 240, type: 'textarea' },
]

const REL_COLS: ColDef[] = [
  { key: '_source',    label: 'From',       width: 200, type: 'readonly' },
  { key: '_relType',   label: 'Type',       width: 130, type: 'readonly' },
  { key: '_target',    label: 'To',         width: 200, type: 'readonly' },
  { key: 'label',      label: 'Label',      width: 200, type: 'text' },
  { key: 'technology', label: 'Technology', width: 160, type: 'text' },
]

// ─── Tab definitions ─────────────────────────────────────────────────────────

type Tab = 'all' | 'adr' | 'fitness-fn' | 'relations'

const TABS: { id: Tab; label: string }[] = [
  { id: 'all',        label: 'All Nodes' },
  { id: 'adr',        label: 'ADRs' },
  { id: 'fitness-fn', label: 'Fitness Functions' },
  { id: 'relations',  label: 'Relations' },
]

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getNodeProp(node: C4Node, key: string, nodes: Record<string, C4Node>): string {
  if (key === '_type')   return TYPE_LABELS[node.type] ?? node.type
  if (key === '_parent') return node.parentId ? (nodes[node.parentId]?.label ?? node.parentId) : ''
  const raw = (node as unknown as Record<string, unknown>)[key]
  if (raw === undefined || raw === null) return ''
  if (typeof raw === 'boolean') return raw ? 'true' : 'false'
  return String(raw)
}

function getRelProp(rel: C4Relation, key: string, nodes: Record<string, C4Node>): string {
  if (key === '_source')  return nodes[rel.sourceId]?.label ?? rel.sourceId
  if (key === '_target')  return nodes[rel.targetId]?.label ?? rel.targetId
  if (key === '_relType') return rel.relationType ?? 'interacts'
  const raw = (rel as unknown as Record<string, unknown>)[key]
  return raw !== undefined && raw !== null ? String(raw) : ''
}

// ─── Inline edit state ───────────────────────────────────────────────────────

interface EditCell {
  rowId: string
  colKey: string
  draft: string
}

// ─── Component ───────────────────────────────────────────────────────────────

export function TableView(): React.ReactElement {
  const nodes          = useDiagramStore((s) => s.c4Nodes)
  const relations      = useDiagramStore((s) => s.c4Relations)
  const updateNode     = useDiagramStore((s) => s.updateNode)
  const updateRelation = useDiagramStore((s) => s.updateRelation)
  const selectNode     = useDiagramStore((s) => s.selectNode)
  const selectEdge     = useDiagramStore((s) => s.selectEdge)
  const selectedNodeId = useDiagramStore((s) => s.selectedNodeId)
  const selectedEdgeId = useDiagramStore((s) => s.selectedEdgeId)
  const activeView     = useDiagramStore((s) => s.activeViewId ? s.views[s.activeViewId] : undefined)

  const [tab, setTab]           = useState<Tab>('all')
  const [editCell, setEditCell] = useState<EditCell | null>(null)

  const visibleNodeIds = useMemo<Set<string> | null>(() => {
    if (!activeView || activeView.nodeIds.length === 0) return null
    return new Set(activeView.nodeIds)
  }, [activeView])

  const nodeList = useMemo(() =>
    visibleNodeIds
      ? Object.values(nodes).filter(n => visibleNodeIds.has(n.id))
      : Object.values(nodes),
    [nodes, visibleNodeIds],
  )

  const adrList = useMemo(() => nodeList.filter(n => n.type === 'adr'), [nodeList])
  const ffList  = useMemo(() => nodeList.filter(n => n.type === 'fitness-fn'), [nodeList])

  const relList = useMemo(() =>
    visibleNodeIds
      ? Object.values(relations).filter(r => visibleNodeIds.has(r.sourceId) || visibleNodeIds.has(r.targetId))
      : Object.values(relations),
    [relations, visibleNodeIds],
  )

  const cols: ColDef[] =
    tab === 'adr'        ? ADR_COLS
    : tab === 'fitness-fn' ? FF_COLS
    : tab === 'relations'  ? REL_COLS
    : ALL_NODES_COLS

  const rows: (C4Node | C4Relation)[] =
    tab === 'adr'        ? adrList
    : tab === 'fitness-fn' ? ffList
    : tab === 'relations'  ? relList
    : nodeList

  const commitEdit = useCallback(() => {
    if (!editCell) return
    const { rowId, colKey, draft } = editCell
    if (tab === 'relations') {
      updateRelation(rowId, { [colKey]: draft || undefined } as Partial<C4Relation>)
    } else {
      if (colKey === 'label' || colKey === 'description' || colKey === 'technology') {
        updateNode(rowId, { [colKey]: draft || undefined } as Partial<C4Node>)
      } else {
        // governance property stored directly on node via Object.assign
        updateNode(rowId, { [colKey]: draft } as Parameters<typeof updateNode>[1])
      }
    }
    setEditCell(null)
  }, [editCell, tab, updateNode, updateRelation])

  const cancelEdit = useCallback(() => setEditCell(null), [])

  const startEdit = useCallback((rowId: string, colKey: string, current: string) => {
    setEditCell({ rowId, colKey, draft: current })
  }, [])

  const handleRowClick = useCallback((rowId: string) => {
    if (tab === 'relations') selectEdge(rowId)
    else selectNode(rowId)
  }, [tab, selectNode, selectEdge])

  const handleBoolToggle = useCallback((rowId: string, colKey: string, current: string) => {
    updateNode(rowId, { [colKey]: current !== 'true' } as Parameters<typeof updateNode>[1])
  }, [updateNode])

  function renderCell(row: C4Node | C4Relation, col: ColDef): React.ReactNode {
    const isNodeRow = tab !== 'relations'
    const rowId = row.id
    const rawVal = isNodeRow
      ? getNodeProp(row as C4Node, col.key, nodes)
      : getRelProp(row as C4Relation, col.key, nodes)
    const isEditing = editCell?.rowId === rowId && editCell?.colKey === col.key

    if (col.type === 'readonly') {
      if (col.key === '_type') {
        const nd = row as C4Node
        return (
          <span
            className="tv-type-badge"
            style={{
              background: NODE_COLORS[nd.type] ?? '#333',
              color: NODE_FG[nd.type] ?? '#fff',
            }}
          >
            {rawVal}
          </span>
        )
      }
      return <span className="tv-cell-readonly">{rawVal}</span>
    }

    if (col.type === 'boolean') {
      const checked = rawVal === 'true'
      return (
        <button
          className={`tv-bool ${checked ? 'tv-bool-on' : ''}`}
          onClick={(e) => { e.stopPropagation(); handleBoolToggle(rowId, col.key, rawVal) }}
          title={`${checked} — click to toggle`}
        >
          {checked ? '✓' : '—'}
        </button>
      )
    }

    if (isEditing) {
      if (col.type === 'enum') {
        return (
          <select
            autoFocus
            className="tv-cell-input"
            value={editCell!.draft}
            onChange={(e) => setEditCell({ ...editCell!, draft: e.target.value })}
            onBlur={commitEdit}
            onKeyDown={(e) => { if (e.key === 'Escape') cancelEdit() }}
            onClick={(e) => e.stopPropagation()}
          >
            {col.options!.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        )
      }
      if (col.type === 'textarea') {
        return (
          <textarea
            autoFocus
            className="tv-cell-textarea"
            value={editCell!.draft}
            onChange={(e) => setEditCell({ ...editCell!, draft: e.target.value })}
            onBlur={commitEdit}
            onKeyDown={(e) => {
              if (e.key === 'Escape') { e.stopPropagation(); cancelEdit() }
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitEdit() }
            }}
            onClick={(e) => e.stopPropagation()}
            rows={3}
          />
        )
      }
      return (
        <input
          autoFocus
          className="tv-cell-input"
          value={editCell!.draft}
          onChange={(e) => setEditCell({ ...editCell!, draft: e.target.value })}
          onBlur={commitEdit}
          onKeyDown={(e) => {
            if (e.key === 'Escape') cancelEdit()
            if (e.key === 'Enter') commitEdit()
            if (e.key === 'Tab') { e.preventDefault(); commitEdit() }
          }}
          onClick={(e) => e.stopPropagation()}
        />
      )
    }

    // Display mode — click to start editing
    return (
      <span
        className={`tv-cell-value ${col.type === 'textarea' ? 'tv-cell-multiline' : ''}`}
        onClick={(e) => { e.stopPropagation(); startEdit(rowId, col.key, rawVal) }}
        title={rawVal || 'Click to edit'}
      >
        {rawVal || <span className="tv-cell-placeholder">Click to edit…</span>}
      </span>
    )
  }

  const emptyMsg =
    tab === 'adr'        ? 'No ADRs in this model.' :
    tab === 'fitness-fn' ? 'No Fitness Functions in this model.' :
    tab === 'relations'  ? 'No relations.' :
                           'No nodes.'

  return (
    <div className="tv-wrap" onClick={() => setEditCell(null)}>
      {/* Tab bar */}
      <div className="tv-tabs">
        {TABS.map(t => {
          const count =
            t.id === 'all'        ? nodeList.length
            : t.id === 'adr'      ? adrList.length
            : t.id === 'fitness-fn' ? ffList.length
            : relList.length
          return (
            <button
              key={t.id}
              className={`tv-tab ${tab === t.id ? 'active' : ''}`}
              onClick={(e) => { e.stopPropagation(); setTab(t.id); setEditCell(null) }}
            >
              {t.label}
              <span className="tv-tab-count">{count}</span>
            </button>
          )
        })}
      </div>

      {/* Table */}
      <div className="tv-table-wrap">
        <table className="tv-table">
          <colgroup>
            {cols.map(c => <col key={c.key} style={{ width: c.width }} />)}
          </colgroup>
          <thead>
            <tr>
              {cols.map(c => (
                <th key={c.key} className="tv-th">{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td className="tv-empty" colSpan={cols.length}>{emptyMsg}</td>
              </tr>
            )}
            {rows.map((row) => {
              const isNodeRow = tab !== 'relations'
              const isSelected = isNodeRow ? selectedNodeId === row.id : selectedEdgeId === row.id
              return (
                <tr
                  key={row.id}
                  className={`tv-row ${isSelected ? 'tv-row-selected' : ''}`}
                  onClick={(e) => { e.stopPropagation(); handleRowClick(row.id) }}
                >
                  {cols.map(col => (
                    <td key={col.key} className="tv-td">
                      {renderCell(row, col)}
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
