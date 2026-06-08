import React, { useCallback, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useHubStore, type HubConcept } from '../store/hubStore'
import { useDiagramStore } from '../store/diagramStore'
import type { C4Node, C4Relation, C4ElementType } from '../types/c4'
import { NODE_SIZES } from '../types/c4'

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
    background: '#1e1e2e',
    borderRadius: 12,
    width: '94vw',
    maxWidth: 800,
    maxHeight: '80vh',
    display: 'flex',
    flexDirection: 'column' as const,
    boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
    color: '#e0e0e0',
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '16px 20px 12px',
    borderBottom: '1px solid #333',
  },
  title: {
    margin: 0,
    fontSize: 18,
    fontWeight: 600,
    color: '#fff',
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    color: '#888',
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
    borderBottom: '1px solid #2a2a3a',
  },
  pill: (active: boolean) => ({
    padding: '5px 12px',
    borderRadius: 16,
    border: 'none',
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: active ? 600 : 400,
    background: active ? '#2563eb' : '#2a2a3a',
    color: active ? '#fff' : '#bbb',
    transition: 'background 0.15s, color 0.15s',
  }),
  searchInput: {
    flex: 1,
    minWidth: 160,
    padding: '6px 12px',
    borderRadius: 8,
    border: '1px solid #444',
    background: '#2a2a3a',
    color: '#e0e0e0',
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
    background: '#2a2a3a',
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
    color: '#fff',
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
    color: '#aaa',
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
    background: '#383848',
    color: '#ccc',
    cursor: 'pointer',
  },
  importBtn: {
    alignSelf: 'flex-end' as const,
    padding: '6px 16px',
    borderRadius: 6,
    border: 'none',
    background: '#2563eb',
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
    color: '#888',
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

  const activeMetamodelId = useDiagramStore((s) => s.metamodel?.id)

  const handleImport = useCallback(
    (concept: HubConcept) => {
      const store = useDiagramStore.getState()

      // Map old concept node IDs → new store IDs.
      const idMap = new Map<string, string>()

      // Determine a rough center to place nodes at.
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

      // Build node objects with remapped IDs.
      const newNodes: Record<string, C4Node> = {}
      for (const raw of concept.nodes) {
        const oldId = raw.id as string
        const newId = idMap.get(oldId)!
        const type = (raw.type as C4ElementType) ?? 'component'
        const defaults = NODE_SIZES[type as keyof typeof NODE_SIZES] ?? { width: 200, height: 120 }

        const node: C4Node = {
          id: newId,
          type,
          label: (raw.label as string) ?? concept.name,
          description: (raw.description as string) ?? undefined,
          technology: (raw.technology as string) ?? undefined,
          collapsed: (raw.collapsed as boolean) ?? false,
          x: centerX + (Math.random() - 0.5) * 100,
          y: centerY + (Math.random() - 0.5) * 100,
          width: (raw.width as number) ?? defaults.width,
          height: (raw.height as number) ?? defaults.height,
        }

        if (raw.parentId && idMap.has(raw.parentId as string)) {
          node.parentId = idMap.get(raw.parentId as string)
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
      store._sync()

      store.pushNotification(`Imported "${concept.name}"`, 'info')
      onClose()
    },
    [onClose],
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
            <span style={{ color: '#888' }}>Tag:</span>
            <span style={{ ...S.tag, background: '#2563eb', color: '#fff' }}>{activeTag}</span>
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
          {error && <div style={{ ...S.center, color: '#f87171' }}>⚠ {error}</div>}
          {!loading && !error && concepts.length === 0 && (
            <div style={S.center}>No concepts match your filters.</div>
          )}

          {concepts.map((c) => {
            const metamodelMismatch =
              c.requiredMetamodel && activeMetamodelId && c.requiredMetamodel !== activeMetamodelId
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
                  </div>
                  <button
                    type="button"
                    style={S.importBtn}
                    onClick={() => handleImport(c)}
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
                          ...(activeTag === t ? { background: '#2563eb', color: '#fff' } : {}),
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
      </div>
    </div>,
    document.body,
  )
}
