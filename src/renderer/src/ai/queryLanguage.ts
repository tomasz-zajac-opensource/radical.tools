import type { C4Node, C4Relation, DiagramView } from '../types/c4'

export const MODEL_QUERY_LANGUAGE_HELP = `BUILT-IN MODEL QUERY LANGUAGE:
When you need exact information from the CURRENT diagram structure, return one
or more query_model ops and nothing else. The runner will execute them locally
and send the results back to you in the next round. Do NOT mix query_model ops
with mutation ops in the same response.

Syntax:
- LIST NODES
- LIST NODES WHERE <expr> [LIMIT n]
- LIST RELATIONS
- LIST RELATIONS WHERE <expr> [LIMIT n]
- LIST VIEWS
- LIST VIEWS WHERE <expr> [LIMIT n]
- LIST TECHNOLOGIES
- GET NODE <id>
- GET VIEW <id>
- GET CHILDREN OF <id>
- GET NEIGHBORS OF <id> [DEPTH n]
- GET DEPENDENCIES OF <id> [DEPTH n]
- GET DEPENDENTS OF <id> [DEPTH n]
- STATS MODEL

Operators:
- =   exact match
- !=  exact non-match
- ~   case-insensitive substring match

Boolean logic in WHERE:
- AND, OR, NOT
- Parentheses are supported: ( ... )

Supported node fields:
- id, type, label, description, technology, parentId, external

Supported relation fields:
- id, sourceId, targetId, label, technology,
  source.label, source.type, target.label, target.type

Supported view fields:
- id, name

Examples:
- { "op": "query_model", "query": "LIST TECHNOLOGIES" }
- { "op": "query_model", "query": "LIST NODES WHERE label ~ \"auth\" OR technology ~ \"oauth\" LIMIT 5" }
- { "op": "query_model", "query": "LIST RELATIONS WHERE NOT technology = \"SQL\"" }
- { "op": "query_model", "query": "GET NEIGHBORS OF node-123 DEPTH 2" }
- { "op": "query_model", "query": "GET DEPENDENTS OF database-1 DEPTH 4" }`.trim()

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

type WhereExpr =
  | { kind: 'condition'; condition: Condition }
  | { kind: 'and'; left: WhereExpr; right: WhereExpr }
  | { kind: 'or'; left: WhereExpr; right: WhereExpr }
  | { kind: 'not'; expr: WhereExpr }

type QueryToken =
  | { kind: 'ident'; value: string }
  | { kind: 'string'; value: string }
  | { kind: 'op'; value: ConditionOp }
  | { kind: 'lparen' }
  | { kind: 'rparen' }
  | { kind: 'logic'; value: 'AND' | 'OR' | 'NOT' }

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

function tokenizeWhere(whereRaw: string): QueryToken[] {
  const tokens: QueryToken[] = []
  let i = 0
  while (i < whereRaw.length) {
    const ch = whereRaw[i]
    if (/\s/.test(ch)) {
      i++
      continue
    }
    if (ch === '(') {
      tokens.push({ kind: 'lparen' })
      i++
      continue
    }
    if (ch === ')') {
      tokens.push({ kind: 'rparen' })
      i++
      continue
    }
    if (ch === '!' && whereRaw[i + 1] === '=') {
      tokens.push({ kind: 'op', value: '!=' })
      i += 2
      continue
    }
    if (ch === '=') {
      tokens.push({ kind: 'op', value: '=' })
      i++
      continue
    }
    if (ch === '~') {
      tokens.push({ kind: 'op', value: '~' })
      i++
      continue
    }
    if (ch === '"' || ch === "'") {
      const quote = ch
      i++
      let value = ''
      while (i < whereRaw.length && whereRaw[i] !== quote) {
        if (whereRaw[i] === '\\' && i + 1 < whereRaw.length) {
          value += whereRaw[i + 1]
          i += 2
          continue
        }
        value += whereRaw[i]
        i++
      }
      if (i >= whereRaw.length) throw new Error('Unterminated string in WHERE clause')
      i++
      tokens.push({ kind: 'string', value })
      continue
    }
    const identMatch = whereRaw.slice(i).match(/^[A-Za-z0-9_.-]+/)
    if (identMatch) {
      const value = identMatch[0]
      const upper = value.toUpperCase()
      if (upper === 'AND' || upper === 'OR' || upper === 'NOT') {
        tokens.push({ kind: 'logic', value: upper })
      } else {
        tokens.push({ kind: 'ident', value })
      }
      i += value.length
      continue
    }
    throw new Error(`Unexpected token in WHERE clause near: ${whereRaw.slice(i)}`)
  }
  return tokens
}

function parseWhereExpr(whereRaw: string | undefined): WhereExpr | null {
  if (!whereRaw) return null
  const tokens = tokenizeWhere(whereRaw)
  let index = 0

  const parseValueToken = (): string | boolean | null => {
    const token = tokens[index]
    if (!token) throw new Error('Expected value in WHERE clause')
    if (token.kind === 'string' || token.kind === 'ident') {
      index++
      return parseValue(token.value)
    }
    throw new Error('Expected value in WHERE clause')
  }

  const parsePrimary = (): WhereExpr => {
    const token = tokens[index]
    if (!token) throw new Error('Unexpected end of WHERE clause')
    if (token.kind === 'lparen') {
      index++
      const expr = parseOr()
      if (!tokens[index] || tokens[index].kind !== 'rparen') {
        throw new Error('Expected closing parenthesis in WHERE clause')
      }
      index++
      return expr
    }
    if (token.kind !== 'ident') throw new Error('Expected field name in WHERE clause')
    const field = token.value
    index++
    const op = tokens[index]
    if (!op || op.kind !== 'op') throw new Error(`Expected operator after field ${field}`)
    index++
    return {
      kind: 'condition',
      condition: {
        field,
        op: op.value,
        value: parseValueToken(),
      },
    }
  }

  const parseUnary = (): WhereExpr => {
    const token = tokens[index]
    if (token?.kind === 'logic' && token.value === 'NOT') {
      index++
      return { kind: 'not', expr: parseUnary() }
    }
    return parsePrimary()
  }

  const parseAnd = (): WhereExpr => {
    let expr = parseUnary()
    let token = tokens[index]
    while (token?.kind === 'logic' && token.value === 'AND') {
      index++
      expr = { kind: 'and', left: expr, right: parseUnary() }
      token = tokens[index]
    }
    return expr
  }

  const parseOr = (): WhereExpr => {
    let expr = parseAnd()
    let token = tokens[index]
    while (token?.kind === 'logic' && token.value === 'OR') {
      index++
      expr = { kind: 'or', left: expr, right: parseAnd() }
      token = tokens[index]
    }
    return expr
  }

  const expr = parseOr()
  if (index !== tokens.length) throw new Error('Unexpected trailing tokens in WHERE clause')
  return expr
}

function evalWhereExpr<T>(expr: WhereExpr | null, row: T, getter: (row: T, field: string) => unknown): boolean {
  if (!expr) return true
  switch (expr.kind) {
    case 'condition':
      return cmp(getter(row, expr.condition.field), expr.condition)
    case 'and':
      return evalWhereExpr(expr.left, row, getter) && evalWhereExpr(expr.right, row, getter)
    case 'or':
      return evalWhereExpr(expr.left, row, getter) || evalWhereExpr(expr.right, row, getter)
    case 'not':
      return !evalWhereExpr(expr.expr, row, getter)
  }
}

function applyWhere<T>(rows: T[], expr: WhereExpr | null, getter: (row: T, field: string) => unknown): T[] {
  if (!expr) return rows
  return rows.filter((row) => evalWhereExpr(expr, row, getter))
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
  const limit = match[2] ? Number(match[2]) : null
  if (limit !== null && (!Number.isInteger(limit) || limit < 1)) {
    throw new Error('LIMIT must be a positive integer')
  }
  return {
    expr: parseWhereExpr(match[1]),
    limit,
  }
}

function parseDepthQuery(query: string, command: string) {
  const match = query.match(new RegExp(`^${command}\\s+(.+?)(?:\\s+DEPTH\\s+(\\d+))?$`, 'i'))
  if (!match) return null
  const depth = match[2] ? Number(match[2]) : 1
  if (!Number.isInteger(depth) || depth < 1) throw new Error('DEPTH must be a positive integer')
  return {
    id: stripQuotes(match[1]),
    depth,
  }
}

interface TraversalSummaryRow {
  node: ReturnType<typeof summarizeNode>
  depth: number
}

function traverseFrom(
  startNodeId: string,
  maxDepth: number,
  neighborsOf: (id: string) => string[],
): Map<string, number> {
  const seen = new Set<string>([startNodeId])
  const reached = new Map<string, number>()
  const queue: Array<{ id: string; depth: number }> = [{ id: startNodeId, depth: 0 }]
  while (queue.length > 0) {
    const current = queue.shift()!
    if (current.depth >= maxDepth) continue
    for (const nextId of neighborsOf(current.id)) {
      if (seen.has(nextId)) continue
      seen.add(nextId)
      const depth = current.depth + 1
      reached.set(nextId, depth)
      queue.push({ id: nextId, depth })
    }
  }
  return reached
}

function summarizeTraversalResults(
  startNodeId: string,
  reached: Map<string, number>,
  nodes: Record<string, C4Node>,
  relations: C4Relation[],
) {
  const rows: TraversalSummaryRow[] = [...reached.entries()]
    .map(([id, depth]) => ({ id, depth, node: nodes[id] }))
    .filter((item): item is { id: string; depth: number; node: C4Node } => !!item.node)
    .sort((a, b) => a.depth - b.depth || a.node.label.localeCompare(b.node.label) || a.id.localeCompare(b.id))
    .map(({ node, depth }) => ({ node: summarizeNode(node), depth }))
  const reachedSet = new Set(reached.keys())
  const relationRows = relations
    .filter((rel) => (
      (rel.sourceId === startNodeId && reachedSet.has(rel.targetId))
      || (rel.targetId === startNodeId && reachedSet.has(rel.sourceId))
      || (reachedSet.has(rel.sourceId) && reachedSet.has(rel.targetId))
    ))
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((rel) => summarizeRelation(rel, nodes))
  return {
    nodeId: startNodeId,
    total: rows.length,
    neighbors: rows.map((row) => row.node),
    rows,
    relations: relationRows,
  }
}

export function runModelQuery(query: string, ctx: ModelQueryContext): ModelQueryResult {
  const raw = query.trim()
  const upper = raw.toUpperCase()
  const views = ctx.views ?? {}
  const relations = Object.values(ctx.relations)

  const listNodes = parseListQuery(raw, 'NODES')
  if (listNodes) {
    const rows = applyWhere(
      Object.values(ctx.nodes).sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id)),
      listNodes.expr,
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
      relations.slice().sort((a, b) => a.id.localeCompare(b.id)),
      listRelations.expr,
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
      listViews.expr,
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
    for (const rel of relations) {
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
        relationCount: relations.length,
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
    const incoming = relations
      .filter((rel) => rel.targetId === nodeId)
      .map((rel) => summarizeRelation(rel, ctx.nodes))
    const outgoing = relations
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
    const visibleRelations = relations
      .filter((rel) => set.has(rel.sourceId) && set.has(rel.targetId) && !hidden.has(rel.id))
      .map((rel) => summarizeRelation(rel, ctx.nodes))
    return {
      query: raw,
      command: 'GET VIEW',
      result: {
        view: summarizeView(view, ctx.nodes, ctx.relations),
        nodes,
        relations: visibleRelations,
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

  const neighborsQuery = parseDepthQuery(raw, 'GET\\s+NEIGHBORS\\s+OF')
  if (neighborsQuery) {
    const nodeId = neighborsQuery.id
    if (!ctx.nodes[nodeId]) throw new Error(`Unknown node id: ${nodeId}`)
    const reached = traverseFrom(nodeId, neighborsQuery.depth, (id) => (
      relations
        .filter((rel) => rel.sourceId === id || rel.targetId === id)
        .map((rel) => rel.sourceId === id ? rel.targetId : rel.sourceId)
    ))
    return {
      query: raw,
      command: 'GET NEIGHBORS OF',
      result: summarizeTraversalResults(nodeId, reached, ctx.nodes, relations),
    }
  }

  const dependenciesQuery = parseDepthQuery(raw, 'GET\\s+DEPENDENCIES\\s+OF')
  if (dependenciesQuery) {
    const nodeId = dependenciesQuery.id
    if (!ctx.nodes[nodeId]) throw new Error(`Unknown node id: ${nodeId}`)
    const reached = traverseFrom(nodeId, dependenciesQuery.depth, (id) => (
      relations.filter((rel) => rel.sourceId === id).map((rel) => rel.targetId)
    ))
    return {
      query: raw,
      command: 'GET DEPENDENCIES OF',
      result: summarizeTraversalResults(nodeId, reached, ctx.nodes, relations),
    }
  }

  const dependentsQuery = parseDepthQuery(raw, 'GET\\s+DEPENDENTS\\s+OF')
  if (dependentsQuery) {
    const nodeId = dependentsQuery.id
    if (!ctx.nodes[nodeId]) throw new Error(`Unknown node id: ${nodeId}`)
    const reached = traverseFrom(nodeId, dependentsQuery.depth, (id) => (
      relations.filter((rel) => rel.targetId === id).map((rel) => rel.sourceId)
    ))
    return {
      query: raw,
      command: 'GET DEPENDENTS OF',
      result: summarizeTraversalResults(nodeId, reached, ctx.nodes, relations),
    }
  }

  throw new Error(`Unsupported query: ${raw}`)
}

export function formatModelQueryResults(results: ModelQueryResult[]): string {
  return JSON.stringify(results, null, 2)
}