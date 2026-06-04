import React, { useMemo, useState, useRef, useEffect, useLayoutEffect } from 'react'
import { useDiagramStore } from '../store/diagramStore'
import { isParentAllowed, PropertyDef } from '../types/metamodel'
import {
  C4Node,
  C4Relation,
  C4ElementType,
  NODE_COLORS,
  NODE_FG,
  TYPE_LABELS,
  TYPE_ICON_PATHS,
} from '../types/c4'

type Metamodel = ReturnType<typeof useDiagramStore.getState>['metamodel']
type UpdateNode = ReturnType<typeof useDiagramStore.getState>['updateNode']
type UpdateRelation = ReturnType<typeof useDiagramStore.getState>['updateRelation']
type TypeMeta = (type: string) => { label: string; color: string; fg: string; iconPath: string }

// Resolve display metadata for a node type, preferring the document metamodel
// (supports custom types) and falling back to the built-in C4 constants.
function useTypeMeta(): TypeMeta {
  const metamodel = useDiagramStore((s) => s.metamodel)
  return useMemo(() => {
    return (type: string) => {
      const def = metamodel?.nodeTypes?.[type]
      return {
        label: def?.label ?? TYPE_LABELS[type as C4ElementType] ?? type,
        color: def?.color ?? NODE_COLORS[type as C4ElementType] ?? '#334155',
        fg: def?.fg ?? NODE_FG[type as C4ElementType] ?? '#fff',
        iconPath: def?.iconPath ?? TYPE_ICON_PATHS[type as C4ElementType] ?? '',
      }
    }
  }, [metamodel])
}

function TypeChip({ type, typeMeta }: { type: string; typeMeta: TypeMeta }): React.ReactElement {
  const meta = typeMeta(type)
  return (
    <span
      className="wiki-chip"
      style={{ background: `${meta.color}1f`, color: meta.color, borderColor: `${meta.color}55` }}
    >
      {meta.iconPath && (
        <svg viewBox="0 0 16 16" width="11" height="11" fill={meta.color}>
          <path d={meta.iconPath} />
        </svg>
      )}
      {meta.label}
    </span>
  )
}

export function WikiView(): React.ReactElement {
  const views = useDiagramStore((s) => s.views)
  const activeViewId = useDiagramStore((s) => s.activeViewId)
  const c4Nodes = useDiagramStore((s) => s.c4Nodes)
  const c4Relations = useDiagramStore((s) => s.c4Relations)
  const metamodel = useDiagramStore((s) => s.metamodel)
  const updateNode = useDiagramStore((s) => s.updateNode)
  const updateRelation = useDiagramStore((s) => s.updateRelation)
  const setWikiFocus = useDiagramStore((s) => s.setWikiFocus)
  const appMode = useDiagramStore((s) => s.appMode)

  const readOnly = appMode !== 'designer'
  const typeMeta = useTypeMeta()

  const view = activeViewId ? views[activeViewId] : null
  const focusId = view?.wikiFocusId ?? null
  const focus = focusId ? c4Nodes[focusId] : null

  const [filter, setFilter] = useState('')

  const nodeList = useMemo(() => Object.values(c4Nodes), [c4Nodes])

  const childrenOf = useMemo(() => {
    const map: Record<string, C4Node[]> = {}
    for (const n of nodeList) {
      const key = n.parentId ?? '__root__'
      ;(map[key] ??= []).push(n)
    }
    for (const k of Object.keys(map)) {
      map[k].sort((a, b) => a.label.localeCompare(b.label))
    }
    return map
  }, [nodeList])

  const goTo = (id: string | null) => {
    if (view) setWikiFocus(view.id, id)
  }

  if (!view) {
    return (
      <div className="wiki-view">
        <div className="wiki-empty">No active view.</div>
      </div>
    )
  }

  return (
    <div className="wiki-view">
      <WikiNav
        filter={filter}
        setFilter={setFilter}
        childrenOf={childrenOf}
        focusId={focusId}
        onSelect={goTo}
        typeMeta={typeMeta}
      />
      <div className="wiki-page">
        {focus ? (
          <WikiElementPage
            key={focus.id}
            node={focus}
            nodes={c4Nodes}
            relations={c4Relations}
            metamodel={metamodel}
            updateNode={updateNode}
            updateRelation={updateRelation}
            onNavigate={goTo}
            readOnly={readOnly}
            typeMeta={typeMeta}
          />
        ) : (
          <WikiOverview
            roots={childrenOf['__root__'] ?? []}
            childrenOf={childrenOf}
            onNavigate={goTo}
            totalNodes={nodeList.length}
            totalRelations={Object.keys(c4Relations).length}
            typeMeta={typeMeta}
          />
        )}
      </div>
    </div>
  )
}

// ─── Navigation (left column) ────────────────────────────────────────────────

function WikiNav({
  filter,
  setFilter,
  childrenOf,
  focusId,
  onSelect,
  typeMeta,
}: {
  filter: string
  setFilter: (v: string) => void
  childrenOf: Record<string, C4Node[]>
  focusId: string | null
  onSelect: (id: string | null) => void
  typeMeta: TypeMeta
}): React.ReactElement {
  const lower = filter.trim().toLowerCase()

  const renderBranch = (parentKey: string, depth: number): React.ReactNode => {
    const items = childrenOf[parentKey] ?? []
    return items.map((n) => {
      const matches = !lower || n.label.toLowerCase().includes(lower)
      const childNodes = renderBranch(n.id, depth + 1)
      const hasMatchingChild = Array.isArray(childNodes) && childNodes.some(Boolean)
      if (lower && !matches && !hasMatchingChild) return null
      const meta = typeMeta(n.type)
      return (
        <div key={n.id}>
          <button
            className={`wiki-nav-item ${focusId === n.id ? 'active' : ''}`}
            style={{ paddingLeft: 10 + depth * 13 }}
            onClick={() => onSelect(n.id)}
            title={n.label}
          >
            <span className="wiki-nav-dot" style={{ background: meta.color }} />
            <span className="wiki-nav-text">{n.label}</span>
          </button>
          {childNodes}
        </div>
      )
    })
  }

  return (
    <div className="wiki-nav">
      <div className="wiki-nav-head">Contents</div>
      <input
        className="wiki-nav-search"
        placeholder="Filter…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      <button
        className={`wiki-nav-item wiki-nav-home ${focusId === null ? 'active' : ''}`}
        onClick={() => onSelect(null)}
      >
        <span className="wiki-nav-text">Overview</span>
      </button>
      <div className="wiki-nav-tree">{renderBranch('__root__', 0)}</div>
    </div>
  )
}

// ─── Overview page ───────────────────────────────────────────────────────────

function WikiOverview({
  roots,
  childrenOf,
  onNavigate,
  totalNodes,
  totalRelations,
  typeMeta,
}: {
  roots: C4Node[]
  childrenOf: Record<string, C4Node[]>
  onNavigate: (id: string) => void
  totalNodes: number
  totalRelations: number
  typeMeta: TypeMeta
}): React.ReactElement {
  return (
    <article className="wiki-doc">
      <header className="wiki-doc-header">
        <h1 className="wiki-doc-title">Overview</h1>
        <p className="wiki-doc-sub">
          {totalNodes} element{totalNodes === 1 ? '' : 's'} · {totalRelations} relation
          {totalRelations === 1 ? '' : 's'}
        </p>
      </header>
      {roots.length === 0 ? (
        <p className="wiki-muted">No elements yet.</p>
      ) : (
        <div className="wiki-card-grid">
          {roots.map((n) => {
            const kids = childrenOf[n.id] ?? []
            const meta = typeMeta(n.type)
            return (
              <button key={n.id} className="wiki-card" onClick={() => onNavigate(n.id)}>
                <span className="wiki-card-bar" style={{ background: meta.color }} />
                <span className="wiki-card-body">
                  <span className="wiki-card-title">{n.label}</span>
                  <span className="wiki-card-meta">
                    {meta.label}
                    {kids.length > 0 && ` · ${kids.length} child${kids.length === 1 ? '' : 'ren'}`}
                  </span>
                  {n.description && <span className="wiki-card-desc">{n.description}</span>}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </article>
  )
}

// ─── Element page ────────────────────────────────────────────────────────────

const TECH_TYPES: ReadonlySet<string> = new Set([
  'container',
  'component',
  'database',
  'webapp',
  'queue',
])

function WikiElementPage({
  node,
  nodes,
  relations,
  metamodel,
  updateNode,
  updateRelation,
  onNavigate,
  readOnly,
  typeMeta,
}: {
  node: C4Node
  nodes: Record<string, C4Node>
  relations: Record<string, C4Relation>
  metamodel: Metamodel
  updateNode: UpdateNode
  updateRelation: UpdateRelation
  onNavigate: (id: string) => void
  readOnly: boolean
  typeMeta: TypeMeta
}): React.ReactElement {
  const breadcrumb = useMemo(() => {
    const chain: C4Node[] = []
    let cur: C4Node | undefined = node
    const seen = new Set<string>()
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id)
      chain.unshift(cur)
      cur = cur.parentId ? nodes[cur.parentId] : undefined
    }
    return chain
  }, [node, nodes])

  const children = useMemo(
    () =>
      Object.values(nodes)
        .filter((n) => n.parentId === node.id)
        .sort((a, b) => a.label.localeCompare(b.label)),
    [nodes, node.id],
  )

  const outgoing = useMemo(
    () => Object.values(relations).filter((r) => r.sourceId === node.id),
    [relations, node.id],
  )
  const incoming = useMemo(
    () => Object.values(relations).filter((r) => r.targetId === node.id),
    [relations, node.id],
  )

  const nodeTypeDef = metamodel?.nodeTypes[node.type]
  const allProps = useMemo(
    () => (nodeTypeDef?.properties ?? []).filter((p) => p.key !== 'label'),
    [nodeTypeDef],
  )

  // Split metamodel props into a lead description, long-form sections, and
  // short "infobox" facts — so the page reads like a document, not a form.
  const { leadProp, sectionProps, factProps } = useMemo(() => {
    let lead: PropertyDef | undefined
    const sections: PropertyDef[] = []
    const facts: PropertyDef[] = []
    for (const p of allProps) {
      if (p.type === 'textarea') {
        if (!lead && p.key === 'description') lead = p
        else sections.push(p)
      } else {
        facts.push(p)
      }
    }
    return { leadProp: lead, sectionProps: sections, factProps: facts }
  }, [allProps])

  // Fallback fields when the document carries no metamodel for this type.
  const hasMeta = !!nodeTypeDef
  const fallbackLead: PropertyDef | undefined = hasMeta
    ? leadProp
    : { key: 'description', label: 'Description', type: 'textarea' }
  const fallbackFacts: PropertyDef[] = hasMeta
    ? factProps
    : [
        ...(TECH_TYPES.has(node.type)
          ? [{ key: 'technology', label: 'Technology', type: 'text' as const }]
          : []),
        { key: 'external', label: 'External', type: 'boolean' as const },
      ]

  const parentCandidates = useMemo(
    () =>
      Object.values(nodes)
        .filter((n) => n.id !== node.id && isParentAllowed(metamodel, node.type, n.type))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [nodes, node, metamodel],
  )

  const meta = typeMeta(node.type)
  const parent = node.parentId ? nodes[node.parentId] : undefined
  const getVal = (key: string) => (node as unknown as Record<string, unknown>)[key]
  const lead = fallbackLead

  return (
    <article className="wiki-doc" style={{ ['--type-color' as string]: meta.color }}>
      <nav className="wiki-breadcrumb">
        {breadcrumb.map((b, i) => (
          <React.Fragment key={b.id}>
            {i > 0 && <span className="wiki-breadcrumb-sep">›</span>}
            {b.id === node.id ? (
              <span className="wiki-breadcrumb-current">{b.label}</span>
            ) : (
              <button className="wiki-link" onClick={() => onNavigate(b.id)}>
                {b.label}
              </button>
            )}
          </React.Fragment>
        ))}
      </nav>

      <header className="wiki-doc-header">
        <div className="wiki-kicker">
          <span className="wiki-kicker-icon" style={{ color: meta.color }}>
            {meta.iconPath && (
              <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
                <path d={meta.iconPath} />
              </svg>
            )}
          </span>
          {meta.label}
          {node.external && <span className="wiki-kicker-tag">external</span>}
        </div>
        <InlineText
          className="wiki-doc-title"
          value={node.label}
          placeholder="Untitled element"
          readOnly={readOnly}
          onCommit={(v) => updateNode(node.id, { label: v })}
        />
        {lead && (
          <InlineText
            multiline
            className="wiki-lead"
            value={String(getVal(lead.key) ?? '')}
            placeholder={readOnly ? '' : 'Add a description…'}
            readOnly={readOnly}
            onCommit={(v) =>
              updateNode(node.id, { [lead.key]: v } as Parameters<UpdateNode>[1])
            }
          />
        )}
      </header>

      <div className="wiki-body">
        <div className="wiki-main">
          {/* Long-form sections */}
          {(hasMeta ? sectionProps : []).map((p) => (
            <section className="wiki-prose-section" key={p.key}>
              <h2 className="wiki-h2">{p.label}</h2>
              <InlineText
                multiline
                className="wiki-prose"
                value={String(getVal(p.key) ?? '')}
                placeholder={readOnly ? '—' : `Add ${p.label.toLowerCase()}…`}
                readOnly={readOnly}
                onCommit={(v) =>
                  updateNode(node.id, { [p.key]: v } as Parameters<UpdateNode>[1])
                }
              />
            </section>
          ))}

          {/* Children */}
          <section className="wiki-prose-section">
            <h2 className="wiki-h2">
              Contains <span className="wiki-count">{children.length}</span>
            </h2>
            {children.length === 0 ? (
              <p className="wiki-muted">No child elements.</p>
            ) : (
              <div className="wiki-card-grid">
                {children.map((c) => {
                  const cm = typeMeta(c.type)
                  return (
                    <button key={c.id} className="wiki-card" onClick={() => onNavigate(c.id)}>
                      <span className="wiki-card-bar" style={{ background: cm.color }} />
                      <span className="wiki-card-body">
                        <span className="wiki-card-title">{c.label}</span>
                        <span className="wiki-card-meta">{cm.label}</span>
                        {c.description && <span className="wiki-card-desc">{c.description}</span>}
                      </span>
                    </button>
                  )
                })}
              </div>
            )}
          </section>

          {/* Relations */}
          <section className="wiki-prose-section">
            <h2 className="wiki-h2">
              Relationships{' '}
              <span className="wiki-count">{outgoing.length + incoming.length}</span>
            </h2>
            {outgoing.length === 0 && incoming.length === 0 ? (
              <p className="wiki-muted">No relationships.</p>
            ) : (
              <div className="wiki-rel-list">
                {outgoing.map((r) => (
                  <WikiRelationLine
                    key={r.id}
                    direction="out"
                    otherNode={nodes[r.targetId]}
                    relation={r}
                    nodes={nodes}
                    metamodel={metamodel}
                    readOnly={readOnly}
                    onNavigate={onNavigate}
                    updateRelation={updateRelation}
                    typeMeta={typeMeta}
                  />
                ))}
                {incoming.map((r) => (
                  <WikiRelationLine
                    key={r.id}
                    direction="in"
                    otherNode={nodes[r.sourceId]}
                    relation={r}
                    nodes={nodes}
                    metamodel={metamodel}
                    readOnly={readOnly}
                    onNavigate={onNavigate}
                    updateRelation={updateRelation}
                    typeMeta={typeMeta}
                  />
                ))}
              </div>
            )}
          </section>
        </div>

        {/* Infobox — short facts */}
        <aside className="wiki-infobox">
          <div className="wiki-infobox-head">Details</div>
          <dl className="wiki-facts">
            <div className="wiki-fact">
              <dt>Parent</dt>
              <dd>
                <InlineSelect
                  value={node.parentId ?? ''}
                  readOnly={readOnly}
                  options={[
                    { value: '', label: '— none —' },
                    ...parentCandidates.map((n) => ({ value: n.id, label: n.label })),
                  ]}
                  display={
                    parent ? (
                      <button
                        className="wiki-link"
                        onClick={(e) => {
                          e.stopPropagation()
                          onNavigate(parent.id)
                        }}
                      >
                        {parent.label}
                      </button>
                    ) : (
                      <span className="wiki-muted">none</span>
                    )
                  }
                  onCommit={(v) => updateNode(node.id, { parentId: v || undefined })}
                />
              </dd>
            </div>

            {(hasMeta ? factProps : fallbackFacts).map((p) => (
              <div className="wiki-fact" key={p.key}>
                <dt>{p.label}</dt>
                <dd>
                  <WikiFactValue
                    def={p}
                    value={getVal(p.key)}
                    readOnly={readOnly}
                    onCommit={(v) =>
                      updateNode(node.id, { [p.key]: v } as Parameters<UpdateNode>[1])
                    }
                  />
                </dd>
              </div>
            ))}
          </dl>
        </aside>
      </div>
    </article>
  )
}

// ─── Relation line (readable, inline-editable) ───────────────────────────────

function WikiRelationLine({
  direction,
  otherNode,
  relation,
  nodes,
  metamodel,
  readOnly,
  onNavigate,
  updateRelation,
  typeMeta,
}: {
  direction: 'in' | 'out'
  otherNode: C4Node | undefined
  relation: C4Relation
  nodes: Record<string, C4Node>
  metamodel: Metamodel
  readOnly: boolean
  onNavigate: (id: string) => void
  updateRelation: UpdateRelation
  typeMeta: TypeMeta
}): React.ReactElement {
  const relTypeDef = relation.relationType
    ? metamodel?.relationTypes[relation.relationType]
    : undefined
  const srcNode = nodes[relation.sourceId]
  const dstNode = nodes[relation.targetId]
  const compatibleTypes = useMemo(
    () =>
      metamodel
        ? Object.values(metamodel.relationTypes).filter(
            (rt) =>
              rt.allowedPairs.length === 0 ||
              rt.allowedPairs.some((p) => p.from === srcNode?.type && p.to === dstNode?.type),
          )
        : [],
    [metamodel, srcNode, dstNode],
  )
  const relMetaProps = relTypeDef?.properties ?? []
  const getVal = (key: string) => (relation as unknown as Record<string, unknown>)[key]

  return (
    <div className="wiki-rel">
      <span className={`wiki-rel-arrow ${direction}`}>{direction === 'out' ? '→' : '←'}</span>
      <div className="wiki-rel-main">
        <div className="wiki-rel-head">
          <span className="wiki-rel-verb">
            {relTypeDef?.label ?? (direction === 'out' ? 'relates to' : 'related from')}
          </span>
          {otherNode ? (
            <button className="wiki-link wiki-rel-target" onClick={() => onNavigate(otherNode.id)}>
              {otherNode.label}
            </button>
          ) : (
            <span className="wiki-muted">(missing)</span>
          )}
          {otherNode && <TypeChip type={otherNode.type} typeMeta={typeMeta} />}
        </div>

        <div className="wiki-rel-attrs">
          <InlineText
            className="wiki-rel-label"
            value={relation.label ?? ''}
            placeholder={readOnly ? '' : 'add label'}
            readOnly={readOnly}
            onCommit={(v) => updateRelation(relation.id, { label: v })}
          />

          {compatibleTypes.length > 1 && (
            <span className="wiki-rel-pill">
              <InlineSelect
                value={relation.relationType ?? ''}
                readOnly={readOnly}
                options={[
                  { value: '', label: 'generic' },
                  ...compatibleTypes.map((rt) => ({ value: rt.id, label: rt.label })),
                ]}
                display={<span>{relTypeDef?.label ?? 'generic'}</span>}
                onCommit={(v) =>
                  updateRelation(relation.id, {
                    relationType: v || undefined,
                  } as Parameters<UpdateRelation>[1])
                }
              />
            </span>
          )}

          {relMetaProps.length > 0
            ? relMetaProps.map((p) => (
                <span className="wiki-rel-attr" key={p.key}>
                  <span className="wiki-rel-attr-key">{p.label}:</span>{' '}
                  <WikiFactValue
                    def={p}
                    value={getVal(p.key)}
                    readOnly={readOnly}
                    inline
                    onCommit={(v) =>
                      updateRelation(relation.id, {
                        [p.key]: v,
                      } as Parameters<UpdateRelation>[1])
                    }
                  />
                </span>
              ))
            : !relTypeDef &&
              (relation.technology || !readOnly) && (
                <span className="wiki-rel-attr">
                  <span className="wiki-rel-attr-key">Tech:</span>{' '}
                  <InlineText
                    value={relation.technology ?? ''}
                    placeholder="add"
                    readOnly={readOnly}
                    onCommit={(v) => updateRelation(relation.id, { technology: v })}
                  />
                </span>
              )}
        </div>
      </div>
    </div>
  )
}

// ─── Infobox / inline fact value (display-first, edit on click) ──────────────

function WikiFactValue({
  def,
  value,
  readOnly = false,
  inline = false,
  onCommit,
}: {
  def: PropertyDef
  value: unknown
  readOnly?: boolean
  inline?: boolean
  onCommit: (v: string | number | boolean) => void
}): React.ReactElement {
  if (def.type === 'boolean') {
    const on = Boolean(value)
    return (
      <button
        className={`wiki-bool ${on ? 'on' : 'off'}`}
        disabled={readOnly}
        onClick={() => !readOnly && onCommit(!on)}
      >
        {on ? 'Yes' : 'No'}
      </button>
    )
  }

  if (def.type === 'enum' && def.options) {
    const cur = String(value ?? '')
    return (
      <InlineSelect
        value={cur}
        readOnly={readOnly}
        options={[
          { value: '', label: '—' },
          ...def.options.map((o) => ({ value: o, label: o })),
        ]}
        display={
          cur ? (
            <span className={`wiki-enum-pill enum-${cur}`}>{cur}</span>
          ) : (
            <span className="wiki-muted">—</span>
          )
        }
        onCommit={(v) => onCommit(v)}
      />
    )
  }

  return (
    <InlineText
      className={inline ? '' : 'wiki-fact-text'}
      value={value == null ? '' : String(value)}
      placeholder={readOnly ? '—' : 'add'}
      readOnly={readOnly}
      onCommit={(v) => onCommit(def.type === 'number' ? Number(v) : v)}
    />
  )
}

// ─── Inline editors ──────────────────────────────────────────────────────────

function InlineText({
  value,
  placeholder = '',
  className = '',
  multiline = false,
  readOnly = false,
  onCommit,
}: {
  value: string
  placeholder?: string
  className?: string
  multiline?: boolean
  readOnly?: boolean
  onCommit: (v: string) => void
}): React.ReactElement {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null)

  useEffect(() => {
    if (!editing) setDraft(value)
  }, [value, editing])

  useLayoutEffect(() => {
    if (editing && inputRef.current) {
      const el = inputRef.current
      el.focus()
      const len = el.value.length
      el.setSelectionRange(len, len)
      if (multiline) autoSize(el as HTMLTextAreaElement)
    }
  }, [editing, multiline])

  const commit = () => {
    setEditing(false)
    if (draft !== value) onCommit(draft)
  }
  const cancel = () => {
    setDraft(value)
    setEditing(false)
  }

  if (editing && !readOnly) {
    return multiline ? (
      <textarea
        ref={(el) => (inputRef.current = el)}
        className={`wiki-inline-input wiki-inline-textarea ${className}`}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value)
          autoSize(e.target)
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Escape') cancel()
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) commit()
        }}
      />
    ) : (
      <input
        ref={(el) => (inputRef.current = el)}
        className={`wiki-inline-input ${className}`}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Escape') cancel()
          if (e.key === 'Enter') commit()
        }}
      />
    )
  }

  const empty = value.trim() === ''
  return (
    <span
      className={`wiki-inline-view ${className} ${empty ? 'empty' : ''} ${
        readOnly ? 'readonly' : ''
      }`}
      onClick={() => !readOnly && setEditing(true)}
      title={readOnly ? undefined : 'Click to edit'}
    >
      {empty ? placeholder : value}
    </span>
  )
}

function InlineSelect({
  value,
  options,
  display,
  readOnly = false,
  onCommit,
}: {
  value: string
  options: { value: string; label: string }[]
  display: React.ReactNode
  readOnly?: boolean
  onCommit: (v: string) => void
}): React.ReactElement {
  const [editing, setEditing] = useState(false)
  const ref = useRef<HTMLSelectElement | null>(null)

  useLayoutEffect(() => {
    if (editing && ref.current) ref.current.focus()
  }, [editing])

  if (editing && !readOnly) {
    return (
      <select
        ref={ref}
        className="wiki-inline-input wiki-inline-select"
        value={value}
        onChange={(e) => {
          onCommit(e.target.value)
          setEditing(false)
        }}
        onBlur={() => setEditing(false)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    )
  }

  return (
    <span
      className={`wiki-inline-view ${readOnly ? 'readonly' : ''}`}
      onClick={() => !readOnly && setEditing(true)}
      title={readOnly ? undefined : 'Click to edit'}
    >
      {display}
    </span>
  )
}

function autoSize(el: HTMLTextAreaElement) {
  el.style.height = 'auto'
  el.style.height = `${el.scrollHeight}px`
}
