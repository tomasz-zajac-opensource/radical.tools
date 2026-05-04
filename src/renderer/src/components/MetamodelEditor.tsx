import React, { useState, useMemo, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useDiagramStore } from '../store/diagramStore'
import { builtInC4Metamodel, validateModel } from '../types/metamodel'
import type {
  NodeTypeDef,
  RelationTypeDef,
  RelationPair,
  PropertyDef,
  PropertyType,
} from '../types/metamodel'

// ── small icon helpers ─────────────────────────────────────────────────────

const IconPlus = () => (
  <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
    <path d="M8 3v10M3 8h10" />
  </svg>
)
const IconTrash = () => (
  <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 4.5 h10 M6 4.5 V3 h4 v1.5 M5 4.5 l.7 8.5 a1 1 0 0 0 1 1 h2.6 a1 1 0 0 0 1 -1 l.7 -8.5" />
  </svg>
)

// ── Property editor (used inside type cards) ───────────────────────────────

function PropertyEditor({
  properties,
  onChange,
}: {
  properties: PropertyDef[]
  onChange: (next: PropertyDef[]) => void
}): React.ReactElement {
  const update = (idx: number, patch: Partial<PropertyDef>) => {
    const next = properties.map((p, i) => (i === idx ? { ...p, ...patch } : p))
    onChange(next)
  }
  const remove = (idx: number) => onChange(properties.filter((_, i) => i !== idx))
  const add = () =>
    onChange([
      ...properties,
      { key: `prop${properties.length + 1}`, label: 'New property', type: 'text' },
    ])

  return (
    <div className="mm-prop-list">
      {properties.length === 0 && <div className="mm-empty">No custom properties.</div>}
      {properties.map((p, i) => (
        <div key={i} className="mm-prop-row">
          <input
            className="mm-input mm-prop-key"
            value={p.key}
            placeholder="key"
            onChange={(e) => update(i, { key: e.target.value })}
          />
          <input
            className="mm-input mm-prop-label"
            value={p.label}
            placeholder="Label"
            onChange={(e) => update(i, { label: e.target.value })}
          />
          <select
            className="mm-input mm-prop-type"
            value={p.type}
            onChange={(e) => update(i, { type: e.target.value as PropertyType })}
          >
            <option value="text">text</option>
            <option value="textarea">textarea</option>
            <option value="number">number</option>
            <option value="boolean">boolean</option>
            <option value="enum">enum</option>
          </select>
          <label className="mm-checkbox" title="Required">
            <input
              type="checkbox"
              checked={!!p.required}
              onChange={(e) => update(i, { required: e.target.checked })}
            />
            req
          </label>
          {p.type === 'enum' && (
            <input
              className="mm-input mm-prop-options"
              value={(p.options ?? []).join(', ')}
              placeholder="opt1, opt2"
              onChange={(e) =>
                update(i, {
                  options: e.target.value
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean),
                })
              }
            />
          )}
          <button className="mm-icon-btn danger" title="Remove property" onClick={() => remove(i)}>
            <IconTrash />
          </button>
        </div>
      ))}
      <button className="mm-add-btn" onClick={add}>
        <IconPlus /> Add property
      </button>
    </div>
  )
}

// ── Node-type card ─────────────────────────────────────────────────────────

function NodeTypeCard({
  def,
  allTypes,
  onChange,
  onDelete,
}: {
  def: NodeTypeDef
  allTypes: NodeTypeDef[]
  onChange: (patch: Partial<NodeTypeDef>) => void
  onDelete: () => void
}): React.ReactElement {
  const [open, setOpen] = useState(false)

  return (
    <div className="mm-card">
      <div className="mm-card-header" onClick={() => setOpen((v) => !v)}>
        <svg className={`mm-chevron${open ? ' open' : ''}`} viewBox="0 0 16 16" width="10" height="10">
          <path d="M5 3 L11 8 L5 13" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="mm-type-badge" style={{ background: def.color, color: def.fg }}>
          <svg viewBox="0 0 16 16" width="12" height="12" fill={def.fg}>
            <path d={def.iconPath} />
          </svg>
        </span>
        <span className="mm-type-label">{def.label}</span>
        <span className="mm-type-id">{def.id}</span>
        {def.builtin && <span className="mm-builtin-tag">built-in</span>}
        <div style={{ flex: 1 }} />
        {!def.builtin && (
          <button
            className="mm-icon-btn danger"
            title="Delete type"
            onClick={(e) => {
              e.stopPropagation()
              onDelete()
            }}
          >
            <IconTrash />
          </button>
        )}
      </div>
      {open && (
        <div className="mm-card-body">
          <div className="mm-row">
            <label className="mm-field">
              <span>Label</span>
              <input
                className="mm-input"
                value={def.label}
                onChange={(e) => onChange({ label: e.target.value })}
              />
            </label>
            <label className="mm-field mm-field-color">
              <span>Color</span>
              <input
                type="color"
                value={def.color}
                onChange={(e) => onChange({ color: e.target.value })}
              />
            </label>
            <label className="mm-field mm-field-color">
              <span>Text</span>
              <input
                type="color"
                value={def.fg}
                onChange={(e) => onChange({ fg: e.target.value })}
              />
            </label>
          </div>
          <div className="mm-row">
            <label className="mm-field">
              <span>Default width</span>
              <input
                className="mm-input"
                type="number"
                value={def.width}
                onChange={(e) => onChange({ width: Number(e.target.value) || 0 })}
              />
            </label>
            <label className="mm-field">
              <span>Default height</span>
              <input
                className="mm-input"
                type="number"
                value={def.height}
                onChange={(e) => onChange({ height: Number(e.target.value) || 0 })}
              />
            </label>
          </div>
          <div className="mm-row">
            <label className="mm-field">
              <span>Min instances</span>
              <input
                className="mm-input"
                type="number"
                value={def.cardinality?.min ?? ''}
                onChange={(e) =>
                  onChange({
                    cardinality: {
                      ...def.cardinality,
                      min: e.target.value === '' ? undefined : Number(e.target.value),
                    },
                  })
                }
              />
            </label>
            <label className="mm-field">
              <span>Max instances</span>
              <input
                className="mm-input"
                type="number"
                value={def.cardinality?.max ?? ''}
                onChange={(e) =>
                  onChange({
                    cardinality: {
                      ...def.cardinality,
                      max: e.target.value === '' ? undefined : Number(e.target.value),
                    },
                  })
                }
              />
            </label>
          </div>

          <div className="mm-section-label">Allowed parents</div>
          <div className="mm-parent-grid">
            <label className="mm-checkbox">
              <input
                type="checkbox"
                checked={!def.allowedParents || def.allowedParents.length === 0}
                onChange={(e) => onChange({ allowedParents: e.target.checked ? undefined : [] })}
              />
              Root only
            </label>
            {allTypes
              .filter((t) => t.id !== def.id)
              .map((t) => {
                const checked = def.allowedParents?.includes(t.id) ?? false
                return (
                  <label key={t.id} className="mm-checkbox">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => {
                        const cur = new Set(def.allowedParents ?? [])
                        if (e.target.checked) cur.add(t.id)
                        else cur.delete(t.id)
                        const arr = Array.from(cur)
                        onChange({ allowedParents: arr.length ? arr : undefined })
                      }}
                    />
                    {t.label}
                  </label>
                )
              })}
          </div>

          <div className="mm-section-label">Custom properties</div>
          <PropertyEditor
            properties={def.properties ?? []}
            onChange={(properties) => onChange({ properties })}
          />
        </div>
      )}
    </div>
  )
}

// ── Relation-type card ─────────────────────────────────────────────────────

function RelationTypeCard({
  def,
  allTypes,
  onChange,
  onDelete,
}: {
  def: RelationTypeDef
  allTypes: NodeTypeDef[]
  onChange: (patch: Partial<RelationTypeDef>) => void
  onDelete: () => void
}): React.ReactElement {
  const [open, setOpen] = useState(false)

  const updatePair = (idx: number, patch: Partial<RelationPair>) =>
    onChange({ allowedPairs: def.allowedPairs.map((p, i) => (i === idx ? { ...p, ...patch } : p)) })
  const removePair = (idx: number) =>
    onChange({ allowedPairs: def.allowedPairs.filter((_, i) => i !== idx) })
  const addPair = () => {
    const first = allTypes[0]?.id ?? ''
    onChange({ allowedPairs: [...def.allowedPairs, { from: first, to: first }] })
  }

  return (
    <div className="mm-card">
      <div className="mm-card-header" onClick={() => setOpen((v) => !v)}>
        <svg className={`mm-chevron${open ? ' open' : ''}`} viewBox="0 0 16 16" width="10" height="10">
          <path d="M5 3 L11 8 L5 13" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="mm-rel-arrow">→</span>
        <span className="mm-type-label">{def.label}</span>
        <span className="mm-type-id">{def.id}</span>
        {def.builtin && <span className="mm-builtin-tag">built-in</span>}
        <span className="mm-pair-count">
          {def.allowedPairs.length === 0 ? 'any pair' : `${def.allowedPairs.length} pair(s)`}
        </span>
        <div style={{ flex: 1 }} />
        {!def.builtin && (
          <button
            className="mm-icon-btn danger"
            title="Delete relation type"
            onClick={(e) => {
              e.stopPropagation()
              onDelete()
            }}
          >
            <IconTrash />
          </button>
        )}
      </div>
      {open && (
        <div className="mm-card-body">
          <div className="mm-row">
            <label className="mm-field">
              <span>Label</span>
              <input
                className="mm-input"
                value={def.label}
                onChange={(e) => onChange({ label: e.target.value })}
              />
            </label>
          </div>

          <div className="mm-section-label">
            Allowed pairs
            <span className="mm-hint">Empty list ⇒ any pair allowed.</span>
          </div>
          <div className="mm-pair-list">
            {def.allowedPairs.map((pair, i) => (
              <div key={i} className="mm-pair-row">
                <select
                  className="mm-input"
                  value={pair.from}
                  onChange={(e) => updatePair(i, { from: e.target.value })}
                >
                  {allTypes.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </select>
                <span className="mm-pair-arrow">→</span>
                <select
                  className="mm-input"
                  value={pair.to}
                  onChange={(e) => updatePair(i, { to: e.target.value })}
                >
                  {allTypes.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </select>
                <input
                  className="mm-input mm-num"
                  type="number"
                  placeholder="min"
                  value={pair.min ?? ''}
                  onChange={(e) =>
                    updatePair(i, { min: e.target.value === '' ? undefined : Number(e.target.value) })
                  }
                />
                <input
                  className="mm-input mm-num"
                  type="number"
                  placeholder="max"
                  value={pair.max ?? ''}
                  onChange={(e) =>
                    updatePair(i, { max: e.target.value === '' ? undefined : Number(e.target.value) })
                  }
                />
                <button className="mm-icon-btn danger" onClick={() => removePair(i)} title="Remove">
                  <IconTrash />
                </button>
              </div>
            ))}
            <button className="mm-add-btn" onClick={addPair}>
              <IconPlus /> Add pair
            </button>
          </div>

          <div className="mm-section-label">Custom properties</div>
          <PropertyEditor
            properties={def.properties ?? []}
            onChange={(properties) => onChange({ properties })}
          />
        </div>
      )}
    </div>
  )
}

// ── Issues panel (right column inside metamodel editor) ────────────────────

function IssuesPanel(): React.ReactElement {
  const nodes = useDiagramStore((s) => s.c4Nodes)
  const relations = useDiagramStore((s) => s.c4Relations)
  const metamodel = useDiagramStore((s) => s.metamodel)
  const selectNode = useDiagramStore((s) => s.selectNode)
  const setAppMode = useDiagramStore((s) => s.setAppMode)

  const issues = useMemo(
    () => validateModel(nodes, relations, metamodel),
    [nodes, relations, metamodel],
  )

  return (
    <div className="mm-issues">
      <div className="mm-issues-header">
        <strong>Validation</strong>
        <span className={`mm-issues-count${issues.length ? ' has' : ''}`}>{issues.length}</span>
      </div>
      {issues.length === 0 && <div className="mm-empty">Model is consistent with metamodel.</div>}
      {issues.map((issue) => (
        <div key={issue.id} className={`mm-issue mm-issue-${issue.severity}`}>
          <div className="mm-issue-msg">{issue.message}</div>
          {issue.nodeId && (
            <button
              className="mm-link"
              onClick={() => {
                selectNode(issue.nodeId!)
                setAppMode('designer')
              }}
            >
              Open in Designer →
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

// ── Main perspective ───────────────────────────────────────────────────────

export function MetamodelEditor(): React.ReactElement {
  const metamodel = useDiagramStore((s) => s.metamodel)
  const upsertNodeType = useDiagramStore((s) => s.upsertNodeType)
  const removeNodeType = useDiagramStore((s) => s.removeNodeType)
  const upsertRelationType = useDiagramStore((s) => s.upsertRelationType)
  const removeRelationType = useDiagramStore((s) => s.removeRelationType)
  const resetMetamodelToC4 = useDiagramStore((s) => s.resetMetamodelToC4)
  const setMetamodel = useDiagramStore((s) => s.setMetamodel)

  const nodeTypes = useMemo(() => Object.values(metamodel.nodeTypes), [metamodel])
  const relationTypes = useMemo(() => Object.values(metamodel.relationTypes), [metamodel])

  const addNodeType = () => {
    const base = builtInC4Metamodel().nodeTypes.system
    let i = 1
    let id = `type${i}`
    while (metamodel.nodeTypes[id]) {
      i += 1
      id = `type${i}`
    }
    upsertNodeType({
      ...base,
      id,
      label: `New type ${i}`,
      builtin: false,
      color: '#6b7280',
      fg: '#ffffff',
      allowedParents: undefined,
      properties: [],
    })
  }

  const addRelationType = () => {
    let i = 1
    let id = `rel${i}`
    while (metamodel.relationTypes[id]) {
      i += 1
      id = `rel${i}`
    }
    upsertRelationType({ id, label: `New relation ${i}`, allowedPairs: [], builtin: false })
  }

  const setAppMode = useDiagramStore((s) => s.setAppMode)
  const close = (): void => setAppMode('designer')

  // Esc closes the editor.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return createPortal(
    <div
      className="milestone-modal-backdrop"
      onMouseDown={(e) => {
        if (e.target !== e.currentTarget) return
        const start = e.currentTarget
        const onUp = (ev: MouseEvent): void => {
          window.removeEventListener('mouseup', onUp, true)
          if (ev.target === start) close()
        }
        window.addEventListener('mouseup', onUp, true)
      }}
    >
      <div
        className="milestone-modal mm-editor-modal"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Metamodel editor"
      >
        <button
          type="button"
          className="mm-editor-modal-close"
          aria-label="Close metamodel editor"
          title="Close (Esc)"
          onClick={close}
        >
          ✕
        </button>
        <div className="mm-editor">
          <div className="mm-editor-main">
        <div className="mm-editor-header">
          <div>
            <input
              className="mm-input mm-name"
              value={metamodel.name}
              onChange={(e) => setMetamodel({ ...metamodel, name: e.target.value })}
            />
            <div className="mm-subhead">
              Per-document metamodel · {nodeTypes.length} node type(s) · {relationTypes.length} relation type(s)
            </div>
          </div>
          <div style={{ flex: 1 }} />
          <button
            className="mm-btn"
            onClick={() => {
              if (window.confirm('Reset metamodel to built-in C4? Custom types will be lost.')) {
                resetMetamodelToC4()
              }
            }}
          >
            Reset to C4 preset
          </button>
        </div>

        <div className="mm-section">
          <div className="mm-section-header">
            <h3>Node types</h3>
            <button className="mm-btn primary" onClick={addNodeType}>
              <IconPlus /> Add node type
            </button>
          </div>
          <div className="mm-card-list">
            {nodeTypes.map((t) => (
              <NodeTypeCard
                key={t.id}
                def={t}
                allTypes={nodeTypes}
                onChange={(patch) => upsertNodeType({ ...t, ...patch })}
                onDelete={() => removeNodeType(t.id)}
              />
            ))}
          </div>
        </div>

        <div className="mm-section">
          <div className="mm-section-header">
            <h3>Relation types</h3>
            <button className="mm-btn primary" onClick={addRelationType}>
              <IconPlus /> Add relation type
            </button>
          </div>
          <div className="mm-card-list">
            {relationTypes.map((t) => (
              <RelationTypeCard
                key={t.id}
                def={t}
                allTypes={nodeTypes}
                onChange={(patch) => upsertRelationType({ ...t, ...patch })}
                onDelete={() => removeRelationType(t.id)}
              />
            ))}
          </div>
        </div>

        <div className="mm-footer-note">
          Note: changes to built-in C4 types affect this document only. Newly added types are
          stored in the metamodel and surface in the Issues panel; full canvas styling for
          custom types lands in a follow-up.
        </div>
      </div>

      <aside className="mm-editor-side">
        <IssuesPanel />
      </aside>
        </div>
      </div>
    </div>,
    document.body,
  )
}
