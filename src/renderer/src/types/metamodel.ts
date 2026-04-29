// ─── Metamodel: object types + relations + constraints ─────────────────────
//
// A Metamodel describes which kinds of nodes exist, what properties they
// have, who can be whose parent, and which relations are allowed between
// them. The built-in C4 preset is generated from the legacy constants in
// `c4.ts` so existing models keep working unchanged.
//
// The metamodel is stored per-document and validated softly: violations
// surface in the Issues panel rather than blocking edits.

import {
  C4Node,
  C4Relation,
  NODE_COLORS,
  NODE_FG,
  TYPE_LABELS,
  TYPE_ICON_PATHS,
  NODE_SIZES,
  COLLAPSED_HEIGHT,
  COLLAPSED_WIDTH,
} from './c4'

export type PropertyType = 'text' | 'textarea' | 'boolean' | 'number' | 'enum'

export interface PropertyDef {
  key: string
  label: string
  type: PropertyType
  required?: boolean
  /** Only for `type === 'enum'`. */
  options?: string[]
  default?: string | number | boolean
}

export interface NodeTypeDef {
  id: string
  label: string
  color: string
  fg: string
  /** SVG path data (16×16 viewBox). */
  iconPath: string
  width: number
  height: number
  collapsedWidth?: number
  collapsedHeight?: number
  /** Allowed parent node-type ids. `undefined`/empty → no specific parent
   *  type required (combine with `allowedAtRoot` to control root). */
  allowedParents?: string[]
  /** Whether this type may be placed at the canvas root (no parent).
   *  When undefined, defaults to `true` if `allowedParents` is
   *  undefined/empty, `false` otherwise — preserves prior behaviour. */
  allowedAtRoot?: boolean
  /** Min/max instances of this type per document. */
  cardinality?: { min?: number; max?: number }
  /** Custom properties beyond label/parent. */
  properties?: PropertyDef[]
  /** Built-in types come from the C4 preset and cannot be deleted. */
  builtin?: boolean
}

export interface RelationPair {
  /** Source node-type id. */
  from: string
  /** Target node-type id. */
  to: string
  /** Optional cardinality on this pair. */
  min?: number
  max?: number
}

export interface RelationTypeDef {
  id: string
  label: string
  /** Empty list ⇒ "any pair allowed". */
  allowedPairs: RelationPair[]
  properties?: PropertyDef[]
  /** Optional visual hint for the relation. */
  color?: string
  builtin?: boolean
}

export interface Metamodel {
  id: string
  name: string
  nodeTypes: Record<string, NodeTypeDef>
  relationTypes: Record<string, RelationTypeDef>
}

// ── Built-in C4 preset ─────────────────────────────────────────────────────

export function builtInC4Metamodel(): Metamodel {
  const nodeTypes: Record<string, NodeTypeDef> = {}

  // C4 containment rules:
  //  • person                    → root only
  //  • system                    → root OR inside another system (a system
  //                                may aggregate sub-systems / a "system of
  //                                systems" / enterprise grouping)
  //  • container                 → inside a system
  //  • component                 → inside a container
  //  • database / webapp / queue → "container kinds" — live inside a system,
  //                                NOT inside another container (a container
  //                                cannot aggregate another container).
  const allowedParentsMap: Record<string, string[] | undefined> = {
    person:    undefined,
    system:    ['system'],
    container: ['system'],
    component: ['container', 'webapp'],
    database:  ['system'],
    webapp:    ['system'],
    queue:     ['system'],
  }

  const techTypes = new Set(['container', 'component', 'database', 'webapp', 'queue'])
  const types: Array<keyof typeof NODE_COLORS> = [
    'person', 'system', 'container', 'component', 'database', 'webapp', 'queue',
  ]

  for (const t of types) {
    const props: PropertyDef[] = [
      { key: 'description', label: 'Description', type: 'textarea' },
    ]
    if (techTypes.has(t)) props.push({ key: 'technology', label: 'Technology', type: 'text' })
    props.push({ key: 'external', label: 'External', type: 'boolean' })

    nodeTypes[t] = {
      id: t,
      label: TYPE_LABELS[t],
      color: NODE_COLORS[t],
      fg: NODE_FG[t],
      iconPath: TYPE_ICON_PATHS[t],
      width: NODE_SIZES[t].width,
      height: NODE_SIZES[t].height,
      collapsedWidth: COLLAPSED_WIDTH[t],
      collapsedHeight: COLLAPSED_HEIGHT[t],
      allowedParents: allowedParentsMap[t],
      // person and system are top-level concepts and may live at the root.
      allowedAtRoot: t === 'person' || t === 'system',
      builtin: true,
      properties: props,
    }
  }

  // Relation rules.
  //
  // "Uses" — initiator → callee. Forbids things like:
  //   • person → person  (people don't "call" each other in a C4 model)
  //   • system → person  (use "Delivers to" instead)
  //   • database → *     (passive store, never initiates)
  //   • component → person / system  (components live inside a container and
  //                                   should not reach external actors directly)
  //
  // "Delivers to" — system / UI surface notifies or returns info to a person.
  const usesPairs: RelationPair[] = [
    // Person interacts with the system surface
    { from: 'person', to: 'system' },
    { from: 'person', to: 'container' },
    { from: 'person', to: 'webapp' },

    // System-level dependencies (external systems, or cross-boundary to containers)
    { from: 'system', to: 'system' },
    { from: 'system', to: 'container' },
    { from: 'system', to: 'database' },
    { from: 'system', to: 'webapp' },
    { from: 'system', to: 'queue' },

    // Container-level calls
    { from: 'container', to: 'system' },
    { from: 'container', to: 'container' },
    { from: 'container', to: 'database' },
    { from: 'container', to: 'webapp' },
    { from: 'container', to: 'queue' },

    // Web / UI container behaves like a container
    { from: 'webapp', to: 'system' },
    { from: 'webapp', to: 'container' },
    { from: 'webapp', to: 'database' },
    { from: 'webapp', to: 'webapp' },
    { from: 'webapp', to: 'queue' },

    // Queues fan out to consumers
    { from: 'queue', to: 'container' },
    { from: 'queue', to: 'webapp' },
    { from: 'queue', to: 'component' },

    // Component-level calls (within a container, or to peer containers/stores)
    { from: 'component', to: 'component' },
    { from: 'component', to: 'container' },
    { from: 'component', to: 'webapp' },
    { from: 'component', to: 'database' },
    { from: 'component', to: 'queue' },
  ]

  const deliversPairs: RelationPair[] = [
    { from: 'system',    to: 'person' },
    { from: 'container', to: 'person' },
    { from: 'webapp',    to: 'person' },
  ]

  const relationTypes: Record<string, RelationTypeDef> = {
    uses: {
      id: 'uses',
      label: 'Uses',
      allowedPairs: usesPairs,
      properties: [
        { key: 'technology', label: 'Technology', type: 'text' },
      ],
      builtin: true,
    },
    delivers: {
      id: 'delivers',
      label: 'Delivers to',
      allowedPairs: deliversPairs,
      properties: [
        { key: 'technology', label: 'Channel', type: 'text' },
      ],
      builtin: true,
    },
  }

  return { id: 'c4-builtin', name: 'C4 (built-in)', nodeTypes, relationTypes }
}

// ── Lookup helpers (with safe fallback for unknown types) ──────────────────

export function getNodeTypeDef(metamodel: Metamodel | undefined, typeId: string): NodeTypeDef | undefined {
  return metamodel?.nodeTypes[typeId]
}

/**
 * Returns true when a relation from `fromType` to `toType` is permitted by
 * the metamodel. Mirrors the validator's logic: if any relation type allows
 * "any pair" (empty allowedPairs), everything is permitted; otherwise the
 * pair must be explicitly listed by at least one relation type.
 */
export function isRelationAllowed(
  metamodel: Metamodel | undefined,
  fromType: string,
  toType: string,
): boolean {
  if (!metamodel) return true
  const rts = Object.values(metamodel.relationTypes)
  if (rts.length === 0) return true
  if (rts.some(rt => rt.allowedPairs.length === 0)) return true
  return rts.some(rt => rt.allowedPairs.some(p => p.from === fromType && p.to === toType))
}

/**
 * Returns true when a node of `childType` may be placed inside a parent of
 * `parentType` (or at the root, when `parentType` is undefined).
 * Unknown child types are permitted (they surface as a separate Issue).
 */
export function isParentAllowed(
  metamodel: Metamodel | undefined,
  childType: string,
  parentType: string | undefined,
): boolean {
  if (!metamodel) return true
  const def = metamodel.nodeTypes[childType]
  if (!def) return true
  const allowed = def.allowedParents
  if (parentType == null) {
    // Root placement. Honour explicit `allowedAtRoot`; otherwise default to
    // allowed when no specific parent types are required.
    if (def.allowedAtRoot !== undefined) return def.allowedAtRoot
    return !allowed || allowed.length === 0
  }
  return !!allowed && allowed.includes(parentType)
}

/**
 * Returns true when adding one more node of `typeId` would NOT exceed the
 * type's cardinality.max constraint. `currentCount` is the number of nodes
 * of that type that already exist.
 */
export function canAddMoreOfType(
  metamodel: Metamodel | undefined,
  typeId: string,
  currentCount: number,
): boolean {
  if (!metamodel) return true
  const def = metamodel.nodeTypes[typeId]
  if (!def?.cardinality?.max) return true
  return currentCount < def.cardinality.max
}

// ── Validator ──────────────────────────────────────────────────────────────

export type IssueSeverity = 'error' | 'warning'

export interface Issue {
  id: string
  severity: IssueSeverity
  message: string
  nodeId?: string
  relationId?: string
  nodeTypeId?: string
}

export function validateModel(
  nodes: Record<string, C4Node>,
  relations: Record<string, C4Relation>,
  metamodel: Metamodel,
): Issue[] {
  const issues: Issue[] = []
  const nodeList = Object.values(nodes)

  for (const n of nodeList) {
    const def = metamodel.nodeTypes[n.type]
    if (!def) {
      issues.push({
        id: `unknown-type:${n.id}`,
        severity: 'error',
        message: `Node "${n.label}" has unknown type "${n.type}".`,
        nodeId: n.id,
      })
      continue
    }

    // Parent check
    const allowed = def.allowedParents
    if (n.parentId) {
      const parent = nodes[n.parentId]
      if (!parent) {
        issues.push({
          id: `parent-missing:${n.id}`,
          severity: 'error',
          message: `Node "${n.label}" references a missing parent.`,
          nodeId: n.id,
        })
      } else if (allowed && !allowed.includes(parent.type)) {
        const parentLabel = metamodel.nodeTypes[parent.type]?.label ?? parent.type
        issues.push({
          id: `bad-parent:${n.id}`,
          severity: 'error',
          message: `${def.label} "${n.label}" cannot be inside ${parentLabel}. Allowed parents: ${allowed.length ? allowed.join(', ') : '(none — must be root)'}.`,
          nodeId: n.id,
        })
      }
    } else if (def.allowedAtRoot === false || (def.allowedAtRoot === undefined && allowed && allowed.length > 0)) {
      issues.push({
        id: `needs-parent:${n.id}`,
        severity: 'error',
        message: `${def.label} "${n.label}" must be inside ${allowed && allowed.length ? allowed.join(' or ') : 'a parent'}.`,
        nodeId: n.id,
      })
    }

    // Required properties
    for (const p of def.properties ?? []) {
      if (!p.required) continue
      const v = (n as unknown as Record<string, unknown>)[p.key]
      if (v == null || v === '') {
        issues.push({
          id: `missing-prop:${n.id}:${p.key}`,
          severity: 'warning',
          message: `${def.label} "${n.label}" is missing required property "${p.label}".`,
          nodeId: n.id,
        })
      }
    }
  }

  // Type cardinality
  for (const def of Object.values(metamodel.nodeTypes)) {
    const c = def.cardinality
    if (!c) continue
    const count = nodeList.filter(n => n.type === def.id).length
    if (c.min != null && count < c.min) {
      issues.push({
        id: `cardinality-min:${def.id}`,
        severity: 'warning',
        message: `Model has ${count} ${def.label} (minimum ${c.min}).`,
        nodeTypeId: def.id,
      })
    }
    if (c.max != null && count > c.max) {
      issues.push({
        id: `cardinality-max:${def.id}`,
        severity: 'warning',
        message: `Model has ${count} ${def.label} (maximum ${c.max}).`,
        nodeTypeId: def.id,
      })
    }
  }

  // Relation pair check.
  // Current data model has no explicit per-relation type tag, so we treat the
  // metamodel's relation types as a UNION of allowed pairs: a relation is
  // valid iff (a) at least one relation type allows any pair, OR (b) some
  // restrictive type explicitly lists the (from, to) pair.
  const restrictiveTypes = Object.values(metamodel.relationTypes).filter(rt => rt.allowedPairs.length > 0)
  const anyAllows = Object.values(metamodel.relationTypes).some(rt => rt.allowedPairs.length === 0)
  if (restrictiveTypes.length > 0 && !anyAllows) {
    for (const r of Object.values(relations)) {
      const src = nodes[r.sourceId]
      const dst = nodes[r.targetId]
      if (!src || !dst) continue
      const ok = restrictiveTypes.some(rt =>
        rt.allowedPairs.some(p => p.from === src.type && p.to === dst.type),
      )
      if (!ok) {
        issues.push({
          id: `bad-rel:${r.id}`,
          severity: 'warning',
          message: `Relation "${src.label}" → "${dst.label}" (${src.type}→${dst.type}) is not allowed by metamodel.`,
          relationId: r.id,
        })
      }
    }
  }

  return issues
}
