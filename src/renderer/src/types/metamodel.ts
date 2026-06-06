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
  /** Show this property only when another property has one of the listed values.
   *  E.g. `{ key: 'ears_type', values: ['event-driven', 'complex'] }` means
   *  this field is only visible when `ears_type` is event-driven or complex. */
  visibleWhen?: { key: string; values: string[] }
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
  // "Interacts" — any meaningful interaction between C4 elements:
  //   initiator calls/uses/delivers-to a target.
  //   Forbids database → * (passive store, never initiates).
  const interactsPairs: RelationPair[] = [
    // Person interacts with the system surface
    { from: 'person', to: 'system' },
    { from: 'person', to: 'container' },
    { from: 'person', to: 'webapp' },

    // System-level dependencies
    { from: 'system', to: 'person' },
    { from: 'system', to: 'system' },
    { from: 'system', to: 'container' },
    { from: 'system', to: 'database' },
    { from: 'system', to: 'webapp' },
    { from: 'system', to: 'queue' },

    // Container-level calls
    { from: 'container', to: 'person' },
    { from: 'container', to: 'system' },
    { from: 'container', to: 'container' },
    { from: 'container', to: 'database' },
    { from: 'container', to: 'webapp' },
    { from: 'container', to: 'queue' },

    // Web / UI container
    { from: 'webapp', to: 'person' },
    { from: 'webapp', to: 'system' },
    { from: 'webapp', to: 'container' },
    { from: 'webapp', to: 'database' },
    { from: 'webapp', to: 'webapp' },
    { from: 'webapp', to: 'queue' },

    // Queues fan out to consumers
    { from: 'queue', to: 'container' },
    { from: 'queue', to: 'webapp' },
    { from: 'queue', to: 'component' },

    // Component-level calls
    { from: 'component', to: 'component' },
    { from: 'component', to: 'container' },
    { from: 'component', to: 'webapp' },
    { from: 'component', to: 'database' },
    { from: 'component', to: 'queue' },
  ]

  const relationTypes: Record<string, RelationTypeDef> = {
    interacts: {
      id: 'interacts',
      label: 'Interacts',
      allowedPairs: interactsPairs,
      properties: [
        { key: 'technology', label: 'Technology', type: 'text' },
      ],
      builtin: true,
    },
  }

  return { id: 'c4-builtin', name: 'C4 (built-in)', nodeTypes, relationTypes }
}

// ── Built-in DDD-extended C4 preset ────────────────────────────────────────
//
// Extends the C4 metamodel with a single DDD-style strategic layer:
//   • Domain — problem space; may live at root and may be nested inside
//     another domain to express subdomains / sub-subdomains arbitrarily deep.
// The C4 `system` node may now also live inside a domain so it can model
// the technical realisation of that (sub)domain (≈ a Bounded Context).

export function builtInDddC4Metamodel(): Metamodel {
  const base = builtInC4Metamodel()

  // System may live at root, inside another system, OR inside a domain.
  const patchedSystem: NodeTypeDef = {
    ...base.nodeTypes.system,
    allowedParents: ['system', 'domain'],
    allowedAtRoot: true,
  }

  const domainProps: PropertyDef[] = [
    { key: 'description', label: 'Description', type: 'textarea' },
    { key: 'vision',      label: 'Vision',      type: 'textarea' },
    {
      key: 'kind',
      label: 'Kind',
      type: 'enum',
      options: ['core', 'supporting', 'generic'],
      default: 'core',
    },
  ]

  const domain: NodeTypeDef = {
    id: 'domain',
    label: 'Domain',
    color: '#4c1d95',
    fg: '#fff',
    iconPath: 'M2 3.5A1.5 1.5 0 0 1 3.5 2h9A1.5 1.5 0 0 1 14 3.5v9a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 12.5v-9Zm1.5 1A.5.5 0 0 0 3 5v6a.5.5 0 0 0 .5.5h9A.5.5 0 0 0 13 11V5a.5.5 0 0 0-.5-.5h-9ZM5 7h2v2H5V7Zm4 0h2v2H9V7Z',
    width: 520,
    height: 360,
    collapsedWidth: 360,
    collapsedHeight: 220,
    // A domain may be nested inside another domain (recursive containment).
    allowedParents: ['domain'],
    allowedAtRoot: true,
    builtin: true,
    properties: domainProps,
  }

  // "Realises" — a system implements a domain (Bounded Context mapping).
  const realises: RelationTypeDef = {
    id: 'realises',
    label: 'Realises',
    allowedPairs: [
      { from: 'system',    to: 'domain' },
      { from: 'container', to: 'domain' },
    ],
    properties: [],
    builtin: true,
  }

  // Strategic relations between domains. Covers the common DDD
  // context-mapping needs: a domain depends on / collaborates with another
  // domain (or its nested sub-domain).
  const ddPairs: RelationPair[] = [
    { from: 'domain', to: 'domain' },
  ]

  const dependsOn: RelationTypeDef = {
    id: 'depends-on',
    label: 'Depends on',
    allowedPairs: ddPairs,
    properties: [
      { key: 'description', label: 'Description', type: 'text' },
    ],
    builtin: true,
  }

  const partnership: RelationTypeDef = {
    id: 'partnership',
    label: 'Partnership',
    allowedPairs: ddPairs,
    properties: [
      {
        key: 'pattern',
        label: 'Pattern',
        type: 'enum',
        options: [
          'partnership',
          'shared-kernel',
          'customer-supplier',
          'conformist',
          'anti-corruption-layer',
          'open-host-service',
          'published-language',
          'separate-ways',
        ],
        default: 'partnership',
      },
      { key: 'description', label: 'Description', type: 'text' },
    ],
    builtin: true,
  }

  return {
    id: 'c4-ddd-builtin',
    name: 'C4 + DDD Domains',
    nodeTypes: {
      ...base.nodeTypes,
      system: patchedSystem,
      domain,
    },
    relationTypes: {
      ...base.relationTypes,
      realises,
      'depends-on': dependsOn,
      partnership,
    },
  }
}

// ── Built-in C4 + DDD + Governance preset ──────────────────────────────────
//
// Extends C4 + DDD with two governance node types and three relation types:
//   • adr         — Architecture Decision Record (Nygard / MADR format)
//   • fitness-fn  — Fitness Function (Building Evolutionary Architectures)
//   • constrains  — adr / fitness-fn → any C4 element
//   • supersedes  — adr → adr (replaces an older decision)
//   • implements  — fitness-fn → adr ("this FF verifies ADR-003")

export function builtInGovernanceMetamodel(): Metamodel {
  const base = builtInDddC4Metamodel()

  const adrProps: PropertyDef[] = [
    {
      key: 'status',
      label: 'Status',
      type: 'enum',
      options: ['proposed', 'accepted', 'deprecated', 'superseded'],
      default: 'proposed',
    },
    { key: 'date',         label: 'Date',                   type: 'text' },
    { key: 'context',      label: 'Context',                type: 'textarea' },
    { key: 'decision',     label: 'Decision',               type: 'textarea' },
    { key: 'consequences', label: 'Consequences',           type: 'textarea' },
    { key: 'alternatives', label: 'Alternatives considered', type: 'textarea' },
  ]

  const adr: NodeTypeDef = {
    id: 'adr',
    label: 'ADR',
    color: '#92400e',
    fg: '#fff',
    iconPath: TYPE_ICON_PATHS['adr'],
    width: NODE_SIZES['adr'].width,
    height: NODE_SIZES['adr'].height,
    collapsedWidth: COLLAPSED_WIDTH['adr'],
    collapsedHeight: COLLAPSED_HEIGHT['adr'],
    allowedParents: ['system', 'domain'],
    allowedAtRoot: true,
    builtin: true,
    properties: adrProps,
  }

  const fitnessFnProps: PropertyDef[] = [
    { key: 'description', label: 'Description', type: 'textarea' },
    {
      key: 'category',
      label: 'Category',
      type: 'enum',
      options: ['structural', 'operational', 'process', 'holistic'],
      default: 'structural',
    },
    { key: 'automated', label: 'Automated', type: 'boolean', default: false },
    {
      key: 'trigger',
      label: 'Trigger',
      type: 'enum',
      options: ['on-deploy', 'continuous', 'periodic'],
      default: 'on-deploy',
    },
    { key: 'threshold', label: 'Threshold / Success criteria', type: 'text' },
    {
      key: 'status',
      label: 'Status',
      type: 'enum',
      options: ['proposed', 'active', 'deprecated'],
      default: 'proposed',
    },
  ]

  const fitnessFn: NodeTypeDef = {
    id: 'fitness-fn',
    label: 'Fitness Function',
    color: '#5b21b6',
    fg: '#fff',
    iconPath: TYPE_ICON_PATHS['fitness-fn'],
    width: NODE_SIZES['fitness-fn'].width,
    height: NODE_SIZES['fitness-fn'].height,
    collapsedWidth: COLLAPSED_WIDTH['fitness-fn'],
    collapsedHeight: COLLAPSED_HEIGHT['fitness-fn'],
    allowedParents: ['system', 'domain'],
    allowedAtRoot: true,
    builtin: true,
    properties: fitnessFnProps,
  }

  // ── EARS Requirement ──────────────────────────────────────────────────────

  const requirementProps: PropertyDef[] = [
    {
      key: 'ears_type',
      label: 'EARS type',
      type: 'enum',
      options: ['ubiquitous', 'event-driven', 'state-driven', 'unwanted-behaviour', 'optional', 'complex'],
      default: 'ubiquitous',
    },
    {
      key: 'status',
      label: 'Status',
      type: 'enum',
      options: ['draft', 'approved', 'implemented', 'verified', 'deprecated'],
      default: 'draft',
    },
    {
      key: 'priority',
      label: 'Priority',
      type: 'enum',
      options: ['must', 'should', 'could', "won't"],
      default: 'must',
    },
    { key: 'trigger',             label: 'When (trigger)',            type: 'text',     visibleWhen: { key: 'ears_type', values: ['event-driven', 'complex'] } },
    { key: 'precondition',        label: 'While (precondition)',      type: 'text',     visibleWhen: { key: 'ears_type', values: ['state-driven', 'complex'] } },
    { key: 'unwanted_condition',  label: 'If (unwanted condition)',   type: 'text',     visibleWhen: { key: 'ears_type', values: ['unwanted-behaviour', 'complex'] } },
    { key: 'feature',             label: 'Where (feature)',           type: 'text',     visibleWhen: { key: 'ears_type', values: ['optional', 'complex'] } },
    { key: 'action',              label: 'The system shall (action)', type: 'textarea' },
    { key: 'rationale',           label: 'Rationale',                 type: 'textarea' },
  ]

  const requirement: NodeTypeDef = {
    id: 'requirement',
    label: 'Requirement',
    color: '#0e7490',
    fg: '#fff',
    iconPath: TYPE_ICON_PATHS['requirement'],
    width: NODE_SIZES['requirement'].width,
    height: NODE_SIZES['requirement'].height,
    collapsedWidth: COLLAPSED_WIDTH['requirement'],
    collapsedHeight: COLLAPSED_HEIGHT['requirement'],
    allowedParents: ['system', 'domain'],
    allowedAtRoot: true,
    builtin: true,
    properties: requirementProps,
  }

  const constraintSources = ['adr', 'fitness-fn', 'requirement'] as const
  const constraintTargets = ['person', 'system', 'domain', 'container', 'component', 'database', 'webapp', 'queue'] as const
  const constrainsPairs: RelationPair[] = constraintSources.flatMap(from =>
    constraintTargets.map(to => ({ from, to })),
  )

  const constrains: RelationTypeDef = {
    id: 'constrains',
    label: 'Constrains',
    allowedPairs: constrainsPairs,
    properties: [
      { key: 'description', label: 'Note', type: 'text' },
    ],
    color: '#dc2626',
    builtin: true,
  }

  const supersedes: RelationTypeDef = {
    id: 'supersedes',
    label: 'Supersedes',
    allowedPairs: [{ from: 'adr', to: 'adr' }],
    properties: [],
    color: '#f59e0b',
    builtin: true,
  }

  const implements_: RelationTypeDef = {
    id: 'implements',
    label: 'Implements',
    allowedPairs: [{ from: 'fitness-fn', to: 'adr' }],
    properties: [],
    color: '#7c3aed',
    builtin: true,
  }

  // requirement → element: the element satisfies this requirement
  const satisfiesTargets = ['person', 'system', 'domain', 'container', 'component', 'database', 'webapp', 'queue'] as const
  const satisfies: RelationTypeDef = {
    id: 'satisfies',
    label: 'Satisfies',
    allowedPairs: satisfiesTargets.map(to => ({ from: to, to: 'requirement' })),
    properties: [
      { key: 'description', label: 'Note', type: 'text' },
    ],
    color: '#0891b2',
    builtin: true,
  }

  // requirement → requirement decomposition
  const derives: RelationTypeDef = {
    id: 'derives',
    label: 'Derives from',
    allowedPairs: [{ from: 'requirement', to: 'requirement' }],
    properties: [],
    color: '#0d9488',
    builtin: true,
  }

  // requirement → ADR traceability
  const tracesTo: RelationTypeDef = {
    id: 'traces-to',
    label: 'Traces to',
    allowedPairs: [
      { from: 'requirement', to: 'adr' },
      { from: 'requirement', to: 'fitness-fn' },
    ],
    properties: [],
    color: '#06b6d4',
    builtin: true,
  }

  return {
    id: 'c4-ddd-governance-builtin',
    name: 'C4 + DDD + Governance',
    nodeTypes: {
      ...base.nodeTypes,
      adr,
      'fitness-fn': fitnessFn,
      requirement,
    },
    relationTypes: {
      ...base.relationTypes,
      constrains,
      supersedes,
      implements: implements_,
      satisfies,
      derives,
      'traces-to': tracesTo,
    },
  }
}



export interface MetamodelPreset {
  id: string
  name: string
  description: string
  build: () => Metamodel
}

export function availableMetamodels(): MetamodelPreset[] {
  return [
    {
      id: 'c4-builtin',
      name: 'C4',
      description: 'Classic C4 model: Person, System, Container, Component, plus stores and queues.',
      build: builtInC4Metamodel,
    },
    {
      id: 'c4-ddd-builtin',
      name: 'C4 + DDD Domains',
      description: 'C4 extended with strategic DDD: a Domain container that nests recursively (Core / Supporting / Generic) above the technical model.',
      build: builtInDddC4Metamodel,
    },
    {
      id: 'c4-ddd-governance-builtin',
      name: 'C4 + DDD + Governance',
      description: 'C4 + DDD extended with governance: ADR (Architecture Decision Records), Fitness Functions, and EARS Requirements linked to architecture elements via Constrains, Supersedes, Implements, Satisfies, Derives, and Traces-to relations.',
      build: builtInGovernanceMetamodel,
    },
  ]
}

// ── Lookup helpers (with safe fallback for unknown types) ──────────────────

/** Check whether a property should be visible given the node's current values. */
export function isPropertyVisible(prop: PropertyDef, node: Record<string, unknown>): boolean {
  if (!prop.visibleWhen) return true
  const cur = String(node[prop.visibleWhen.key] ?? '')
  return prop.visibleWhen.values.includes(cur)
}

/**
 * Compose the EARS requirement sentence from a node's fields.
 * Returns an object with `sentence` (the full EARS statement) and
 * `template` (the pattern with placeholders for empty fields).
 *
 * Templates:
 *  ubiquitous:         "The <system> shall <action>."
 *  event-driven:       "When <trigger>, the <system> shall <action>."
 *  state-driven:       "While <precondition>, the <system> shall <action>."
 *  unwanted-behaviour: "If <condition>, then the <system> shall <action>."
 *  optional:           "Where <feature>, the <system> shall <action>."
 *  complex:            "While <pre>, when <trigger>, the <system> shall <action>."
 */
function capitalize(s: string): string { return s.charAt(0).toUpperCase() + s.slice(1) }
export function composeEarsSentence(node: Record<string, unknown>, subject?: string): { sentence: string; complete: boolean } {
  const earsType = String(node.ears_type ?? 'ubiquitous')
  const subj = (subject || 'the system').trim()
  const action = String(node.action ?? '').trim()
  const trigger = String(node.trigger ?? '').trim()
  const precondition = String(node.precondition ?? '').trim()
  const unwanted = String(node.unwanted_condition ?? '').trim()
  const feature = String(node.feature ?? '').trim()

  const actionPart = action || '‹action›'
  const shallClause = `${subj} shall ${actionPart}`

  let sentence: string
  let complete = !!action

  switch (earsType) {
    case 'event-driven':
      sentence = `When ${trigger || '‹trigger›'}, ${shallClause}.`
      complete = complete && !!trigger
      break
    case 'state-driven':
      sentence = `While ${precondition || '‹precondition›'}, ${shallClause}.`
      complete = complete && !!precondition
      break
    case 'unwanted-behaviour':
      sentence = `If ${unwanted || '‹condition›'}, then ${shallClause}.`
      complete = complete && !!unwanted
      break
    case 'optional':
      sentence = `Where ${feature || '‹feature›'}, ${shallClause}.`
      complete = complete && !!feature
      break
    case 'complex': {
      const parts: string[] = []
      if (precondition || trigger) {
        if (precondition) parts.push(`While ${precondition}`)
        if (trigger) parts.push(`when ${trigger}`)
        if (unwanted) parts.push(`if ${unwanted}`)
        if (feature) parts.push(`where ${feature}`)
      }
      if (parts.length === 0) parts.push('‹conditions›')
      sentence = `${parts.join(', ')}, ${shallClause}.`
      complete = complete && (!!precondition || !!trigger)
      break
    }
    default: // ubiquitous
      sentence = `${capitalize(subj)} shall ${actionPart}.`
      break
  }

  return { sentence, complete }
}

/** Resolve the EARS subject for a requirement by finding 'satisfies' relations pointing to it. */
export function resolveEarsSubject(
  reqId: string,
  relations: Record<string, { sourceId: string; targetId: string; relationType?: string }>,
  nodes: Record<string, { label: string }>,
): string | undefined {
  for (const rel of Object.values(relations)) {
    if (rel.relationType === 'satisfies' && rel.targetId === reqId) {
      const src = nodes[rel.sourceId]
      if (src) return src.label
    }
  }
  return undefined
}

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
 * Returns the id of the unique restricted relation type that permits the
 * given (fromType, toType) pair, or `undefined` when zero or multiple types
 * match.  "Restricted" means the type's `allowedPairs` list is non-empty.
 * Catch-all types (empty allowedPairs) are ignored so that e.g. the `uses`
 * type does not shadow a more specific one.
 */
export function inferRelationType(
  metamodel: Metamodel | undefined,
  fromType: string,
  toType: string,
): string | undefined {
  if (!metamodel) return undefined
  const matches = Object.values(metamodel.relationTypes).filter(
    rt => rt.allowedPairs.length > 0 && rt.allowedPairs.some(p => p.from === fromType && p.to === toType),
  )
  return matches.length === 1 ? matches[0].id : undefined
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
