// ─── System prompt & response parsing ───────────────────────────────────────
// The assistant is asked to return a JSON patch over the diagram. We bias it
// strongly toward emitting *only* a JSON object so we can parse it
// mechanically; jsonMode is also requested per-provider where supported.

import type { C4Node, C4Relation } from '../types/c4'
import type { ChatMessage } from './types'

const SUPPORTED_TYPES = [
  'person', 'system', 'container', 'component', 'database', 'webapp', 'queue',
] as const

export const AI_SYSTEM_PROMPT = `You are a C4 architecture diagram editor embedded in the Radical Diagram tool.

Your job is to take the user's request and return a JSON patch describing the
changes to apply to the diagram. ALWAYS return ONLY a single JSON object —
no prose, no Markdown fences. The object must have this exact shape:

{
  "summary": "<one short sentence describing what you did>",
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

Rules:
- Allowed node \`type\` values: ${SUPPORTED_TYPES.map(t => `"${t}"`).join(', ')}.
- For new nodes, invent a stable \`tempId\` ("t1", "t2", ...) so other ops in
  the same patch can reference it via \`parentId\`, \`sourceId\` or \`targetId\`.
- Reference existing elements by their real id from the context block below.
- C4 nesting: a "container" usually has \`parentId\` pointing at a "system";
  a "component" usually has \`parentId\` pointing at a "container".
  Persons and top-level systems have no parent.
- Keep labels short (1–4 words). Put detail in \`description\`.
- Do NOT fabricate ids that are not present in the context block.
- If the request cannot be done, return { "summary": "<reason>", "operations": [] }.
`.trim()

export function buildContextMessage(
  nodes: Record<string, C4Node>,
  relations: Record<string, C4Relation>,
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
  return [
    'Current diagram state (use these ids when referring to existing elements):',
    '```json',
    JSON.stringify({ nodes: ns, relations: rs }, null, 2),
    '```',
  ].join('\n')
}

export function buildMessages(
  userPrompt: string,
  nodes: Record<string, C4Node>,
  relations: Record<string, C4Relation>,
  history: ChatMessage[] = [],
): ChatMessage[] {
  return [
    { role: 'system', content: AI_SYSTEM_PROMPT },
    { role: 'system', content: buildContextMessage(nodes, relations) },
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
