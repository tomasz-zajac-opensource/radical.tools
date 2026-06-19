/**
 * Structurizr DSL → radical.diagram DiagramData importer.
 *
 * Handles a practical subset of the Structurizr DSL:
 *   • person, softwareSystem, container, component elements
 *   • group blocks  →  mapped to the 'group' node type
 *   • variable assignment:  varName = keyword "label" ...
 *   • hierarchical identifiers in relationships:  sys.container -> sys2.ctn
 *   • tags block and inline tag strings:
 *       - "External System" / "External Person" → external: true
 *       - "Database" / "MS SQL db" / "Oracle db" → type: 'database'
 *   • relationships with optional label and technology strings
 *
 * Sections not relevant to the node/relation model (views, styles,
 * configuration, deployment, …) are skipped.
 *
 * All positions are set to (0,0) so the diagram auto-layouts on first open.
 */

import type { C4Node, C4Relation, C4ElementType } from '../types/c4'
import { NODE_SIZES } from '../types/c4'

// ─── Public result type ───────────────────────────────────────────────────────

export interface StructurizrDslResult {
  nodes: C4Node[]
  relations: C4Relation[]
  /** Workspace name from the DSL, used as the document display name. */
  name: string
}

// ─── Tokenizer ────────────────────────────────────────────────────────────────

type TokKind = 'STR' | 'IDENT' | 'ARROW' | 'LBRACE' | 'RBRACE' | 'EQ' | 'EOF'
interface Tok { kind: TokKind; val: string }

function tokenize(src: string): Tok[] {
  // Strip comments before tokenising.
  const s = src
    .replace(/\/\/[^\n]*/g, '')        // line comments
    .replace(/\/\*[\s\S]*?\*\//g, '')  // block comments

  const out: Tok[] = []
  let i = 0

  while (i < s.length) {
    const c = s[i]

    if (/\s/.test(c)) { i++; continue }

    // Arrow  ->
    if (c === '-' && s[i + 1] === '>') {
      out.push({ kind: 'ARROW', val: '->' }); i += 2; continue
    }

    // String literal  "..."
    if (c === '"') {
      i++
      let val = ''
      while (i < s.length && s[i] !== '"') {
        if (s[i] === '\\') { i++; val += s[i] ?? '' } else val += s[i]
        i++
      }
      i++ // closing "
      out.push({ kind: 'STR', val }); continue
    }

    if (c === '{') { out.push({ kind: 'LBRACE', val: '{' }); i++; continue }
    if (c === '}') { out.push({ kind: 'RBRACE', val: '}' }); i++; continue }
    if (c === '=') { out.push({ kind: 'EQ',     val: '=' }); i++; continue }

    // Identifier — may contain dots (hierarchical paths like sys.container)
    // and starts with letter, underscore, or ! (DSL directives like !identifiers)
    if (/[a-zA-Z_!]/.test(c)) {
      let j = i
      while (j < s.length && /[a-zA-Z0-9_\-.!]/.test(s[j])) j++
      out.push({ kind: 'IDENT', val: s.slice(i, j) }); i = j; continue
    }

    i++ // skip unrecognised chars
  }

  out.push({ kind: 'EOF', val: '' })
  return out
}

// ─── Parser ───────────────────────────────────────────────────────────────────

/** DSL element keywords (matched case-insensitively). */
const ELEMENT_KW = new Set(['person', 'softwaresystem', 'container', 'component', 'group'])

/** Body-level keywords that introduce a sub-block or inline value to skip. */
const SKIP_BODY_KW = new Set([
  'properties', 'description', 'url', 'metadata', 'perspective', 'perspectives',
])

function lc(s: string): string { return s.toLowerCase() }

export function parseStructurizrDsl(src: string): StructurizrDslResult {
  const toks = tokenize(src)
  let p = 0

  const peek = (off = 0): Tok => toks[Math.min(p + off, toks.length - 1)]
  const eat  = (): Tok => { const t = toks[p]; if (p < toks.length - 1) p++; return t }

  let workspaceName = 'Imported diagram'
  const nodes: C4Node[]     = []
  const relations: C4Relation[] = []

  /** Simple var-name → node-id map (case-folded). */
  const varMap  = new Map<string, string>()
  /** Hierarchical "parent.child" → node-id map (case-folded). */
  const hierMap = new Map<string, string>()

  let relIdx = 0

  // ── Helpers ────────────────────────────────────────────────────────────────

  /** Skip over a complete { ... } block (including nested braces). */
  function skipBlock(): void {
    if (peek().kind !== 'LBRACE') return
    eat()
    let depth = 1
    while (peek().kind !== 'EOF' && depth > 0) {
      const t = eat()
      if (t.kind === 'LBRACE') depth++
      else if (t.kind === 'RBRACE') depth--
    }
  }

  /** Consume consecutive STR tokens and return their values. */
  function consumeStrings(): string[] {
    const ss: string[] = []
    while (peek().kind === 'STR') ss.push(eat().val)
    return ss
  }

  /** Turn a hint string into a safe, lower-case, hyphen-separated id. */
  function mkId(hint: string): string {
    return hint.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'n'
  }

  /** Append a numeric suffix if `base` is already taken. */
  function uniqueId(base: string): string {
    if (!nodes.some(n => n.id === base)) return base
    let i = 2
    while (nodes.some(n => n.id === `${base}-${i}`)) i++
    return `${base}-${i}`
  }

  /**
   * Register a node in the output list and in the lookup maps.
   * @param varName   The DSL variable name assigned to this element (or null).
   * @param ancestors Array of ancestor variable names from outermost to the
   *                  immediate parent — used to build hierarchical lookup keys
   *                  so that  "parent.childVar" resolves correctly.
   */
  function register(node: C4Node, varName: string | null, ancestors: string[]): void {
    nodes.push(node)
    if (!varName) return
    const lv = lc(varName)
    varMap.set(lv, node.id)
    // Register with each ancestor: "ancestor.varName" → id
    for (const a of ancestors) hierMap.set(`${lc(a)}.${lv}`, node.id)
  }

  /**
   * Resolve a DSL identifier reference (possibly hierarchical like "Sys.Ctn")
   * to an internal node id.
   */
  function resolveId(ref: string): string | null {
    const k = lc(ref)
    if (hierMap.has(k)) return hierMap.get(k)!
    if (varMap.has(k)) return varMap.get(k)!
    // Try progressively shorter suffixes of a dotted path
    const parts = k.split('.')
    for (let i = 1; i < parts.length; i++) {
      const sub = parts.slice(i).join('.')
      if (hierMap.has(sub)) return hierMap.get(sub)!
    }
    for (let i = 1; i < parts.length; i++) {
      if (varMap.has(parts[i])) return varMap.get(parts[i])!
    }
    return null
  }

  /** Infer the C4 node type from the DSL keyword and collected tag string. */
  function inferType(kw: string, tags: string): C4ElementType {
    const k = lc(kw)
    if (k === 'person')        return 'person'
    if (k === 'softwaresystem') return 'system'
    if (k === 'group')         return 'group'
    if (k === 'component')     return 'component'
    if (k === 'container') {
      if (isDbTags(tags)) return 'database'
      return 'container'
    }
    return 'container'
  }

  /** True when tag strings indicate this is a database element. */
  function isDbTags(tags: string): boolean {
    const t = lc(tags)
    return (
      t.includes('database') ||
      / db(\b|$)/.test(t)   ||
      t.includes('ms sql')   ||
      t.includes('oracle db')
    )
  }

  // ── Parse element body  { ... }  ─────────────────────────────────────────
  //
  // @param parentId   Node-id of the element whose body we're parsing.
  // @param parentVar  Variable name of that element (null if unnamed).
  // @param ancs       Variable names of all ancestors above parentId.
  // @returns          Concatenated string of all top-level tags found.
  //
  function parseBody(parentId: string, parentVar: string | null, ancs: string[]): string {
    eat() // consume opening {
    let tagsStr = ''

    while (peek().kind !== 'RBRACE' && peek().kind !== 'EOF') {
      const t = peek()

      // tags "t1" "t2" ...
      if (t.kind === 'IDENT' && lc(t.val) === 'tags') {
        eat()
        tagsStr += ' ' + consumeStrings().join(' ')
        continue
      }

      // Skip known non-element sub-blocks / inline values
      if (t.kind === 'IDENT' && SKIP_BODY_KW.has(lc(t.val))) {
        eat()
        if (peek().kind === 'LBRACE') skipBlock()
        else consumeStrings()
        continue
      }

      // Assignment:  varName = elementKeyword ...
      if (t.kind === 'IDENT' && peek(1).kind === 'EQ') {
        const vn = eat().val; eat() // consume varName and =
        if (peek().kind === 'IDENT' && ELEMENT_KW.has(lc(peek().val))) {
          parseElement(parentId, parentVar, ancs, vn)
        } else {
          consumeStrings()
          if (peek().kind === 'LBRACE') skipBlock()
        }
        continue
      }

      // Anonymous element keyword
      if (t.kind === 'IDENT' && ELEMENT_KW.has(lc(t.val))) {
        parseElement(parentId, parentVar, ancs, null)
        continue
      }

      // Relationship:  identifier -> identifier ...
      if (t.kind === 'IDENT' && peek(1).kind === 'ARROW') {
        parseRel(); continue
      }

      // Unknown IDENT followed by a block — skip
      if (t.kind === 'IDENT' && peek(1).kind === 'LBRACE') {
        eat(); skipBlock(); continue
      }

      eat() // skip anything else
    }

    if (peek().kind === 'RBRACE') eat() // consume closing }
    return tagsStr.trim()
  }

  // ── Parse one element declaration ─────────────────────────────────────────
  //
  // @param parentId  Node-id of the containing element (null = model root).
  // @param parentVar Variable name of the containing element (null if unnamed).
  // @param ancs      Variable names of ancestors above the containing element.
  // @param varName   The variable name being assigned to this element (or null).
  //
  function parseElement(
    parentId:  string | null,
    parentVar: string | null,
    ancs:      string[],
    varName:   string | null,
  ): void {
    const kw = eat().val        // consume the keyword token
    const ss = consumeStrings() // collect all consecutive string args

    const label       = ss[0] || varName || kw
    const description = ss[1] || ''
    const kwl         = lc(kw)

    // String arg positions differ by element type:
    //   person / softwareSystem : "name"  "desc"  "tags"
    //   container / component   : "name"  "desc"  "technology"  "tags"
    //   group                   : "name"
    let tech = '', inlineTags = ''
    if (kwl === 'container' || kwl === 'component') {
      tech       = ss[2] || ''
      inlineTags = ss[3] || ''
    } else if (kwl !== 'group') {
      inlineTags = ss[2] || ''
    }

    let type     = inferType(kw, inlineTags)
    const external = lc(inlineTags).includes('external')

    const base   = varName ? mkId(varName) : mkId(label)
    const nodeId = uniqueId(base)
    const size   = NODE_SIZES[type] ?? NODE_SIZES.container

    const node: C4Node = {
      id:          nodeId,
      type,
      label:       label || nodeId,
      description: description || undefined,
      technology:  tech || undefined,
      parentId:    parentId || undefined,
      collapsed:   false,
      external:    external || undefined,
      x: 0, y: 0,
      width:  size.width,
      height: size.height,
    }

    // Build the ancestor chain used for hierarchical map registration.
    // We include the immediate parent's var name so children registered later
    // can be looked up as "parentVar.childVar".
    const myAncs = parentVar ? [...ancs, parentVar] : ancs
    register(node, varName, myAncs)

    // Parse body block if present; refine type from tags found inside.
    if (peek().kind === 'LBRACE') {
      const bodyTags = parseBody(nodeId, varName, myAncs)
      const allTags  = inlineTags + ' ' + bodyTags
      if (node.type === 'container' && isDbTags(allTags)) {
        node.type   = 'database'
        node.width  = NODE_SIZES.database.width
        node.height = NODE_SIZES.database.height
      }
      if (!node.external && lc(allTags).includes('external')) {
        node.external = true
      }
    }
  }

  // ── Parse a relationship ───────────────────────────────────────────────────

  function parseRel(): void {
    const srcRef = eat().val // source identifier
    eat()                    // consume ->
    if (peek().kind !== 'IDENT') { consumeStrings(); return }
    const tgtRef = eat().val // target identifier
    const ss     = consumeStrings()

    const srcId = resolveId(srcRef)
    const tgtId = resolveId(tgtRef)
    if (!srcId || !tgtId || srcId === tgtId) return
    // Deduplicate: skip if an identical source→target pair already exists.
    if (relations.some(r => r.sourceId === srcId && r.targetId === tgtId)) return

    relations.push({
      id:         `rel-${++relIdx}`,
      sourceId:   srcId,
      targetId:   tgtId,
      label:      ss[0] || undefined,
      technology: ss[1] || undefined,
    })
  }

  // ── Parse the model block  model { ... }  ────────────────────────────────

  function parseModel(): void {
    eat() // consume opening {
    while (peek().kind !== 'RBRACE' && peek().kind !== 'EOF') {
      const t = peek()

      // DSL directives:  !identifiers hierarchical  etc.
      if (t.kind === 'IDENT' && t.val.startsWith('!')) {
        eat(); consumeStrings()
        if (peek().kind === 'LBRACE') skipBlock()
        continue
      }

      // properties { ... }
      if (t.kind === 'IDENT' && lc(t.val) === 'properties') {
        eat(); if (peek().kind === 'LBRACE') skipBlock(); continue
      }

      // Assignment:  varName = elementKeyword ...
      if (t.kind === 'IDENT' && peek(1).kind === 'EQ') {
        const vn = eat().val; eat() // varName and =
        if (peek().kind === 'IDENT' && ELEMENT_KW.has(lc(peek().val))) {
          parseElement(null, null, [], vn)
        } else {
          consumeStrings(); if (peek().kind === 'LBRACE') skipBlock()
        }
        continue
      }

      // Anonymous element
      if (t.kind === 'IDENT' && ELEMENT_KW.has(lc(t.val))) {
        parseElement(null, null, [], null); continue
      }

      // Relationship:  identifier -> identifier ...
      if (t.kind === 'IDENT' && peek(1).kind === 'ARROW') {
        parseRel(); continue
      }

      // Unknown IDENT with block — skip
      if (t.kind === 'IDENT' && peek(1).kind === 'LBRACE') {
        eat(); skipBlock(); continue
      }

      eat() // skip anything else
    }

    if (peek().kind === 'RBRACE') eat()
  }

  // ── Top-level:  workspace "name" { model { ... } ... }  ──────────────────

  while (peek().kind !== 'EOF') {
    if (peek().kind === 'IDENT' && lc(peek().val) === 'workspace') {
      eat()
      const wss = consumeStrings()
      if (wss[0]) workspaceName = wss[0]
      if (peek().kind !== 'LBRACE') break
      eat() // consume {

      while (peek().kind !== 'RBRACE' && peek().kind !== 'EOF') {
        const t = peek()
        if (t.kind === 'IDENT' && t.val.startsWith('!')) { eat(); consumeStrings(); continue }
        if (t.kind === 'IDENT' && lc(t.val) === 'model')  { eat(); parseModel(); continue }
        // views, configuration, etc. — skip the whole block
        if (t.kind === 'IDENT' && peek(1).kind === 'LBRACE') { eat(); skipBlock(); continue }
        eat()
      }

      if (peek().kind === 'RBRACE') eat()
      break
    }
    eat()
  }

  return { nodes, relations, name: workspaceName }
}
