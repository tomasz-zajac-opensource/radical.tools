import React, { useState, useCallback, useMemo } from 'react'
import { useDiagramStore } from '../store/diagramStore'
import type { C4Node, C4Relation, C4ElementType } from '../types/c4'
import { NODE_COLORS, NODE_FG, TYPE_LABELS, NODE_SIZES } from '../types/c4'
import { isParentAllowed } from '../types/metamodel'

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

// ─── Tree ordering helper ────────────────────────────────────────────────────

interface TreeRow {
  node: C4Node
  depth: number
}

function buildTreeRows(nodeList: C4Node[]): TreeRow[] {
  const byParent = new Map<string | null, C4Node[]>()
  for (const n of nodeList) {
    const key = n.parentId ?? null
    if (!byParent.has(key)) byParent.set(key, [])
    byParent.get(key)!.push(n)
  }
  const result: TreeRow[] = []
  function walk(parentId: string | null, depth: number) {
    const children = byParent.get(parentId) ?? []
    for (const n of children) {
      result.push({ node: n, depth })
      walk(n.id, depth + 1)
    }
  }
  walk(null, 0)
  // append any orphans not visited (broken parentId refs)
  const visited = new Set(result.map(r => r.node.id))
  for (const n of nodeList) {
    if (!visited.has(n.id)) result.push({ node: n, depth: 0 })
  }
  return result
}

// ─── Component ───────────────────────────────────────────────────────────────

export function TableView(): React.ReactElement {
  const nodes            = useDiagramStore((s) => s.c4Nodes)
  const relations        = useDiagramStore((s) => s.c4Relations)
  const updateNode       = useDiagramStore((s) => s.updateNode)
  const updateRelation   = useDiagramStore((s) => s.updateRelation)
  const selectNode       = useDiagramStore((s) => s.selectNode)
  const selectEdge       = useDiagramStore((s) => s.selectEdge)
  const selectedNodeId   = useDiagramStore((s) => s.selectedNodeId)
  const selectedEdgeId   = useDiagramStore((s) => s.selectedEdgeId)
  const activeViewId     = useDiagramStore((s) => s.activeViewId)
  const activeView       = useDiagramStore((s) => s.activeViewId ? s.views[s.activeViewId] : undefined)
  const addNodeToView    = useDiagramStore((s) => s.addNodeToView)
  const addNode          = useDiagramStore((s) => s.addNode)
  const pushNotification = useDiagramStore((s) => s.pushNotification)

  const [tab, setTab]             = useState<Tab>('all')
  const [editCell, setEditCell]   = useState<EditCell | null>(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const [dropParentId, setDropParentId] = useState<string | null>(null)
  const [dragKind, setDragKind] = useState<'new' | 'existing' | null>(null)

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

  const treeRows = useMemo<TreeRow[]>(() =>
    tab === 'all' ? buildTreeRows(nodeList) : [],
    [tab, nodeList],
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
    : treeRows.map(r => r.node)

  const depthMap = useMemo<Map<string, number>>(() => {
    const m = new Map<string, number>()
    for (const r of treeRows) m.set(r.node.id, r.depth)
    return m
  }, [treeRows])

  const onDragOver = useCallback((e: React.DragEvent) => {
    const types = Array.from(e.dataTransfer.types)
    const isNew = types.includes('application/c4-type')
    const isExisting = types.includes('application/c4-node-id')
    if (!isNew && !isExisting) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    setIsDragOver(true)
    setDragKind(isNew ? 'new' : 'existing')
    if (isNew) {
      // Highlight the row under the cursor — it will become the parent.
      const rowEl = (e.target as HTMLElement).closest('.tv-row') as HTMLElement | null
      const id = rowEl?.dataset.nodeId ?? null
      setDropParentId(id)
    } else {
      setDropParentId(null)
    }
  }, [])

  const onDragLeave = useCallback((e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragOver(false)
      setDropParentId(null)
      setDragKind(null)
    }
  }, [])

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
    setDropParentId(null)
    setDragKind(null)

    // ── Case 1: new node dragged from the palette/toolbar ──────────────────
    const typeStr = e.dataTransfer.getData('application/c4-type')
    if (typeStr) {
      const size = NODE_SIZES[typeStr as C4ElementType] ?? { width: 200, height: 100 }
      const mm = useDiagramStore.getState().metamodel
      const def = mm?.nodeTypes[typeStr]
      const label = def?.label ?? (typeStr[0].toUpperCase() + typeStr.slice(1))
      const allowedParents = def?.allowedParents ?? []

      // Detect the table row under the drop point — its node is the candidate parent.
      const rowEl = (e.target as HTMLElement).closest('.tv-row') as HTMLElement | null
      const dropOnNodeId = rowEl?.dataset.nodeId
      const dropOnNode = dropOnNodeId ? nodes[dropOnNodeId] : undefined

      let parentId: string | undefined = undefined
      if (dropOnNode) {
        if (isParentAllowed(mm, typeStr, dropOnNode.type)) {
          // Dropped onto a valid parent row.
          parentId = dropOnNode.id
        } else if (dropOnNode.parentId && isParentAllowed(mm, typeStr, nodes[dropOnNode.parentId]?.type)) {
          // Dropped onto a sibling row — inherit its (valid) parent.
          parentId = dropOnNode.parentId
        } else {
          const allowedStr = allowedParents.length
            ? allowedParents.map(t => mm?.nodeTypes[t]?.label ?? t).join(', ')
            : 'the model root'
          pushNotification(
            `Cannot place ${label} on "${dropOnNode.label}". Drop it onto a ${allowedStr} row.`,
            'error',
          )
          return
        }
      } else if (!isParentAllowed(mm, typeStr, undefined)) {
        // Dropped on empty area but this type needs a parent.
        const allowedStr = allowedParents.length
          ? allowedParents.map(t => mm?.nodeTypes[t]?.label ?? t).join(', ')
          : 'a parent'
        pushNotification(
          `${label} must be dropped onto a ${allowedStr} row.`,
          'error',
        )
        return
      }

      // addNode validates parent/cardinality (pushes its own error toast on
      // failure) and auto-adds the created node to the active view.
      const newId = addNode({
        type: typeStr as C4ElementType,
        label,
        description: '',
        technology: '',
        collapsed: false,
        external: false,
        parentId,
        x: 0,
        y: 0,
        ...size,
      })
      if (newId) {
        const where = parentId ? ` inside "${nodes[parentId]?.label ?? parentId}"` : ''
        pushNotification(`${label} added to the model${where}.`, 'info')
      }
      return
    }

    // ── Case 2: existing node dragged from the Nodes panel → add to view ───
    const nodeId = e.dataTransfer.getData('application/c4-node-id')
    if (!nodeId || !activeViewId || !activeView) return

    const node = nodes[nodeId]
    if (!node) { pushNotification('Node not found.', 'error'); return }

    if (activeView.nodeIds.includes(nodeId)) {
      pushNotification(`"${node.label}" is already in this view.`, 'warning')
      return
    }
    addNodeToView(activeViewId, nodeId)
    pushNotification(`"${node.label}" added to view.`, 'info')
  }, [activeViewId, activeView, nodes, addNode, addNodeToView, pushNotification])

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

  function renderCell(row: C4Node | C4Relation, col: ColDef, depth = 0): React.ReactNode {
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
    const indent = tab === 'all' && col.key === 'label' && depth > 0
    return (
      <span
        className={`tv-cell-value ${col.type === 'textarea' ? 'tv-cell-multiline' : ''}`}
        onClick={(e) => { e.stopPropagation(); startEdit(rowId, col.key, rawVal) }}
        title={rawVal || 'Click to edit'}
        style={indent ? { paddingLeft: depth * 16 + 4, display: 'flex', alignItems: 'center', gap: 4 } : undefined}
      >
        {indent && <span className="tv-tree-indent" style={{ color: 'var(--text-muted)', flexShrink: 0 }}>{'└'}</span>}
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
    <div
      className={`tv-wrap${isDragOver ? ' tv-drop-active' : ''}`}
      onClick={() => setEditCell(null)}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {/* Drop overlay */}
      {isDragOver && (
        dragKind === 'new' && dropParentId && nodes[dropParentId] ? (
          // Hovering a specific row — show a compact pill, keep the row visible.
          <div className="tv-drop-pill">
            <span className="tv-drop-icon">＋</span>
            <span>Add inside <strong>{nodes[dropParentId].label}</strong></span>
          </div>
        ) : (
          <div className="tv-drop-overlay">
            <div className="tv-drop-overlay-inner">
              <span className="tv-drop-icon">＋</span>
              <span>
                {dragKind === 'existing'
                  ? 'Drop to add to view'
                  : 'Drop onto a row to nest, or here to add at root'}
              </span>
            </div>
          </div>
        )
      )}

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
              const depth = tab === 'all' ? (depthMap.get(row.id) ?? 0) : 0
              return (
                <tr
                  key={row.id}
                  data-node-id={isNodeRow ? row.id : undefined}
                  className={`tv-row ${isSelected ? 'tv-row-selected' : ''}${dropParentId === row.id ? ' tv-row-drop-parent' : ''}`}
                  onClick={(e) => { e.stopPropagation(); handleRowClick(row.id) }}
                >
                  {cols.map(col => (
                    <td key={col.key} className="tv-td">
                      {renderCell(row, col, depth)}
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
