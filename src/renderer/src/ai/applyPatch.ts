// ─── Apply an AI patch to the diagram store ────────────────────────────────
// Validates ops, resolves tempIds to real ids, places new nodes in a simple
// grid (the live layout reshuffles after). Returns a report so the UI can
// surface what actually happened.

import { NODE_SIZES, type C4ElementType, type C4Node, type C4Relation } from '../types/c4'
import type { Metamodel } from '../types/metamodel'
import type { AIPatch, AIPatchOp } from './types'

const VALID_TYPES: ReadonlySet<string> = new Set([
  'person', 'system', 'container', 'component', 'database', 'webapp', 'queue',
])

export interface ApplyReport {
  added: { nodes: number; relations: number }
  updated: { nodes: number }
  deleted: { nodes: number; relations: number }
  errors: string[]
}

export interface DiagramFacade {
  getNodes(): Record<string, C4Node>
  getRelations(): Record<string, C4Relation>
  /** Optional — used to inject metamodel rules into the AI system prompt. */
  getMetamodel?(): Metamodel | undefined
  /** Optional — active view info, used to tell the AI where new nodes land. */
  getActiveView?(): { id: string; name: string; nodeIds: string[] } | null
  addNode(node: Omit<C4Node, 'id'>): string
  updateNode(id: string, updates: Partial<Omit<C4Node, 'id'>>): void
  removeNode(id: string): void
  addRelation(rel: Omit<C4Relation, 'id'>): void
  updateRelation?(id: string, updates: Partial<Omit<C4Relation, 'id'>>): void
  removeRelation(id: string): void
}

/**
 * Validate the parsed JSON object and coerce it into an AIPatch.
 * Throws on shape errors so the caller can show a clear message.
 */
export function validatePatch(raw: unknown): AIPatch {
  if (!raw || typeof raw !== 'object') throw new Error('Patch must be a JSON object')
  const r = raw as { operations?: unknown; summary?: unknown }
  if (!Array.isArray(r.operations)) throw new Error('Patch.operations must be an array')
  const ops: AIPatchOp[] = []
  for (let i = 0; i < r.operations.length; i++) {
    const op = r.operations[i] as Record<string, unknown> | null
    if (!op || typeof op !== 'object') throw new Error(`Op #${i} is not an object`)
    const kind = op.op
    switch (kind) {
      case 'add_node': {
        if (typeof op.tempId !== 'string' || !op.tempId) throw new Error(`Op #${i} add_node: tempId required`)
        if (typeof op.type !== 'string' || !VALID_TYPES.has(op.type)) {
          throw new Error(`Op #${i} add_node: invalid type "${String(op.type)}"`)
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
        if (op.type !== undefined && (typeof op.type !== 'string' || !VALID_TYPES.has(op.type))) {
          throw new Error(`Op #${i} update_node: invalid type "${String(op.type)}"`)
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
    added: { nodes: 0, relations: 0 },
    updated: { nodes: 0 },
    deleted: { nodes: 0, relations: 0 },
    errors: [],
  }

  // Map of tempId -> realId for cross-op references inside this patch.
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
        diagram.addRelation({ sourceId: sId, targetId: tId, label: op.label, technology: op.technology })
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
      }
    } catch (err) {
      report.errors.push(`Op #${i} (${op.op}): ${(err as Error).message}`)
    }
  }

  return report
}
