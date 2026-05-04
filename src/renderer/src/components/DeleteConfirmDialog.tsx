import React, { useEffect } from 'react'
import { useDiagramStore } from '../store/diagramStore'

/**
 * Confirmation modal that appears when the user presses Delete on the canvas.
 * Asks whether to remove the selected element(s) from the underlying model
 * (permanent) or just hide them from the currently active view.
 */
export function DeleteConfirmDialog(): React.ReactElement | null {
  const pending = useDiagramStore((s) => s.pendingDelete)
  const activeViewId = useDiagramStore((s) => s.activeViewId)
  const c4Nodes = useDiagramStore((s) => s.c4Nodes)
  const c4Relations = useDiagramStore((s) => s.c4Relations)
  const resolve = useDiagramStore((s) => s.resolvePendingDelete)

  // Esc → cancel
  useEffect(() => {
    if (!pending) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); resolve('cancel') }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pending, resolve])

  if (!pending) return null
  const nodeCount = pending.nodeIds.length
  const edgeCount = pending.edgeIds.length
  if (nodeCount + edgeCount === 0) return null

  const firstNode = pending.nodeIds[0] ? c4Nodes[pending.nodeIds[0]] : null
  const firstEdge = pending.edgeIds[0] ? c4Relations[pending.edgeIds[0]] : null
  const summary = nodeCount + edgeCount === 1
    ? (firstNode ? `"${firstNode.label}"` : firstEdge ? `relation "${firstEdge.label || '(unnamed)'}"` : '1 element')
    : `${nodeCount} node(s)${edgeCount ? ` + ${edgeCount} relation(s)` : ''}`

  const canHide = !!activeViewId && nodeCount > 0

  return (
    <div className="milestone-modal-backdrop" onClick={() => resolve('cancel')}>
      <div className="milestone-modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="milestone-modal-title">Delete {summary}?</h3>
        <p className="milestone-modal-text">
          Choose how to handle this delete request.
        </p>
        <div className="milestone-modal-options">
          <button className="milestone-option" onClick={() => resolve('model')}>
            <div className="milestone-option-title">Remove from model</div>
            <div className="milestone-option-desc">
              Permanently delete from the model (and from every view that
              references it). Children of nodes are removed as well.
            </div>
          </button>
          <button
            className="milestone-option"
            disabled={!canHide}
            onClick={() => canHide && resolve('view')}
            style={canHide ? undefined : { opacity: 0.45, cursor: 'not-allowed' }}
          >
            <div className="milestone-option-title">
              Hide from current view{activeViewId ? '' : ' (no active view)'}
            </div>
            <div className="milestone-option-desc">
              {canHide
                ? 'Keep the element in the model — just remove it from the active view.'
                : 'Activate a view to be able to hide elements from it without deleting them.'}
            </div>
          </button>
          <button className="milestone-option ghost" onClick={() => resolve('cancel')}>
            <div className="milestone-option-title">Cancel</div>
            <div className="milestone-option-desc">Keep everything as it is.</div>
          </button>
        </div>
      </div>
    </div>
  )
}
