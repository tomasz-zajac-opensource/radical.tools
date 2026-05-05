// ─── Apply an AI patch to the diagram store ────────────────────────────────
// Validates ops, resolves tempIds to real ids, places new nodes in a simple
// grid (the live layout reshuffles after). Returns a report so the UI can
// surface what actually happened.

import { NODE_SIZES, type C4ElementType, type C4Node, type C4Relation, type DiagramView } from '../types/c4'
import type { Metamodel } from '../types/metamodel'
import type { AIPatch, AIPatchOp } from './types'

/** Fallback C4 types used when no metamodel is supplied (legacy callers / tests). */
const FALLBACK_VALID_TYPES: ReadonlySet<string> = new Set([
  'person', 'system', 'container', 'component', 'database', 'webapp', 'queue',
])

export interface ValidatePatchOptions {
  /** When provided, add_node/update_node `type` is checked against these ids
   *  rather than the hardcoded C4 set. Pass the keys of `metamodel.nodeTypes`
   *  so user-defined types from the metamodel editor are accepted. */
  knownTypes?: ReadonlySet<string>
}

export interface ApplyReport {
  added: { nodes: number; relations: number; views: number }
  updated: { nodes: number; views: number }
  deleted: { nodes: number; relations: number; views: number }
  errors: string[]
  /** Node id to pan/zoom to after applying the patch, if the AI issued focus_node. */
  focusNodeId?: string
}

export interface DiagramFacade {
  getNodes(): Record<string, C4Node>
  getRelations(): Record<string, C4Relation>
  /** Optional — used to inject metamodel rules into the AI system prompt. */
  getMetamodel?(): Metamodel | undefined
  /** Optional — active view info, used to tell the AI where new nodes land. */
  getActiveView?(): { id: string; name: string; nodeIds: string[] } | null
  /** Optional — returns all views so the AI can list / replace / delete them. */
  getViews?(): Record<string, DiagramView>
  addNode(node: Omit<C4Node, 'id'>): string
  updateNode(id: string, updates: Partial<Omit<C4Node, 'id'>>): void
  removeNode(id: string): void
  addRelation(rel: Omit<C4Relation, 'id'>): void
  updateRelation?(id: string, updates: Partial<Omit<C4Relation, 'id'>>): void
  removeRelation(id: string): void
  /** Optional view actions — omitted = AI view ops will report a clear error. */
  addView?(name: string): string
  setViewNodes?(viewId: string, nodeIds: string[]): void
  removeView?(id: string): void
  setActiveView?(id: string | null): void
  /** Optional — clears the entire diagram (nodes, relations, views) so the
   *  AI can build a fresh model from scratch. Omitting it means reset_diagram
   *  ops will fail with a descriptive error. */
  clearDiagram?(): void
}

/**
 * Validate the parsed JSON object and coerce it into an AIPatch.
 * Throws on shape errors so the caller can show a clear message.
 */
export function validatePatch(raw: unknown, opts: ValidatePatchOptions = {}): AIPatch {
  const validTypes = opts.knownTypes ?? FALLBACK_VALID_TYPES
  if (!raw || typeof raw !== 'object') throw new Error('Patch must be a JSON object')
  const r = raw as { operations?: unknown; summary?: unknown }
  // Be tolerant: a model that has nothing to do may legitimately return
  // just `{ summary: "..." }` (or omit the field entirely). Treat that as
  // an empty operations list rather than a hard parse error.
  if (r.operations === undefined || r.operations === null) {
    return { operations: [], summary: typeof r.summary === 'string' ? r.summary : undefined }
  }
  if (!Array.isArray(r.operations)) throw new Error('Patch.operations must be an array')
  const ops: AIPatchOp[] = []
  for (let i = 0; i < r.operations.length; i++) {
    const op = r.operations[i] as Record<string, unknown> | null
    if (!op || typeof op !== 'object') throw new Error(`Op #${i} is not an object`)
    const kind = op.op
    switch (kind) {
      case 'add_node': {
        if (typeof op.tempId !== 'string' || !op.tempId) throw new Error(`Op #${i} add_node: tempId required`)
        if (typeof op.type !== 'string' || !validTypes.has(op.type)) {
          throw new Error(`Op #${i} add_node: invalid type "${String(op.type)}" (allowed: ${[...validTypes].join(', ')})`)
        }
        if (typeof op.label !== 'string' || !op.label.trim()) throw new Error(`Op #${i} add_node: label required`)
        ops.push({
          op: 'add_node',
          tempId: op.tempId,
          type: op.type,
          label: op.label.trim(),
          description: typeof op.description === 'string' ? op.description : undefined,
          technology: typeof op.technology === 'string' ? op.technology : undefined,
          parentId: typeof op.parentId === 'string' ? op.parentId : null,
          external: op.external === true ? true : undefined,
        })
        break
      }
      case 'add_relation': {
        if (typeof op.sourceId !== 'string' || !op.sourceId) throw new Error(`Op #${i} add_relation: sourceId required`)
        if (typeof op.targetId !== 'string' || !op.targetId) throw new Error(`Op #${i} add_relation: targetId required`)
        ops.push({
          op: 'add_relation',
          sourceId: op.sourceId,
          targetId: op.targetId,
          label: typeof op.label === 'string' ? op.label : undefined,
          technology: typeof op.technology === 'string' ? op.technology : undefined,
        })
        break
      }
      case 'update_node': {
        if (typeof op.id !== 'string' || !op.id) throw new Error(`Op #${i} update_node: id required`)
        if (op.type !== undefined && (typeof op.type !== 'string' || !validTypes.has(op.type))) {
          throw new Error(`Op #${i} update_node: invalid type "${String(op.type)}" (allowed: ${[...validTypes].join(', ')})`)
        }
        ops.push({
          op: 'update_node',
          id: op.id,
          label: typeof op.label === 'string' ? op.label : undefined,
          description: typeof op.description === 'string' ? op.description : undefined,
          technology: typeof op.technology === 'string' ? op.technology : undefined,
          external: typeof op.external === 'boolean' ? op.external : undefined,
          type: typeof op.type === 'string' ? op.type : undefined,
        })
        break
      }
      case 'delete_node': {
        if (typeof op.id !== 'string' || !op.id) throw new Error(`Op #${i} delete_node: id required`)
        ops.push({ op: 'delete_node', id: op.id })
        break
      }
      case 'delete_relation': {
        if (typeof op.id !== 'string' || !op.id) throw new Error(`Op #${i} delete_relation: id required`)
        ops.push({ op: 'delete_relation', id: op.id })
        break
      }
      case 'add_view': {
        if (typeof op.tempId !== 'string' || !op.tempId) throw new Error(`Op #${i} add_view: tempId required`)
        if (typeof op.name !== 'string' || !op.name.trim()) throw new Error(`Op #${i} add_view: name required`)
        let nodeIds: string[] | undefined
        if (op.nodeIds !== undefined) {
          if (!Array.isArray(op.nodeIds) || op.nodeIds.some((x) => typeof x !== 'string'))
            throw new Error(`Op #${i} add_view: nodeIds must be an array of strings`)
          nodeIds = op.nodeIds as string[]
        }
        ops.push({
          op: 'add_view',
          tempId: op.tempId,
          name: op.name.trim(),
          nodeIds,
          active: op.active === true ? true : undefined,
        })
        break
      }
      case 'set_view_nodes': {
        if (typeof op.id !== 'string' || !op.id) throw new Error(`Op #${i} set_view_nodes: id required`)
        if (!Array.isArray(op.nodeIds) || op.nodeIds.some((x) => typeof x !== 'string'))
          throw new Error(`Op #${i} set_view_nodes: nodeIds must be an array of strings`)
        ops.push({ op: 'set_view_nodes', id: op.id, nodeIds: op.nodeIds as string[] })
        break
      }
      case 'delete_view': {
        if (typeof op.id !== 'string' || !op.id) throw new Error(`Op #${i} delete_view: id required`)
        ops.push({ op: 'delete_view', id: op.id })
        break
      }
      case 'set_active_view': {
        if (op.id !== null && (typeof op.id !== 'string' || !op.id))
          throw new Error(`Op #${i} set_active_view: id must be a string or null`)
        ops.push({ op: 'set_active_view', id: (op.id as string | null) })
        break
      }
      case 'focus_node': {
        if (typeof op.id !== 'string' || !op.id) throw new Error(`Op #${i} focus_node: id required`)
        ops.push({ op: 'focus_node', id: op.id })
        break
      }
      case 'reset_diagram': {
        ops.push({ op: 'reset_diagram' })
        break
      }
      case 'query_model': {
        if (typeof op.query !== 'string' || !op.query.trim()) {
          throw new Error(`Op #${i} query_model: query required`)
        }
        ops.push({ op: 'query_model', query: op.query.trim() })
        break
      }
      default:
        throw new Error(`Op #${i}: unknown op "${String(kind)}"`)
    }
  }
  return { operations: ops, summary: typeof r.summary === 'string' ? r.summary : undefined }
}

/**
 * Apply a validated patch through a DiagramFacade. Errors per-op are
 * collected in the report so a partial patch can still succeed.
 */
export function applyPatch(patch: AIPatch, diagram: DiagramFacade): ApplyReport {
  const report: ApplyReport = {
    added: { nodes: 0, relations: 0, views: 0 },
    updated: { nodes: 0, views: 0 },
    deleted: { nodes: 0, relations: 0, views: 0 },
    errors: [],
  }

  // Map of tempId -> realId for cross-op references inside this patch.
  // Shared namespace for both node tempIds and view tempIds — the model is
  // told to keep them globally unique within a patch.
  const tempToReal = new Map<string, string>()
  const resolveId = (id: string): string => tempToReal.get(id) ?? id

  // Simple grid placement for new nodes — live layout will reshuffle.
  let placeX = 80
  let placeY = 80
  const STEP_X = 360
  const PER_ROW = 4
  let placedThisCall = 0
  const placeNext = (): { x: number; y: number } => {
    const col = placedThisCall % PER_ROW
    const row = Math.floor(placedThisCall / PER_ROW)
    placedThisCall++
    return { x: placeX + col * STEP_X, y: placeY + row * 280 }
  }

  for (let i = 0; i < patch.operations.length; i++) {
    const op = patch.operations[i]
    try {
      if (op.op === 'add_node') {
        const size = NODE_SIZES[op.type as C4ElementType] ?? { width: 240, height: 140 }
        const pos = placeNext()
        const parentReal = op.parentId ? resolveId(op.parentId) : undefined
        if (parentReal && !(parentReal in diagram.getNodes())) {
          throw new Error(`add_node "${op.label}": unknown parentId "${op.parentId}"`)
        }
        const realId = diagram.addNode({
          type: op.type as C4ElementType,
          label: op.label,
          description: op.description,
          technology: op.technology,
          parentId: parentReal,
          external: op.external,
          collapsed: false,
          x: pos.x,
          y: pos.y,
          width: size.width,
          height: size.height,
        })
        if (!realId) throw new Error(`add_node "${op.label}" was rejected by the metamodel`)
        tempToReal.set(op.tempId, realId)
        report.added.nodes++
      } else if (op.op === 'add_relation') {
        const sId = resolveId(op.sourceId)
        const tId = resolveId(op.targetId)
        const nodes = diagram.getNodes()
        if (!(sId in nodes)) throw new Error(`add_relation: unknown sourceId "${op.sourceId}"`)
        if (!(tId in nodes)) throw new Error(`add_relation: unknown targetId "${op.targetId}"`)
        // The store may silently reject the relation when the (source, target)
        // type pair is not permitted by the active metamodel — it just pushes
        // a notification. Detect that by comparing the relations count before
        // and after, and surface a real error so the AI retry loop can react.
        const beforeCount = Object.keys(diagram.getRelations()).length
        diagram.addRelation({ sourceId: sId, targetId: tId, label: op.label, technology: op.technology })
        const afterCount = Object.keys(diagram.getRelations()).length
        if (afterCount === beforeCount) {
          const srcType = nodes[sId]?.type
          const dstType = nodes[tId]?.type
          throw new Error(
            `add_relation "${op.sourceId}" → "${op.targetId}" rejected by the metamodel`
            + (srcType && dstType ? ` (pair ${srcType} → ${dstType} is not in allowedPairs)` : ''),
          )
        }
        report.added.relations++
      } else if (op.op === 'update_node') {
        if (!(op.id in diagram.getNodes())) throw new Error(`update_node: unknown id "${op.id}"`)
        const updates: Partial<Omit<C4Node, 'id'>> = {}
        if (op.label !== undefined) updates.label = op.label
        if (op.description !== undefined) updates.description = op.description
        if (op.technology !== undefined) updates.technology = op.technology
        if (op.external !== undefined) updates.external = op.external
        if (op.type !== undefined) updates.type = op.type as C4ElementType
        diagram.updateNode(op.id, updates)
        report.updated.nodes++
      } else if (op.op === 'delete_node') {
        if (!(op.id in diagram.getNodes())) throw new Error(`delete_node: unknown id "${op.id}"`)
        diagram.removeNode(op.id)
        report.deleted.nodes++
      } else if (op.op === 'delete_relation') {
        if (!(op.id in diagram.getRelations())) throw new Error(`delete_relation: unknown id "${op.id}"`)
        diagram.removeRelation(op.id)
        report.deleted.relations++
      } else if (op.op === 'add_view') {
        if (!diagram.addView || !diagram.setViewNodes) {
          throw new Error('add_view: views are not editable in this context')
        }
        const realId = diagram.addView(op.name)
        if (!realId) throw new Error(`add_view "${op.name}" was rejected by the store`)
        tempToReal.set(op.tempId, realId)
        if (op.nodeIds && op.nodeIds.length > 0) {
          const resolved = op.nodeIds.map(resolveId)
          diagram.setViewNodes(realId, resolved)
        }
        if (op.active && diagram.setActiveView) diagram.setActiveView(realId)
        report.added.views++
      } else if (op.op === 'set_view_nodes') {
        if (!diagram.setViewNodes || !diagram.getViews) {
          throw new Error('set_view_nodes: views are not editable in this context')
        }
        const vId = resolveId(op.id)
        if (!(vId in diagram.getViews())) throw new Error(`set_view_nodes: unknown view id "${op.id}"`)
        const resolved = op.nodeIds.map(resolveId)
        diagram.setViewNodes(vId, resolved)
        report.updated.views++
      } else if (op.op === 'delete_view') {
        if (!diagram.removeView || !diagram.getViews) {
          throw new Error('delete_view: views are not editable in this context')
        }
        const vId = resolveId(op.id)
        if (!(vId in diagram.getViews())) throw new Error(`delete_view: unknown view id "${op.id}"`)
        diagram.removeView(vId)
        report.deleted.views++
      } else if (op.op === 'set_active_view') {
        if (!diagram.setActiveView) {
          throw new Error('set_active_view: views are not editable in this context')
        }
        if (op.id === null) {
          diagram.setActiveView(null)
        } else {
          const vId = resolveId(op.id)
          if (diagram.getViews && !(vId in diagram.getViews())) {
            throw new Error(`set_active_view: unknown view id "${op.id}"`)
          }
          diagram.setActiveView(vId)
        }
      } else if (op.op === 'focus_node') {
        const nId = resolveId(op.id)
        if (!(nId in diagram.getNodes())) {
          throw new Error(`focus_node: unknown node id "${op.id}"`)
        }
        // Record for the caller to execute after the patch is fully applied.
        report.focusNodeId = nId
      } else if (op.op === 'reset_diagram') {
        if (!diagram.clearDiagram) {
          throw new Error('reset_diagram: clearDiagram is not wired in this context')
        }
        diagram.clearDiagram()
        // After a reset all previous tempIds are invalid — clear the map so
        // subsequent add_node / add_view ops start with a fresh namespace.
        tempToReal.clear()
      } else if (op.op === 'query_model') {
        throw new Error('query_model must be handled by the AI runner before applyPatch')
      }
    } catch (err) {
      report.errors.push(`Op #${i} (${op.op}): ${(err as Error).message}`)
    }
  }

  return report
}
