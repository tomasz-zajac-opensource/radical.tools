import type { C4Node, C4Relation, DiagramView } from '../types/c4'

export const MODEL_QUERY_LANGUAGE_HELP = `BUILT-IN MODEL QUERY LANGUAGE:
When you need exact information from the CURRENT diagram structure, return one
or more query_model ops and nothing else. The runner will execute them locally
and send the results back to you in the next round. Do NOT mix query_model ops
with mutation ops in the same response.

Syntax:
- LIST NODES
- LIST NODES WHERE <field> <op> <value> [AND ...] [LIMIT n]
- LIST RELATIONS
- LIST RELATIONS WHERE <field> <op> <value> [AND ...] [LIMIT n]
- LIST VIEWS
- LIST VIEWS WHERE <field> <op> <value> [AND ...] [LIMIT n]
- LIST TECHNOLOGIES
- GET NODE <id>
- GET VIEW <id>
- GET CHILDREN OF <id>
- GET NEIGHBORS OF <id>
- STATS MODEL

Operators:
- =   exact match
- !=  exact non-match
- ~   case-insensitive substring match

Supported node fields:
- id, type, label, description, technology, parentId, external

Supported relation fields:
- id, sourceId, targetId, label, technology,
  source.label, source.type, target.label, target.type

Supported view fields:
- id, name

Examples:
- { "op": "query_model", "query": "LIST TECHNOLOGIES" }
- { "op": "query_model", "query": "LIST NODES WHERE label ~ \"auth\" LIMIT 5" }
- { "op": "query_model", "query": "GET NEIGHBORS OF node-123" }`.trim()

export interface ModelQueryContext {
  nodes: Record<string, C4Node>
  relations: Record<string, C4Relation>
  views?: Record<string, DiagramView>
}

export interface ModelQueryResult {
  query: string
  command: string
  result: unknown
}

type ConditionOp = '=' | '!=' | '~'

interface Condition {
  field: string
  op: ConditionOp
  value: string | boolean | null
}

const stripQuotes = (raw: string): string => {
  const trimmed = raw.trim()
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
    || (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

const parseValue = (raw: string): string | boolean | null => {
  const trimmed = stripQuotes(raw)
  if (/^true$/i.test(trimmed)) return true
  if (/^false$/i.test(trimmed)) return false
  if (/^null$/i.test(trimmed)) return null
  return trimmed
}

function parseConditions(whereRaw: string | undefined): Condition[] {
  if (!whereRaw) return []
  return whereRaw
    .split(/\s+AND\s+/i)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const m = part.match(/^([A-Za-z0-9_.]+)\s*(=|!=|~)\s*(.+)$/)
      if (!m) throw new Error(`Invalid WHERE clause fragment: ${part}`)
      return {
        field: m[1],
        op: m[2] as ConditionOp,
        value: parseValue(m[3]),
      }
    })
}

function cmp(actual: unknown, cond: Condition): boolean {
  if (cond.op === '~') {
    if (actual === undefined || actual === null) return false
    return String(actual).toLowerCase().includes(String(cond.value).toLowerCase())
  }
  if (cond.value === null) {
    const isNullish = actual === undefined || actual === null || actual === ''
    return cond.op === '=' ? isNullish : !isNullish
  }
  if (typeof cond.value === 'boolean') {
    return cond.op === '=' ? actual === cond.value : actual !== cond.value
  }
  const left = actual === undefined || actual === null ? '' : String(actual)
  const right = String(cond.value)
  return cond.op === '=' ? left === right : left !== right
}

function applyWhere<T>(rows: T[], conditions: Condition[], getter: (row: T, field: string) => unknown): T[] {
  if (conditions.length === 0) return rows
  return rows.filter((row) => conditions.every((cond) => cmp(getter(row, cond.field), cond)))
}

function viewNodeSet(view: DiagramView, nodes: Record<string, C4Node>): Set<string> {
  const set = new Set<string>()
  for (const id of view.nodeIds) {
    let cur: string | undefined = id
    while (cur && nodes[cur] && !set.has(cur)) {
      set.add(cur)
      cur = nodes[cur].parentId ?? undefined
    }
  }
  return set
}

function summarizeNode(node: C4Node) {
  return {
    id: node.id,
    type: node.type,
    label: node.label,
    description: node.description ?? null,
    technology: node.technology ?? null,
    parentId: node.parentId ?? null,
    external: node.external ?? false,
  }
}

function summarizeRelation(rel: C4Relation, nodes: Record<string, C4Node>) {
  const source = nodes[rel.sourceId]
  const target = nodes[rel.targetId]
  return {
    id: rel.id,
    sourceId: rel.sourceId,
    sourceLabel: source?.label ?? null,
    sourceType: source?.type ?? null,
    targetId: rel.targetId,
    targetLabel: target?.label ?? null,
    targetType: target?.type ?? null,
    label: rel.label ?? null,
    technology: rel.technology ?? null,
  }
}

function summarizeView(view: DiagramView, nodes: Record<string, C4Node>, relations: Record<string, C4Relation>) {
  const set = viewNodeSet(view, nodes)
  const hidden = new Set(view.hiddenRelationIds ?? [])
  const relationCount = Object.values(relations).filter((rel) => (
    set.has(rel.sourceId) && set.has(rel.targetId) && !hidden.has(rel.id)
  )).length
  return {
    id: view.id,
    name: view.name,
    nodeCount: set.size,
    relationCount,
    hiddenRelationCount: hidden.size,
  }
}

function getNodeField(node: C4Node, field: string): unknown {
  switch (field) {
    case 'id': return node.id
    case 'type': return node.type
    case 'label': return node.label
    case 'description': return node.description ?? null
    case 'technology': return node.technology ?? null
    case 'parentId': return node.parentId ?? null
    case 'external': return node.external ?? false
    default: throw new Error(`Unsupported node field: ${field}`)
  }
}

function getRelationField(rel: C4Relation, field: string, nodes: Record<string, C4Node>): unknown {
  const source = nodes[rel.sourceId]
  const target = nodes[rel.targetId]
  switch (field) {
    case 'id': return rel.id
    case 'sourceId': return rel.sourceId
    case 'targetId': return rel.targetId
    case 'label': return rel.label ?? null
    case 'technology': return rel.technology ?? null
    case 'source.label': return source?.label ?? null
    case 'source.type': return source?.type ?? null
    case 'target.label': return target?.label ?? null
    case 'target.type': return target?.type ?? null
    default: throw new Error(`Unsupported relation field: ${field}`)
  }
}

function getViewField(view: DiagramView, field: string): unknown {
  switch (field) {
    case 'id': return view.id
    case 'name': return view.name
    default: throw new Error(`Unsupported view field: ${field}`)
  }
}

function parseListQuery(query: string, kind: 'NODES' | 'RELATIONS' | 'VIEWS') {
  const match = query.match(new RegExp(`^LIST\\s+${kind}(?:\\s+WHERE\\s+(.+?))?(?:\\s+LIMIT\\s+(\\d+))?$`, 'i'))
  if (!match) return null
  return {
    conditions: parseConditions(match[1]),
    limit: match[2] ? Number(match[2]) : null,
  }
}

export function runModelQuery(query: string, ctx: ModelQueryContext): ModelQueryResult {
  const raw = query.trim()
  const upper = raw.toUpperCase()
  const views = ctx.views ?? {}

  const listNodes = parseListQuery(raw, 'NODES')
  if (listNodes) {
    const rows = applyWhere(
      Object.values(ctx.nodes).sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id)),
      listNodes.conditions,
      getNodeField,
    )
    const limited = listNodes.limit ? rows.slice(0, listNodes.limit) : rows
    return {
      query: raw,
      command: 'LIST NODES',
      result: { total: rows.length, rows: limited.map(summarizeNode) },
    }
  }

  const listRelations = parseListQuery(raw, 'RELATIONS')
  if (listRelations) {
    const rows = applyWhere(
      Object.values(ctx.relations).sort((a, b) => a.id.localeCompare(b.id)),
      listRelations.conditions,
      (rel, field) => getRelationField(rel, field, ctx.nodes),
    )
    const limited = listRelations.limit ? rows.slice(0, listRelations.limit) : rows
    return {
      query: raw,
      command: 'LIST RELATIONS',
      result: { total: rows.length, rows: limited.map((rel) => summarizeRelation(rel, ctx.nodes)) },
    }
  }

  const listViews = parseListQuery(raw, 'VIEWS')
  if (listViews) {
    const rows = applyWhere(
      Object.values(views).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)),
      listViews.conditions,
      getViewField,
    )
    const limited = listViews.limit ? rows.slice(0, listViews.limit) : rows
    return {
      query: raw,
      command: 'LIST VIEWS',
      result: { total: rows.length, rows: limited.map((view) => summarizeView(view, ctx.nodes, ctx.relations)) },
    }
  }

  if (upper === 'LIST TECHNOLOGIES') {
    const stats = new Map<string, { technology: string; nodeCount: number; relationCount: number }>()
    for (const node of Object.values(ctx.nodes)) {
      if (!node.technology) continue
      const key = node.technology
      const prev = stats.get(key) ?? { technology: key, nodeCount: 0, relationCount: 0 }
      prev.nodeCount++
      stats.set(key, prev)
    }
    for (const rel of Object.values(ctx.relations)) {
      if (!rel.technology) continue
      const key = rel.technology
      const prev = stats.get(key) ?? { technology: key, nodeCount: 0, relationCount: 0 }
      prev.relationCount++
      stats.set(key, prev)
    }
    const rows = [...stats.values()].sort((a, b) => a.technology.localeCompare(b.technology))
    return {
      query: raw,
      command: 'LIST TECHNOLOGIES',
      result: { total: rows.length, rows },
    }
  }

  if (upper === 'STATS MODEL') {
    const typeCounts = Object.values(ctx.nodes).reduce<Record<string, number>>((acc, node) => {
      acc[node.type] = (acc[node.type] ?? 0) + 1
      return acc
    }, {})
    return {
      query: raw,
      command: 'STATS MODEL',
      result: {
        nodeCount: Object.keys(ctx.nodes).length,
        relationCount: Object.keys(ctx.relations).length,
        viewCount: Object.keys(views).length,
        typeCounts,
      },
    }
  }

  const getNodeMatch = raw.match(/^GET\s+NODE\s+(.+)$/i)
  if (getNodeMatch) {
    const nodeId = stripQuotes(getNodeMatch[1])
    const node = ctx.nodes[nodeId]
    if (!node) throw new Error(`Unknown node id: ${nodeId}`)
    const children = Object.values(ctx.nodes)
      .filter((candidate) => candidate.parentId === nodeId)
      .sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id))
      .map(summarizeNode)
    const incoming = Object.values(ctx.relations)
      .filter((rel) => rel.targetId === nodeId)
      .map((rel) => summarizeRelation(rel, ctx.nodes))
    const outgoing = Object.values(ctx.relations)
      .filter((rel) => rel.sourceId === nodeId)
      .map((rel) => summarizeRelation(rel, ctx.nodes))
    const ancestors: ReturnType<typeof summarizeNode>[] = []
    let cur = node.parentId ? ctx.nodes[node.parentId] : undefined
    while (cur) {
      ancestors.unshift(summarizeNode(cur))
      cur = cur.parentId ? ctx.nodes[cur.parentId] : undefined
    }
    const containingViews = Object.values(views)
      .filter((view) => viewNodeSet(view, ctx.nodes).has(nodeId))
      .map((view) => ({ id: view.id, name: view.name }))
      .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
    return {
      query: raw,
      command: 'GET NODE',
      result: {
        node: summarizeNode(node),
        ancestors,
        children,
        incoming,
        outgoing,
        views: containingViews,
      },
    }
  }

  const getViewMatch = raw.match(/^GET\s+VIEW\s+(.+)$/i)
  if (getViewMatch) {
    const viewId = stripQuotes(getViewMatch[1])
    const view = views[viewId]
    if (!view) throw new Error(`Unknown view id: ${viewId}`)
    const set = viewNodeSet(view, ctx.nodes)
    const hidden = new Set(view.hiddenRelationIds ?? [])
    const nodes = [...set]
      .map((id) => ctx.nodes[id])
      .filter((node): node is C4Node => !!node)
      .sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id))
      .map(summarizeNode)
    const relations = Object.values(ctx.relations)
      .filter((rel) => set.has(rel.sourceId) && set.has(rel.targetId) && !hidden.has(rel.id))
      .map((rel) => summarizeRelation(rel, ctx.nodes))
    return {
      query: raw,
      command: 'GET VIEW',
      result: {
        view: summarizeView(view, ctx.nodes, ctx.relations),
        nodes,
        relations,
      },
    }
  }

  const getChildrenMatch = raw.match(/^GET\s+CHILDREN\s+OF\s+(.+)$/i)
  if (getChildrenMatch) {
    const nodeId = stripQuotes(getChildrenMatch[1])
    if (!ctx.nodes[nodeId]) throw new Error(`Unknown node id: ${nodeId}`)
    const rows = Object.values(ctx.nodes)
      .filter((node) => node.parentId === nodeId)
      .sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id))
      .map(summarizeNode)
    return {
      query: raw,
      command: 'GET CHILDREN OF',
      result: { total: rows.length, rows },
    }
  }

  const getNeighborsMatch = raw.match(/^GET\s+NEIGHBORS\s+OF\s+(.+)$/i)
  if (getNeighborsMatch) {
    const nodeId = stripQuotes(getNeighborsMatch[1])
    if (!ctx.nodes[nodeId]) throw new Error(`Unknown node id: ${nodeId}`)
    const rels = Object.values(ctx.relations).filter((rel) => rel.sourceId === nodeId || rel.targetId === nodeId)
    const neighborIds = new Set<string>()
    for (const rel of rels) {
      if (rel.sourceId !== nodeId) neighborIds.add(rel.sourceId)
      if (rel.targetId !== nodeId) neighborIds.add(rel.targetId)
    }
    const neighbors = [...neighborIds]
      .map((id) => ctx.nodes[id])
      .filter((node): node is C4Node => !!node)
      .sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id))
      .map(summarizeNode)
    return {
      query: raw,
      command: 'GET NEIGHBORS OF',
      result: {
        nodeId,
        neighbors,
        relations: rels.map((rel) => summarizeRelation(rel, ctx.nodes)),
      },
    }
  }

  throw new Error(`Unsupported query: ${raw}`)
}

export function formatModelQueryResults(results: ModelQueryResult[]): string {
  return JSON.stringify(results, null, 2)
}