import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useHubStore, type HubConcept, type TemplateParam, type HubImportRecord } from '../store/hubStore'
import { useDiagramStore } from '../store/diagramStore'
import type { C4Node, C4Relation, C4ElementType } from '../types/c4'
import { NODE_SIZES } from '../types/c4'
import { isParentAllowed } from '../types/metamodel'

// ─── Props ──────────────────────────────────────────────────────────────────

interface Props {
  open: boolean
  onClose: () => void
}

// ─── Category helpers ───────────────────────────────────────────────────────

const CATEGORY_ICON: Record<string, string> = {
  pattern: '🏗️',
  'fitness-function': '🎯',
  requirement: '📋',
  adr: '📄',
}

const CATEGORY_LABEL: Record<string, string> = {
  pattern: 'Patterns',
  'fitness-function': 'Fitness Fns',
  requirement: 'Requirements',
  adr: 'ADRs',
}

const CATEGORIES = ['pattern', 'fitness-function', 'requirement', 'adr'] as const

// ─── Styles ─────────────────────────────────────────────────────────────────

const S = {
  backdrop: {
    position: 'fixed' as const,
    inset: 0,
    background: 'rgba(0,0,0,0.55)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9000,
  },
  modal: {
    position: 'relative' as const,
    background: 'var(--bg-panel)',
    borderRadius: 12,
    width: '96vw',
    maxWidth: '96vw',
    maxHeight: '88vh',
    display: 'flex',
    flexDirection: 'column' as const,
    boxShadow: 'var(--shadow-lg)',
    color: 'var(--text-primary)',
    overflow: 'hidden',
  },
  templateOverlay: {
    position: 'absolute' as const,
    inset: 0,
    background: 'var(--bg-panel)',
    display: 'flex',
    flexDirection: 'column' as const,
    zIndex: 10,
  },
  templateHeader: {
    padding: '16px 20px 12px',
    borderBottom: '1px solid var(--border-color)',
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  templateBody: {
    flex: 1,
    overflowY: 'auto' as const,
    padding: '20px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 16,
  },
  templateField: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 6,
  },
  templateLabel: {
    fontSize: 13,
    fontWeight: 500,
    color: 'var(--text-primary)',
  },
  templateHint: {
    fontSize: 11,
    color: 'var(--text-muted)',
    marginTop: 2,
  },
  templateInput: {
    padding: '8px 12px',
    borderRadius: 6,
    border: '1px solid var(--border-color)',
    background: 'var(--input-bg)',
    color: 'var(--text-primary)',
    fontSize: 14,
    outline: 'none',
  },
  templateFooter: {
    display: 'flex',
    gap: 8,
    justifyContent: 'flex-end',
    padding: '12px 20px 16px',
    borderTop: '1px solid var(--border-color)',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '16px 20px 12px',
    borderBottom: '1px solid var(--border-color)',
  },
  title: {
    margin: 0,
    fontSize: 18,
    fontWeight: 600,
    color: 'var(--text-primary)',
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    color: 'var(--text-muted)',
    fontSize: 20,
    cursor: 'pointer',
    padding: '2px 6px',
    borderRadius: 4,
    lineHeight: 1,
  },
  filterBar: {
    display: 'flex',
    gap: 8,
    padding: '12px 20px',
    flexWrap: 'wrap' as const,
    alignItems: 'center',
    borderBottom: '1px solid var(--border-color)',
  },
  pill: (active: boolean) => ({
    padding: '5px 12px',
    borderRadius: 16,
    border: 'none',
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: active ? 600 : 400,
    background: active ? 'var(--accent)' : 'var(--input-bg)',
    color: active ? '#fff' : 'var(--text-secondary)',
    transition: 'background 0.15s, color 0.15s',
  }),
  searchInput: {
    flex: 1,
    minWidth: 160,
    padding: '6px 12px',
    borderRadius: 8,
    border: '1px solid var(--border-color)',
    background: 'var(--input-bg)',
    color: 'var(--text-primary)',
    fontSize: 13,
    outline: 'none',
  },
  list: {
    flex: 1,
    overflowY: 'auto' as const,
    padding: '12px 20px 20px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 10,
  },
  card: {
    background: 'var(--hover-bg)',
    borderRadius: 8,
    padding: '14px 16px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 8,
  },
  cardHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    justifyContent: 'space-between',
  },
  cardName: {
    fontSize: 15,
    fontWeight: 600,
    color: 'var(--text-primary)',
    margin: 0,
  },
  badge: (bg: string) => ({
    fontSize: 11,
    padding: '2px 8px',
    borderRadius: 10,
    background: bg,
    color: '#fff',
    fontWeight: 500,
    whiteSpace: 'nowrap' as const,
  }),
  cardDesc: {
    fontSize: 13,
    color: 'var(--text-secondary)',
    margin: 0,
    lineHeight: 1.45,
  },
  tagRow: {
    display: 'flex',
    flexWrap: 'wrap' as const,
    gap: 5,
    alignItems: 'center',
  },
  tag: {
    fontSize: 11,
    padding: '2px 8px',
    borderRadius: 10,
    background: 'var(--input-bg)',
    color: 'var(--text-secondary)',
    cursor: 'pointer',
  },
  importBtn: {
    alignSelf: 'flex-end' as const,
    padding: '6px 16px',
    borderRadius: 6,
    border: 'none',
    background: 'var(--accent)',
    color: '#fff',
    fontSize: 13,
    fontWeight: 500,
    cursor: 'pointer',
  },
  center: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
    color: 'var(--text-muted)',
    fontSize: 14,
  },
  warning: {
    fontSize: 11,
    padding: '2px 8px',
    borderRadius: 10,
    background: '#92400e',
    color: '#fde68a',
    fontWeight: 500,
    whiteSpace: 'nowrap' as const,
  },
} as const

const CATEGORY_BADGE_COLORS: Record<string, string> = {
  pattern: '#6d28d9',
  'fitness-function': '#5b21b6',
  requirement: '#0e7490',
  adr: '#92400e',
}

// ─── Template substitution ──────────────────────────────────────────────────

/** Replace all {{KEY}} tokens in a string with values from the provided map. */
function substituteParams(str: string, values: Record<string, string>): string {
  return str.replace(/\{\{([A-Z0-9_]+)\}\}/g, (_, key: string) => values[key] ?? `{{${key}}}`)
}

/** Return a copy of the concept with {{KEY}} tokens substituted in all node string fields. */
function applyTemplate(concept: HubConcept, values: Record<string, string>): HubConcept {
  if (!concept.templateParams?.length) return concept
  const subst = (node: Record<string, unknown>): Record<string, unknown> => {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(node)) {
      out[k] = typeof v === 'string' ? substituteParams(v, values) : v
    }
    return out
  }
  return { ...concept, nodes: concept.nodes.map(subst) }
}

// ─── Component ──────────────────────────────────────────────────────────────

export function HubImportModal({ open, onClose }: Props): React.ReactElement | null {
  const {
    loading,
    error,
    activeCategory,
    searchQuery,
    activeTag,
    fetchConcepts,
    setCategory,
    setSearch,
    setTag,
    resetFilters,
    filteredConcepts,
  } = useHubStore()

  // Fetch on open (respects cache).
  useEffect(() => {
    if (open) fetchConcepts()
  }, [open, fetchConcepts])

  // Esc to close.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // Reset filters when opening.
  useEffect(() => {
    if (open) resetFilters()
  }, [open, resetFilters])

  const concepts = useMemo(() => (open ? filteredConcepts() : []), [
    open,
    filteredConcepts,
    activeCategory,
    searchQuery,
    activeTag,
  ])

  // Template parameter fill state: set when user clicks "Add to Model" on a
  // concept that has templateParams.
  const [pendingConcept, setPendingConcept] = useState<HubConcept | null>(null)
  const [paramValues, setParamValues] = useState<Record<string, string>>({})

  // Initialise default values whenever a new concept is pending.
  useEffect(() => {
    if (!pendingConcept?.templateParams) return
    const defaults: Record<string, string> = {}
    for (const p of pendingConcept.templateParams) {
      defaults[p.key] = p.defaultValue ?? ''
    }
    setParamValues(defaults)
  }, [pendingConcept])

  const activeMetamodelId = useDiagramStore((s) => s.metamodel?.id)
  const metamodel       = useDiagramStore((s) => s.metamodel)
  const selectedNodeId  = useDiagramStore((s) => s.selectedNodeId)
  const c4Nodes         = useDiagramStore((s) => s.c4Nodes)

  // If a node is selected, check whether a concept's root nodes can all be
  // placed inside it. Returns 'ok' | 'incompatible' | null (no selection).
  const getDropTarget = useCallback((concept: HubConcept): 'ok' | 'incompatible' | null => {
    if (!selectedNodeId) return null
    const parentNode = c4Nodes[selectedNodeId]
    if (!parentNode) return null
    const rootTypes = concept.nodes
      .filter((n) => !n.parentId)
      .map((n) => (n.type as string) ?? 'component')
    const allAllowed = rootTypes.every((t) => isParentAllowed(metamodel, t, parentNode.type))
    return allAllowed ? 'ok' : 'incompatible'
  }, [selectedNodeId, c4Nodes, metamodel])

  const handleImport = useCallback(
    (concept: HubConcept, templateData?: { originalConcept: HubConcept; paramValues: Record<string, string> }) => {
      const store = useDiagramStore.getState()

      // Map old concept node IDs → new store IDs.
      const idMap = new Map<string, string>()

      // If a compatible node is selected, we'll import root nodes as its children.
      const dropParentId = store.selectedNodeId ?? null
      const dropParent   = dropParentId ? store.c4Nodes[dropParentId] ?? null : null
      const useDropParent =
        dropParent !== null &&
        concept.nodes
          .filter((n) => !n.parentId)
          .every((n) => isParentAllowed(store.metamodel, (n.type as string) ?? 'component', dropParent.type))

      // Determine the viewport center in canvas coordinates.
      const getViewport = (window as any).__rfGetViewport as
        | (() => { x: number; y: number; zoom: number })
        | undefined
      const vp = getViewport?.() ?? { x: 0, y: 0, zoom: 1 }
      const centerX = (-vp.x + window.innerWidth / 2) / vp.zoom
      const centerY = (-vp.y + window.innerHeight / 2) / vp.zoom

      // Pre-generate IDs for all nodes so parent references resolve
      // regardless of ordering in hub-data.json.
      for (const raw of concept.nodes) {
        idMap.set(raw.id as string, crypto.randomUUID())
      }

      // Compute the bounding-box of root nodes (no parentId) using the raw
      // positions stored in hub-data. Child-node positions are already
      // relative to their parent in hub-data, so they must NOT be shifted.
      const rootNodes = concept.nodes.filter((n) => !n.parentId)
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
      for (const n of rootNodes) {
        const rx = (n.x as number) ?? 0
        const ry = (n.y as number) ?? 0
        const rw = (n.width as number) ?? 200
        const rh = (n.height as number) ?? 120
        if (rx < minX) minX = rx
        if (ry < minY) minY = ry
        if (rx + rw > maxX) maxX = rx + rw
        if (ry + rh > maxY) maxY = ry + rh
      }
      // Offset that shifts the root-node cluster to land on the viewport center.
      const clusterW = maxX - minX
      const clusterH = maxY - minY
      const offsetX = isFinite(minX) ? centerX - minX - clusterW / 2 : centerX
      const offsetY = isFinite(minY) ? centerY - minY - clusterH / 2 : centerY

      // Build node objects with remapped IDs.
      const newNodes: Record<string, C4Node> = {}
      for (const raw of concept.nodes) {
        const oldId = raw.id as string
        const newId = idMap.get(oldId)!
        const type = (raw.type as C4ElementType) ?? 'component'
        const defaults = NODE_SIZES[type as keyof typeof NODE_SIZES] ?? { width: 200, height: 120 }
        const isChild = !!raw.parentId

        const node: C4Node = {
          // Spread all raw fields first so metamodel-specific fields (ears_type, action,
          // rationale, precondition, trigger, unwanted_condition, feature, status, priority,
          // etc.) are preserved. Structural fields below override any raw values.
          ...(raw as Record<string, unknown>),
          id: newId,
          type,
          label: (raw.label as string) ?? concept.name,
          description: (raw.description as string) ?? undefined,
          technology: (raw.technology as string) ?? undefined,
          collapsed: (raw.collapsed as boolean) ?? false,
          // parentId is intentionally omitted here — handled below after ID remapping.
          parentId: undefined,
          // Children: keep hub-data relative coords as-is (they're relative to their concept-parent).
          // Roots dropped into a selected parent: use hub-data positions as relative coords inside the new parent.
          // Roots without a drop target: apply the viewport centering offset.
          x: isChild ? ((raw.x as number) ?? 20)
            : useDropParent ? ((raw.x as number) ?? 20)
            : ((raw.x as number) ?? 0) + offsetX,
          y: isChild ? ((raw.y as number) ?? 20)
            : useDropParent ? ((raw.y as number) ?? 20)
            : ((raw.y as number) ?? 0) + offsetY,
          width: (raw.width as number) ?? defaults.width,
          height: (raw.height as number) ?? defaults.height,
        } as C4Node

        if (raw.parentId && idMap.has(raw.parentId as string)) {
          node.parentId = idMap.get(raw.parentId as string)
        } else if (!raw.parentId && useDropParent && dropParentId) {
          // Root node → reparent under the selected canvas node.
          node.parentId = dropParentId
        }

        newNodes[newId] = node
      }

      // Build relation objects with remapped IDs.
      const newRelations: Record<string, C4Relation> = {}
      if (concept.relations) {
        for (const raw of concept.relations) {
          const srcId = idMap.get(raw.sourceId as string)
          const dstId = idMap.get(raw.targetId as string)
          if (!srcId || !dstId) continue
          const relId = crypto.randomUUID()
          newRelations[relId] = {
            id: relId,
            sourceId: srcId,
            targetId: dstId,
            label: (raw.label as string) ?? undefined,
            technology: (raw.technology as string) ?? undefined,
            relationType: (raw.relationType as string) ?? undefined,
          }
        }
      }

      // Single undo + bulk insert — bypasses per-node metamodel validation
      // so curated hub concepts always import cleanly.
      store._pushUndo()
      store._markMilestoneEdit()
      useDiagramStore.setState((state) => {
        Object.assign(state.c4Nodes, newNodes)
        Object.assign(state.c4Relations, newRelations)
        if (state.activeViewId && state.views[state.activeViewId]) {
          state.views[state.activeViewId].nodeIds.push(...Object.keys(newNodes))
        }
      })

      // Resize all parent nodes bottom-up so that any parent (including the
      // drop-target and any concept-internal parents) visually contains its
      // newly added children without needing an auto-layout run.
      {
        const storeAfter = useDiagramStore.getState()
        const view = storeAfter.activeViewId ? storeAfter.views[storeAfter.activeViewId] : undefined
        const vf = view ? new Set(view.nodeIds) : undefined
        storeAfter._resizeParentsBottomUp(vf)
      }

      store._sync()

      // Persist hub template record so values can be reconfigured later.
      if (templateData && concept.templateParams?.length) {
        const importId = crypto.randomUUID()
        const originalNodesMap: Record<string, Record<string, unknown>> = {}
        for (const origNode of templateData.originalConcept.nodes) {
          const newId = idMap.get(origNode.id as string)
          if (newId) originalNodesMap[newId] = origNode as Record<string, unknown>
        }
        const record: HubImportRecord = {
          conceptId: concept.id,
          conceptName: concept.name,
          templateParams: concept.templateParams,
          paramValues: { ...templateData.paramValues },
          nodeIds: Object.keys(newNodes),
          originalNodes: originalNodesMap,
        }
        store.upsertHubTemplate(importId, record)
      }

      store.pushNotification(
        useDropParent
          ? `Imported "${concept.name}" into "${dropParent!.label}"`
          : `Imported "${concept.name}"`,
        'info',
      )
      onClose()
    },
    [onClose],
  )

  // Clicking "Add to Model": show template fill form if the concept has params,
  // otherwise import immediately.
  const handleImportClick = useCallback(
    (concept: HubConcept) => {
      if (concept.templateParams?.length) {
        setPendingConcept(concept)
      } else {
        handleImport(concept)
      }
    },
    [handleImport],
  )

  if (!open) return null

  return createPortal(
    <div
      style={S.backdrop}
      onMouseDown={(e) => {
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
        style={S.modal}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Import from Hub"
      >
        {/* ── Header ─────────────────────────────────────────────────── */}
        <div style={S.header}>
          <h3 style={S.title}>Import from Hub</h3>
          <button
            type="button"
            style={S.closeBtn}
            onClick={onClose}
            aria-label="Close"
            title="Close (Esc)"
          >
            ✕
          </button>
        </div>

        {/* ── Filter bar ─────────────────────────────────────────────── */}
        <div style={S.filterBar}>
          <button
            style={S.pill(activeCategory === null)}
            onClick={() => setCategory(null)}
          >
            All
          </button>
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              style={S.pill(activeCategory === cat)}
              onClick={() => setCategory(cat)}
            >
              {CATEGORY_ICON[cat]} {CATEGORY_LABEL[cat]}
            </button>
          ))}
          <input
            style={S.searchInput}
            type="text"
            placeholder="Search concepts…"
            value={searchQuery}
            onChange={(e) => setSearch(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </div>

        {/* ── Active tag filter indicator ─────────────────────────────── */}
        {activeTag && (
          <div style={{ padding: '6px 20px 0', display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
            <span style={{ color: 'var(--text-muted)' }}>Tag:</span>
            <span style={{ ...S.tag, background: 'var(--accent)', color: '#fff' }}>{activeTag}</span>
            <button
              type="button"
              style={{ ...S.closeBtn, fontSize: 14, padding: '0 4px' }}
              onClick={() => setTag(null)}
              title="Clear tag filter"
            >
              ✕
            </button>
          </div>
        )}

        {/* ── Content ────────────────────────────────────────────────── */}
        <div style={S.list}>
          {loading && <div style={S.center}>Loading hub data…</div>}
          {error && <div style={{ ...S.center, color: 'var(--danger)' }}>⚠ {error}</div>}
          {!loading && !error && concepts.length === 0 && (
            <div style={S.center}>No concepts match your filters.</div>
          )}

          {concepts.map((c) => {
            const metamodelMismatch =
              c.requiredMetamodel && activeMetamodelId && c.requiredMetamodel !== activeMetamodelId
            const dropTarget = getDropTarget(c)
            const selectedNodeLabel = selectedNodeId ? c4Nodes[selectedNodeId]?.label : null
            return (
              <div key={c.id} style={S.card}>
                <div style={S.cardHeader}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <h4 style={S.cardName}>
                      {CATEGORY_ICON[c.category]} {c.name}
                    </h4>
                    <span style={S.badge(CATEGORY_BADGE_COLORS[c.category] ?? '#555')}>
                      {CATEGORY_LABEL[c.category] ?? c.category}
                    </span>
                    {metamodelMismatch && (
                      <span style={S.warning} title={`Requires metamodel: ${c.requiredMetamodel}`}>
                        ⚠ metamodel
                      </span>
                    )}
                    {dropTarget === 'ok' && selectedNodeLabel && (
                      <span style={{ ...S.badge('#065f46'), maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis' }}
                        title={`Will be added inside "${selectedNodeLabel}"`}>
                        ↳ {selectedNodeLabel}
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    style={S.importBtn}
                    onClick={() => handleImportClick(c)}
                  >
                    Add to Model
                  </button>
                </div>
                <p style={S.cardDesc}>{c.description}</p>
                {c.tags.length > 0 && (
                  <div style={S.tagRow}>
                    {c.tags.map((t) => (
                      <span
                        key={t}
                        style={{
                          ...S.tag,
                          ...(activeTag === t ? { background: 'var(--accent)', color: '#fff' } : {}),
                        }}
                        onClick={() => setTag(activeTag === t ? null : t)}
                        role="button"
                        tabIndex={0}
                        title={`Filter by tag "${t}"`}
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* ── Template parameter fill overlay ─────────────────────────── */}
        {pendingConcept && (
          <div style={S.templateOverlay}>
            <div style={S.templateHeader}>
              <div>
                <h3 style={S.title}>Configure: {pendingConcept.name}</h3>
                <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>
                  Fill in the template parameters before importing.
                </p>
              </div>
              <button
                type="button"
                style={S.closeBtn}
                onClick={() => setPendingConcept(null)}
                aria-label="Cancel template"
              >
                ✕
              </button>
            </div>

            <div style={S.templateBody}>
              {(pendingConcept.templateParams ?? []).map((p: TemplateParam) => (
                <div key={p.key} style={S.templateField}>
                  <label style={S.templateLabel}>{p.label}</label>
                  <input
                    style={S.templateInput}
                    type={p.type === 'number' ? 'number' : 'text'}
                    placeholder={p.hint ?? ''}
                    value={paramValues[p.key] ?? ''}
                    onChange={(e) =>
                      setParamValues((prev) => ({ ...prev, [p.key]: e.target.value }))
                    }
                    autoComplete="off"
                    spellCheck={false}
                  />
                  {p.hint && <span style={S.templateHint}>e.g. {p.hint}</span>}
                </div>
              ))}
            </div>

            <div style={S.templateFooter}>
              <button
                type="button"
                style={{ ...S.importBtn, background: 'var(--input-bg)', color: 'var(--text-secondary)' }}
                onClick={() => setPendingConcept(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                style={S.importBtn}
                onClick={() => {
                  const originalConcept = pendingConcept
                  const resolved = applyTemplate(pendingConcept, paramValues)
                  setPendingConcept(null)
                  handleImport(resolved, { originalConcept, paramValues: { ...paramValues } })
                }}
              >
                Import
              </button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
