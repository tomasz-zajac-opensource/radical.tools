// ─── System prompt & response parsing ───────────────────────────────────────
// The assistant is asked to return a JSON patch over the diagram. We bias it
// strongly toward emitting *only* a JSON object so we can parse it
// mechanically; jsonMode is also requested per-provider where supported.

import type { C4Node, C4Relation, DiagramView } from '../types/c4'
import type { Metamodel } from '../types/metamodel'
import { MODEL_QUERY_LANGUAGE_HELP } from './queryLanguage'
import type { ChatMessage } from './types'

const FALLBACK_TYPES = [
  'person', 'system', 'container', 'component', 'database', 'webapp', 'queue',
] as const

export const AI_SYSTEM_PROMPT = `You are a C4 architecture diagram editor embedded in the Radical Diagram tool.

Your job is to take the user's request and return a JSON patch describing the
changes to apply to the diagram, OR — when the user asks a question about the
model — a detailed text answer in the "summary" field with no ops.

ALWAYS return ONLY a single JSON object — no prose, no Markdown fences.
The object must have this exact shape:

{
  "summary": "<one sentence (mutations) OR full answer text (queries)>",
  "operations": [ <op>, <op>, ... ]
}

Each <op> must be one of:

  { "op": "add_node",        "tempId": "t1", "type": "<type>", "label": "<label>",
    "description"?: string, "technology"?: string, "parentId"?: string|null,
    "external"?: boolean }

  { "op": "add_relation",    "sourceId": "<id|tempId>", "targetId": "<id|tempId>",
    "label"?: string, "technology"?: string }

  { "op": "update_node",     "id": "<existing-node-id>",
    "label"?: string, "description"?: string, "technology"?: string,
    "external"?: boolean, "type"?: "<type>" }

  { "op": "delete_node",     "id": "<existing-node-id>" }
  { "op": "delete_relation", "id": "<existing-relation-id>" }

  { "op": "add_view",        "tempId": "v1", "name": "<view name>",
    "nodeIds"?: string[], "active"?: boolean }

  { "op": "set_view_nodes",  "id": "<view-id|tempId>", "nodeIds": string[] }

  { "op": "delete_view",     "id": "<view-id|tempId>" }
  { "op": "set_active_view", "id": "<view-id|tempId>|null" }

  { "op": "focus_node",      "id": "<real-node-id|tempId>" }
    — Pan and zoom the canvas to this node. Use it as the LAST op when the
      user asks to "show", "find", "navigate to", or "highlight" a specific
      element. Combine with set_active_view / add_view if the node is not
      visible in the current view.

  { "op": "reset_diagram" }
    — Erase EVERY node, relation and view before the remaining ops run.
      Use ONLY when the user explicitly asks to "start from scratch",
      "replace the whole model", or "create a completely new architecture".
      MUST be the very first op in the operations array.

  { "op": "query_model", "query": "<query language string>" }
    — Ask the built-in LOCAL query engine to inspect the CURRENT model.
      Use this when you need exact data from the live graph before answering
      or mutating it. If you use query_model, return ONLY query_model ops in
      that response. After the results come back, return the final JSON object.

General rules:
- For new nodes AND new views, invent a stable \`tempId\` ("t1", "v1", ...) so
  other ops in the same patch can reference them via \`parentId\`,
  \`sourceId\`, \`targetId\`, view \`id\` or view \`nodeIds\`. Tempids share one
  namespace per patch — keep them globally unique.
- Reference existing elements by their real id from the context block below.
- Keep labels short (1–4 words). Put detail in \`description\`.
- Do NOT fabricate ids that are not present in the context block.
- Views are FILTERS over the model graph: a view only stores which nodes are
  visible (its \`nodeIds\`). Relations whose both endpoints are visible in the
  view are shown automatically. Use \`add_view\` + \`nodeIds\` (or
  \`set_view_nodes\`) to build a focused view (e.g. "all direct neighbours of
  the cache"). Set \`active\` to true on \`add_view\` to switch to it.
- Cannot change the layout, themes, or the metamodel. If the user asks for
  any of those, return
  { "summary": "<polite explanation>", "operations": [] }.
- STRICTLY follow the metamodel rules in the context block: an add_node that
  violates allowedParents/allowedAtRoot/cardinality WILL BE REJECTED, breaking
  any later op that references its tempId. When you need a child of a type
  that requires a specific parent, EITHER reuse an existing parent id from
  the context, OR add the parent first in the same patch and reference its
  tempId via \`parentId\`.
- If the request cannot be done within the metamodel, return
  { "summary": "<reason>", "operations": [] }.

QUERY MODE — answering questions without changing the diagram:
When the user asks an informational question (e.g. "list all technologies",
"what systems exist", "summarise the architecture", "find nodes that use X"),
return operations: [] and put the FULL answer in the "summary" field.
Use newlines and bullet characters (\u2022 or -) to format lists. Be thorough.
Examples:
  • "list all technologies" → list every unique technology field value found in nodes/relations
  • "summarise the architecture" → paragraph description of the overall model
  • "which containers call the database?" → list matching relation source nodes

${MODEL_QUERY_LANGUAGE_HELP}
`.trim()

/** Build a compact, machine-readable summary of the metamodel rules. */
export function buildMetamodelMessage(mm: Metamodel | undefined): string {
  if (!mm) {
    return [
      'Metamodel: (none loaded — falling back to default C4 types)',
      'Allowed node types: ' + FALLBACK_TYPES.map(t => `"${t}"`).join(', '),
    ].join('\n')
  }
  const types = Object.values(mm.nodeTypes).map((t) => {
    // Mirror the same defaulting that diagramStore uses: when allowedParents is
    // empty/undefined the type is allowed at the root unless explicitly false.
    const allowedParents = t.allowedParents && t.allowedParents.length > 0 ? t.allowedParents : []
    const rootDefault = allowedParents.length === 0
    const atRoot = t.allowedAtRoot ?? rootDefault
    return {
      id: t.id,
      label: t.label,
      allowedParents,
      allowedAtRoot: atRoot,
      cardinality: t.cardinality,
    }
  })
  const relations = Object.values(mm.relationTypes).map((r) => ({
    id: r.id,
    label: r.label,
    allowedPairs: r.allowedPairs,
  }))
  return [
    `Metamodel "${mm.name}". Use ONLY the node types listed below; respect`,
    '`allowedParents` (empty ⇒ requires `allowedAtRoot: true` to be a root node)',
    'and `cardinality.max` (skip the op if the limit is already reached).',
    '```json',
    JSON.stringify({ nodeTypes: types, relationTypes: relations }, null, 2),
    '```',
  ].join('\n')
}

export function buildContextMessage(
  nodes: Record<string, C4Node>,
  relations: Record<string, C4Relation>,
  activeView?: { id: string; name: string; nodeIds: string[] } | null,
  views?: Record<string, DiagramView>,
): string {
  const ns = Object.values(nodes).map((n) => ({
    id: n.id,
    type: n.type,
    label: n.label,
    parentId: n.parentId ?? null,
    description: n.description || undefined,
    technology: n.technology || undefined,
    external: n.external || undefined,
  }))
  const rs = Object.values(relations).map((r) => ({
    id: r.id,
    sourceId: r.sourceId,
    targetId: r.targetId,
    label: r.label || undefined,
    technology: r.technology || undefined,
  }))
  const vs = views
    ? Object.values(views).map((v) => ({
        id: v.id,
        name: v.name,
        nodeIds: v.nodeIds,
      }))
    : []
  const lines = [
    'Current diagram state (use these ids when referring to existing elements):',
    '```json',
    JSON.stringify({ nodes: ns, relations: rs, views: vs }, null, 2),
    '```',
  ]
  if (activeView) {
    lines.push(
      `Active view: "${activeView.name}" (id=${activeView.id}). New nodes will`,
      'be auto-added to this view.',
    )
  } else {
    lines.push('Active view: (none) — new nodes will live in the model only.')
  }
  return lines.join('\n')
}

export function buildMessages(
  userPrompt: string,
  nodes: Record<string, C4Node>,
  relations: Record<string, C4Relation>,
  history: ChatMessage[] = [],
  metamodel?: Metamodel,
  activeView?: { id: string; name: string; nodeIds: string[] } | null,
  views?: Record<string, DiagramView>,
): ChatMessage[] {
  return [
    { role: 'system', content: AI_SYSTEM_PROMPT },
    { role: 'system', content: buildMetamodelMessage(metamodel) },
    { role: 'system', content: buildContextMessage(nodes, relations, activeView, views) },
    ...history,
    { role: 'user', content: userPrompt },
  ]
}

/**
 * Pull a JSON object out of an assistant response. Tolerates ```json fences
 * and stray prose around the object — we look for the first balanced
 * top-level { ... } and parse that.
 */
export function extractJsonObject(text: string): unknown {
  if (!text) throw new Error('Empty response from model')
  const trimmed = text.trim()
  // Strip fenced code blocks: ```json ... ``` or ``` ... ```
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fenced ? fenced[1].trim() : trimmed
  // Find first balanced object
  const start = candidate.indexOf('{')
  if (start < 0) throw new Error('No JSON object found in response')
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = start; i < candidate.length; i++) {
    const ch = candidate[i]
    if (inStr) {
      if (esc) esc = false
      else if (ch === '\\') esc = true
      else if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') { inStr = true; continue }
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) {
        const slice = candidate.slice(start, i + 1)
        return JSON.parse(slice)
      }
    }
  }
  throw new Error('Unbalanced JSON object in response')
}
