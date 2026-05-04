import React, { useState, useEffect } from 'react'
import { useDiagramStore } from '../store/diagramStore'

/**
 * Banner shown above the canvas when the user is editing a milestone.
 * Plus a modal that auto-opens after the first structural edit asking how
 * to commit changes (propagate to later milestones / save as new milestone /
 * discard).
 */
export function MilestoneEditOverlay(): React.ReactElement | null {
  const activeSnapshotId = useDiagramStore(s => s.activeSnapshotId)
  const snapshots = useDiagramStore(s => s.snapshots)
  const milestoneDirty = useDiagramStore(s => s.milestoneDirty)
  const promptOpen = useDiagramStore(s => s.milestonePromptOpen)
  const commit = useDiagramStore(s => s.commitMilestoneChanges)
  const discard = useDiagramStore(s => s.discardMilestoneChanges)
  const dismiss = useDiagramStore(s => s.dismissMilestonePrompt)
  const diffHighlight = useDiagramStore(s => s.diffHighlight)
  const diffBaseSnapshotId = useDiagramStore(s => s.diffBaseSnapshotId)
  const setDiffBase = useDiagramStore(s => s.setDiffBase)
  const c4Nodes = useDiagramStore(s => s.c4Nodes)
  const c4Relations = useDiagramStore(s => s.c4Relations)
  const ghostNodes = useDiagramStore(s => s.diffGhostNodes)
  const ghostRelations = useDiagramStore(s => s.diffGhostRelations)
  const selectNode = useDiagramStore(s => s.selectNode)
  const selectEdge = useDiagramStore(s => s.selectEdge)
  const appMode = useDiagramStore(s => s.appMode)

  const active = activeSnapshotId ? snapshots.find(s => s.id === activeSnapshotId) : null
  const idx = activeSnapshotId ? snapshots.findIndex(s => s.id === activeSnapshotId) : -1
  const laterCount = idx >= 0 ? snapshots.length - 1 - idx : 0

  // Diff stats: count by kind across nodes + relations.
  const stats = React.useMemo(() => {
    let added = 0, changed = 0, removed = 0
    for (const k of Object.values(diffHighlight)) {
      if (k === 'new') added++
      else if (k === 'changed') changed++
      else if (k === 'removed') removed++
    }
    return { added, changed, removed }
  }, [diffHighlight])

  // Eligible diff bases: any milestone other than the active one. The
  // dropdown also offers a synthetic "Live HEAD" entry (mapped to null) so
  // the user can compare any historic milestone against the current model.
  const baseOptions = snapshots.filter(s => s.id !== activeSnapshotId)

  // Build a flat audit list from diffHighlight. For 'new' / 'changed' we
  // read labels from the live model; for 'removed' we fall back to the
  // ghost copy (which holds the deleted node's last-known label).
  type LogEntry = {
    key: string
    id: string
    kind: 'node' | 'edge'
    action: 'new' | 'changed' | 'removed'
    label: string
    sub: string
    focusNodeId: string // node to centre camera on (= node itself, or edge source)
  }
  const log = React.useMemo<LogEntry[]>(() => {
    const out: LogEntry[] = []
    for (const [id, action] of Object.entries(diffHighlight)) {
      // Try as node first, then as relation. IDs are unique across both.
      if (c4Nodes[id] || ghostNodes[id]) {
        const n = c4Nodes[id] ?? ghostNodes[id]
        out.push({
          key: `n:${id}`,
          id,
          kind: 'node',
          action,
          label: n.label || n.type,
          sub: n.type,
          focusNodeId: id,
        })
      } else if (c4Relations[id] || ghostRelations[id]) {
        const r = c4Relations[id] ?? ghostRelations[id]
        const src = c4Nodes[r.sourceId] ?? ghostNodes[r.sourceId]
        const tgt = c4Nodes[r.targetId] ?? ghostNodes[r.targetId]
        out.push({
          key: `e:${id}`,
          id,
          kind: 'edge',
          action,
          label: r.label || `${src?.label ?? r.sourceId} → ${tgt?.label ?? r.targetId}`,
          sub: `${src?.label ?? r.sourceId} → ${tgt?.label ?? r.targetId}`,
          focusNodeId: r.sourceId,
        })
      }
    }
    // Stable order: added first, then changed, then removed; alphabetical within each.
    const rank: Record<LogEntry['action'], number> = { new: 0, changed: 1, removed: 2 }
    out.sort((a, b) => rank[a.action] - rank[b.action] || a.label.localeCompare(b.label))
    return out
  }, [diffHighlight, c4Nodes, c4Relations, ghostNodes, ghostRelations])

  const focusEntry = (e: LogEntry): void => {
    if (e.kind === 'node') selectNode(e.id)
    else selectEdge(e.id)
    // Pan camera. Removed items are ghosts and still rendered, so
    // __rfFocusNode can find them by id.
    const focus = (window as unknown as { __rfFocusNode?: (id: string, opts?: { zoom?: number; duration?: number }) => void }).__rfFocusNode
    focus?.(e.focusNodeId, { zoom: 1.1, duration: 400 })
  }

  const [logOpen, setLogOpen] = useState(false)
  // Auto-collapse log when switching milestones to keep the banner compact.
  useEffect(() => { setLogOpen(false) }, [activeSnapshotId, diffBaseSnapshotId])

  const [newName, setNewName] = useState('')
  useEffect(() => {
    if (active) setNewName(`${active.name} (edited)`)
  }, [active?.id])

  if (!active) return null
  // Banner is editor-only — viewer/presenter are read-only by design.
  if (appMode !== 'designer') return null

  // For v1 (oldest milestone, idx === 0) there is no "before" — it *is*
  // the baseline. Show it as comparing against itself so the panel reads
  // consistently ("vs v1 → +0 ~0 −0") instead of dangling "Live HEAD".
  const baseLabel = diffBaseSnapshotId
    ? (snapshots.find(s => s.id === diffBaseSnapshotId)?.name ?? '?')
    : (idx > 0 ? `${snapshots[idx - 1].name} (auto)` : `${active.name} (baseline)`)

  return (
    <>
      <div className="milestone-banner">
        <div className="milestone-banner-info">
          <span className="milestone-banner-icon">●</span>
          <span>
            Editing milestone <strong>{active.name}</strong>
            {milestoneDirty && <span className="milestone-banner-dirty"> · unsaved changes</span>}
          </span>
          <span className="milestone-diff-stats" title="Diff vs base">
            <span className="milestone-diff-stat added" title="Added">+{stats.added}</span>
            <span className="milestone-diff-stat changed" title="Changed">~{stats.changed}</span>
            <span className="milestone-diff-stat removed" title="Removed">−{stats.removed}</span>
            {log.length > 0 && (
              <button
                type="button"
                className="milestone-diff-log-toggle"
                onClick={() => setLogOpen(o => !o)}
                title={logOpen ? 'Hide change log' : 'Show change log'}
              >
                {logOpen ? '▾' : '▸'} log
              </button>
            )}
          </span>
          <label className="milestone-diff-base" title="Compare current milestone against…">
            <span className="milestone-diff-base-label">vs</span>
            <select
              className="milestone-diff-base-select"
              value={diffBaseSnapshotId ?? ''}
              onChange={(e) => setDiffBase(e.target.value || null)}
            >
              <option value="">{idx > 0 ? `Previous (${snapshots[idx - 1].name})` : `${active.name} (baseline)`}</option>
              {baseOptions.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            <span className="milestone-diff-base-hint">{baseLabel}</span>
          </label>
        </div>
        <div className="milestone-banner-actions">
          {milestoneDirty && (
            <>
              <button className="milestone-btn primary" onClick={() => commit('propagate')}
                title={`Apply changes to this milestone and ${laterCount} later milestone(s)`}>
                Propagate to later ({laterCount})
              </button>
              <button className="milestone-btn"
                onClick={() => commit('new', newName)}
                title="Insert new milestone after this one with current changes">
                Save as new milestone
              </button>
            </>
          )}
          <button className="milestone-btn ghost" onClick={discard}>
            {milestoneDirty ? 'Discard' : 'Return to live'}
          </button>
        </div>
        {logOpen && log.length > 0 && (
          <div className="milestone-diff-log" role="list" aria-label="Change log">
            {log.map((e) => (
              <button
                key={e.key}
                type="button"
                className={`milestone-diff-log-row action-${e.action} kind-${e.kind}`}
                onClick={() => focusEntry(e)}
                title={`Jump to ${e.kind === 'node' ? 'node' : 'relation'} on canvas`}
              >
                <span className={`milestone-diff-log-badge action-${e.action}`}>
                  {e.action === 'new' ? '+' : e.action === 'removed' ? '−' : '~'}
                </span>
                <span className="milestone-diff-log-kind">{e.kind === 'node' ? 'NODE' : 'REL'}</span>
                <span className="milestone-diff-log-label">{e.label}</span>
                <span className="milestone-diff-log-sub">{e.sub}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {promptOpen && milestoneDirty && (
        <div className="milestone-modal-backdrop" onClick={dismiss}>
          <div className="milestone-modal" onClick={e => e.stopPropagation()}>
            <h3 className="milestone-modal-title">Editing milestone &quot;{active.name}&quot;</h3>
            <p className="milestone-modal-text">
              You changed a milestone in the past. How should this be saved?
            </p>
            <div className="milestone-modal-options">
              <button className="milestone-option" onClick={() => commit('propagate')}>
                <div className="milestone-option-title">Propagate to later milestones</div>
                <div className="milestone-option-desc">
                  Apply these changes to <strong>{active.name}</strong> and all{' '}
                  <strong>{laterCount}</strong> milestone(s) that come after.
                </div>
              </button>
              <button className="milestone-option" onClick={() => commit('new', newName)}>
                <div className="milestone-option-title">Save as new milestone</div>
                <div className="milestone-option-desc">
                  Insert a new milestone right after <strong>{active.name}</strong>. Later
                  milestones stay unchanged.
                </div>
                <input
                  className="milestone-option-input"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  onClick={e => e.stopPropagation()}
                  placeholder="New milestone name"
                />
              </button>
              <button className="milestone-option ghost" onClick={discard}>
                <div className="milestone-option-title">Discard changes</div>
                <div className="milestone-option-desc">
                  Throw away the edits and return to live HEAD.
                </div>
              </button>
            </div>
            <div className="milestone-modal-footer">
              <button className="milestone-btn ghost" onClick={dismiss}>
                Continue editing (decide later)
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
