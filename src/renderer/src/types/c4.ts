// ─── C4 domain types ────────────────────────────────────────────────────────

import type { Metamodel } from './metamodel'

export type C4ElementType = 'person' | 'system' | 'container' | 'component' | 'database' | 'webapp' | 'queue' | 'domain' | 'adr' | 'fitness-fn'

/** Types that act as containers (can hold children, collapse, auto-resize). */
export const CONTAINER_TYPES: ReadonlySet<string> = new Set([
  'system', 'container', 'domain',
])

/** True when the given node-type id behaves as a parent container. */
export function isContainerType(type: string | undefined): boolean {
  return !!type && CONTAINER_TYPES.has(type)
}

export interface C4Node {
  id: string
  type: C4ElementType
  label: string
  description?: string
  technology?: string
  /** id of the parent C4Node (Container inside System, Component inside Container) */
  parentId?: string
  /** Is this node collapsed (only meaningful for system / container) */
  collapsed: boolean
  /** external actor / system flag */
  external?: boolean
  x: number
  y: number
  width: number
  height: number
}

export interface C4Relation {
  id: string
  sourceId: string
  targetId: string
  /** Metamodel relation-type id (e.g. 'interacts', 'constrains', 'supersedes'). */
  relationType?: string
  label?: string
  technology?: string
}

export interface NodePosition {
  x: number
  y: number
  width: number
  height: number
}

/**
 * A named, ordered interaction sequence — a model-level artefact that can be
 * referenced by one or more dynamic views.
 * Examples: "User Login Journey", "Payment Flow"
 */
export interface DiagramSequence {
  id: string
  name: string
  /** Ordered list of C4Relation IDs that form the interaction steps */
  relationIds: string[]
  /**
   * Per-step description overrides, parallel to relationIds.
   * When set for index i, the SequenceView shows this text on the arrow
   * instead of (or in addition to) the underlying relation label.
   * Optional for backwards compat with persisted sequences.
   */
  stepDescriptions?: (string | undefined)[]
}

export interface DiagramView {
  id: string
  name: string
  /**
   * 'static' (default) = ordinary filtered view.
   * 'dynamic' = shows step-number badges on edges from the linked sequence.
   * 'treemap' = renders the element hierarchy as nested coloured rectangles.
   * 'table'   = governance-aware spreadsheet view of nodes and relations.
   */
  kind?: 'static' | 'dynamic' | 'treemap' | 'table'
  /** ID of the DiagramSequence to visualise when kind='dynamic' */
  sequenceId?: string
  /** C4 node IDs included in this view. Ancestors are auto-included. */
  nodeIds: string[]
  /**
   * Relation IDs explicitly hidden from this view, even though both their
   * endpoints (or visible ancestors) are present. Optional for backwards
   * compatibility with older persisted views.
   */
  hiddenRelationIds?: string[]
  /** Per-node positions for this view */
  positions: Record<string, NodePosition>
  /**
   * Per-view camera state (pan + zoom). Restored on view activation so each
   * view ("System Context", "Container View") keeps its own framing.
   * Optional for backwards compat with persisted views.
   */
  viewport?: { x: number; y: number; zoom: number }
  /**
   * Auto-layout strategy used when the user invokes "Smart Layout" while
   * this view is active.
   *  - 'auto' (default, undefined) — current behaviour: ensemble Smart Layout.
   *  - 'tree'                      — hierarchical nested tree layout (ELK
   *                                  mrtree per container, top-down).
   * Useful for views populated mostly with domain objects, where a clean
   * containment-tree visualisation is preferable to a force/layered graph.
   */
  layoutMode?: 'auto' | 'tree'
  /**
   * Treemap-only: id of the node currently used as the drill-down root.
   * `null`/`undefined` = top of the hierarchy ("All").
   * Persisted so reopening the view restores the user's location.
   */
  treemapFocusId?: string | null
  /**
   * Treemap-only: how to size rectangles.
   *  - 'leaves'    (default) — every leaf counts as 1; parents = sum of leaves.
   *                Pure hierarchy: rectangle area ∝ number of descendants.
   *  - 'uniform'   — siblings always equal-sized.
   *  - 'relations' — legacy behaviour: leaf value = relation count + 1.
   */
  treemapSizeBy?: 'leaves' | 'uniform' | 'relations'
  /**
   * Treemap-only: maximum number of descendant levels rendered below the
   * current focus. `1` = direct children only, `2` = + grandchildren, …
   * `null`/`undefined` = unlimited (whole subtree). Persisted per view.
   * Nodes that have children hidden by this limit still render as drillable.
   */
  treemapMaxDepth?: number | null
  /**
   * Treemap-only: node ids the user explicitly expanded inline (overriding
   * `treemapMaxDepth`). Each id forces its entire subtree to render in full,
   * without changing the focus root. Persisted per view.
   */
  treemapExpandedIds?: string[]
  /**
   * Node IDs explicitly collapsed by the user in this named view.
   * Independent of the model-level `node.collapsed` flag — collapsing in one
   * view does not affect other views or the default "all nodes" view.
   */
  collapsedNodeIds?: string[]
  /**
   * Node IDs explicitly expanded in this named view, overriding a model-level
   * `node.collapsed = true`. Lets the user expand a node in one view without
   * affecting other views or the default "all nodes" view.
   */
  expandedNodeIds?: string[]
}

/** Named snapshot (version) of the diagram state */
export interface DiagramSnapshot {
  id: string
  name: string
  timestamp: number
  nodes: Record<string, C4Node>
  relations: Record<string, C4Relation>
  /** Sequences captured at this point in time (optional for backward compat). */
  sequences?: Record<string, DiagramSequence>
}

/** Saved positions + collapsed state for every node on the canvas */
export interface SlideCanvasState {
  nodes: Record<string, { x: number; y: number; width: number; height: number; collapsed: boolean }>
}

/** A single presentation slide — captures viewport + optional snapshot */
export interface PresentationSlide {
  id: string
  name: string
  /** null = use whatever is currently on canvas (no snapshot restore) */
  snapshotId: string | null
  /** null = show all nodes; string = activate this view when navigating to slide */
  viewId?: string | null
  viewport: { x: number; y: number; zoom: number }
  /** Full node positions + collapsed flags at the time the slide was created/captured */
  canvasState?: SlideCanvasState
  /**
   * Inline snapshot of the full model (nodes + relations) at slide-creation time.
   * Used as the source of truth on goToSlide — guarantees the slide shows
   * exactly what was on screen when "Add slide" was pressed, regardless of
   * later edits to the live model. Takes precedence over `snapshotId`.
   */
  modelSnapshot?: {
    nodes: Record<string, C4Node>
    relations: Record<string, C4Relation>
  }
}

/** A named presentation — collection of slides */
export interface Presentation {
  id: string
  name: string
  slides: PresentationSlide[]
}

export interface DiagramData {
  nodes: C4Node[]
  relations: C4Relation[]
  sequences?: DiagramSequence[]
  views?: DiagramView[]
  /** Positions for the "All" (default) view */
  defaultPositions?: Record<string, NodePosition>
  /** Camera state (pan + zoom) for the "All" (default) view */
  defaultViewport?: { x: number; y: number; zoom: number } | null
  /** Named snapshots (versions) */
  snapshots?: DiagramSnapshot[]
  /** Multiple named presentations */
  presentations?: Presentation[]
  /** @deprecated legacy single-presentation slides — auto-migrated into a "Main" presentation */
  presentationSlides?: PresentationSlide[]
  /** Per-document metamodel (object types + allowed relations + constraints).
   *  When absent, the built-in C4 preset is used. */
  metamodel?: Metamodel
}

// ─── React Flow data shapes ──────────────────────────────────────────────────

export interface C4NodeRFData {
  c4id: string
  type: C4ElementType
  label: string
  description?: string
  technology?: string
  parentId?: string
  collapsed: boolean
  external?: boolean
  width: number
  height: number
  hasChildren: boolean
}

export interface C4EdgeRFData {
  originalSourceId: string
  originalTargetId: string
  label?: string
  technology?: string
  relationType?: string
  isVirtual: boolean
  /** 1-based step indices when this edge is part of the active dynamic view sequence.
   *  Array because the same relation can appear multiple times in one sequence. */
  sequenceStep?: number[]
}

// ─── Layout position map ─────────────────────────────────────────────────────

export type PositionMap = Record<string, { x: number; y: number; width?: number; height?: number }>

// ─── Node default sizes ──────────────────────────────────────────────────────

export const NODE_SIZES: Record<C4ElementType, { width: number; height: number }> = {
  person:       { width: 150, height: 170 },
  system:       { width: 360, height: 260 },
  container:    { width: 300, height: 200 },
  component:    { width: 200, height: 120 },
  database:     { width: 190, height: 130 },
  webapp:       { width: 210, height: 140 },
  queue:        { width: 220, height: 95 },
  domain:       { width: 520, height: 360 },
  adr:          { width: 180, height: 52 },
  'fitness-fn': { width: 180, height: 52 },
}

export const COLLAPSED_HEIGHT: Record<C4ElementType, number> = {
  person:       170,
  system:       180,
  container:    160,
  component:    120,
  database:     130,
  webapp:       140,
  queue:        95,
  domain:       220,
  adr:          52,
  'fitness-fn': 52,
}

export const COLLAPSED_WIDTH: Record<C4ElementType, number> = {
  person:       150,
  system:       280,
  container:    240,
  component:    200,
  database:     190,
  webapp:       210,
  queue:        220,
  domain:       360,
  adr:          160,
  'fitness-fn': 160,
}

export const NODE_COLORS: Record<C4ElementType, string> = {
  person:       '#08427b',
  system:       '#1168bd',
  container:    '#438dd5',
  component:    '#85bbf0',
  database:     '#438dd5',
  webapp:       '#438dd5',
  queue:        '#438dd5',
  domain:       '#4c1d95',
  adr:          '#92400e',
  'fitness-fn': '#5b21b6',
}

export const NODE_FG: Record<C4ElementType, string> = {
  person:       '#fff',
  system:       '#fff',
  container:    '#fff',
  component:    '#000',
  database:     '#fff',
  webapp:       '#fff',
  queue:        '#fff',
  domain:       '#fff',
  adr:          '#fff',
  'fitness-fn': '#fff',
}

export const TYPE_LABELS: Record<C4ElementType, string> = {
  person:       'Person',
  system:       'Software System',
  container:    'Container',
  component:    'Component',
  database:     'Database',
  webapp:       'Web App',
  queue:        'Queue',
  domain:       'Domain',
  adr:          'ADR',
  'fitness-fn': 'Fitness Function',
}

// ─── SVG icon paths (16×16 viewBox) ──────────────────────────────────────────

/** SVG path data for each C4 element type (viewBox 0 0 16 16) */
export const TYPE_ICON_PATHS: Record<C4ElementType, string> = {
  person:       'M8 2a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5ZM3 12.5C3 10.01 5.24 8 8 8s5 2.01 5 4.5V14H3v-1.5Z',
  system:       'M2 3.5A1.5 1.5 0 0 1 3.5 2h9A1.5 1.5 0 0 1 14 3.5v9a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 12.5v-9ZM4 5h8v1H4V5Zm0 2.5h8v1H4v-1Zm0 2.5h5v1H4V10Z',
  container:    'M1 4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v1H1V4Zm0 2.5h14V12a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V6.5ZM3 3a.5.5 0 1 0 0 1 .5.5 0 0 0 0-1Zm2 0a.5.5 0 1 0 0 1 .5.5 0 0 0 0-1Z',
  component:    'M5 1v2H3a1 1 0 0 0-1 1v2h2v2H2v2h2v2H2v2a1 1 0 0 0 1 1h2v2h2v-2h2v2h2v-2h2a1 1 0 0 0 1-1v-2h-2v-2h2V8h-2V6h2V4a1 1 0 0 0-1-1h-2V1H9v2H7V1H5Z',
  database:     'M8 1C4.7 1 2 2.3 2 4v8c0 1.7 2.7 3 6 3s6-1.3 6-3V4c0-1.7-2.7-3-6-3ZM2 4c0 1.7 2.7 3 6 3s6-1.3 6-3',
  webapp:       'M2 3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3Zm1 2.5V13h10V5.5H3ZM4 3.5a.5.5 0 1 0 0 1 .5.5 0 0 0 0-1Zm1.5 0a.5.5 0 1 0 0 1 .5.5 0 0 0 0-1Zm1.5 0a.5.5 0 1 0 0 1 .5.5 0 0 0 0-1Z',
  queue:        'M4 3a3 2 0 1 0 0 4h8a3 2 0 1 0 0-4H4Zm-2 5.5a3 2 0 0 0 4 0v-1a3 2 0 0 1-4 0v1Zm10 0a3 2 0 0 0 4 0v-1a3 2 0 0 1-4 0v1Z',
  domain:       'M2 3.5A1.5 1.5 0 0 1 3.5 2h9A1.5 1.5 0 0 1 14 3.5v9a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 12.5v-9Zm1.5 1A.5.5 0 0 0 3 5v6a.5.5 0 0 0 .5.5h9A.5.5 0 0 0 13 11V5a.5.5 0 0 0-.5-.5h-9ZM5 7h2v2H5V7Zm4 0h2v2H9V7Z',
  // ADR: document with text lines
  adr:          'M4.5 1C3.67 1 3 1.67 3 2.5v11c0 .83.67 1.5 1.5 1.5h7c.83 0 1.5-.67 1.5-1.5V6L9 1H4.5ZM9 2l3 3.5H9V2ZM5 8h6v1H5V8Zm0 2.5h6v1H5v-1Zm0 2.5h3.5v1H5V13Z',
  // Fitness Function: concentric circles (target / gauge)
  'fitness-fn': 'M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2Zm0 1.5a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9ZM8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Zm0 1a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Z',
}
