// ─── C4 domain types ────────────────────────────────────────────────────────

import type { Metamodel } from './metamodel'

export type C4ElementType = 'person' | 'system' | 'container' | 'component' | 'database' | 'webapp' | 'queue' | 'domain'

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
}

export interface DiagramView {
  id: string
  name: string
  /**
   * 'static' (default) = ordinary filtered view.
   * 'dynamic' = shows step-number badges on edges from the linked sequence.
   */
  kind?: 'static' | 'dynamic'
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
}

/** Named snapshot (version) of the diagram state */
export interface DiagramSnapshot {
  id: string
  name: string
  timestamp: number
  nodes: Record<string, C4Node>
  relations: Record<string, C4Relation>
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
  isVirtual: boolean
  /** 1-based step index when this edge is part of the active dynamic view sequence */
  sequenceStep?: number
}

// ─── Layout position map ─────────────────────────────────────────────────────

export type PositionMap = Record<string, { x: number; y: number; width?: number; height?: number }>

// ─── Node default sizes ──────────────────────────────────────────────────────

export const NODE_SIZES: Record<C4ElementType, { width: number; height: number }> = {
  person:    { width: 150, height: 170 },
  system:    { width: 360, height: 260 },
  container: { width: 300, height: 200 },
  component: { width: 200, height: 120 },
  database:  { width: 190, height: 130 },
  webapp:    { width: 210, height: 140 },
  queue:     { width: 220, height: 95 },
  domain:    { width: 520, height: 360 },
}

export const COLLAPSED_HEIGHT: Record<C4ElementType, number> = {
  person:    170,
  system:    180,
  container: 160,
  component: 120,
  database:  130,
  webapp:    140,
  queue:     95,
  domain:    220,
}

export const COLLAPSED_WIDTH: Record<C4ElementType, number> = {
  person:    150,
  system:    280,
  container: 240,
  component: 200,
  database:  190,
  webapp:    210,
  queue:     220,
  domain:    360,
}

export const NODE_COLORS: Record<C4ElementType, string> = {
  person:    '#08427b',
  system:    '#1168bd',
  container: '#438dd5',
  component: '#85bbf0',
  database:  '#438dd5',
  webapp:    '#438dd5',
  queue:     '#438dd5',
  domain:    '#4c1d95',
}

export const NODE_FG: Record<C4ElementType, string> = {
  person:    '#fff',
  system:    '#fff',
  container: '#fff',
  component: '#000',
  database:  '#fff',
  webapp:    '#fff',
  queue:     '#fff',
  domain:    '#fff',
}

export const TYPE_LABELS: Record<C4ElementType, string> = {
  person:    'Person',
  system:    'Software System',
  container: 'Container',
  component: 'Component',
  database:  'Database',
  webapp:    'Web App',
  queue:     'Queue',
  domain:    'Domain',
}

// ─── SVG icon paths (16×16 viewBox) ──────────────────────────────────────────

/** SVG path data for each C4 element type (viewBox 0 0 16 16) */
export const TYPE_ICON_PATHS: Record<C4ElementType, string> = {
  person:    'M8 2a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5ZM3 12.5C3 10.01 5.24 8 8 8s5 2.01 5 4.5V14H3v-1.5Z',
  system:    'M2 3.5A1.5 1.5 0 0 1 3.5 2h9A1.5 1.5 0 0 1 14 3.5v9a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 12.5v-9ZM4 5h8v1H4V5Zm0 2.5h8v1H4v-1Zm0 2.5h5v1H4V10Z',
  container: 'M1 4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v1H1V4Zm0 2.5h14V12a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V6.5ZM3 3a.5.5 0 1 0 0 1 .5.5 0 0 0 0-1Zm2 0a.5.5 0 1 0 0 1 .5.5 0 0 0 0-1Z',
  component: 'M5 1v2H3a1 1 0 0 0-1 1v2h2v2H2v2h2v2H2v2a1 1 0 0 0 1 1h2v2h2v-2h2v2h2v-2h2a1 1 0 0 0 1-1v-2h-2v-2h2V8h-2V6h2V4a1 1 0 0 0-1-1h-2V1H9v2H7V1H5Z',
  database:  'M8 1C4.7 1 2 2.3 2 4v8c0 1.7 2.7 3 6 3s6-1.3 6-3V4c0-1.7-2.7-3-6-3ZM2 4c0 1.7 2.7 3 6 3s6-1.3 6-3',
  webapp:    'M2 3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3Zm1 2.5V13h10V5.5H3ZM4 3.5a.5.5 0 1 0 0 1 .5.5 0 0 0 0-1Zm1.5 0a.5.5 0 1 0 0 1 .5.5 0 0 0 0-1Zm1.5 0a.5.5 0 1 0 0 1 .5.5 0 0 0 0-1Z',
  queue:     'M4 3a3 2 0 1 0 0 4h8a3 2 0 1 0 0-4H4Zm-2 5.5a3 2 0 0 0 4 0v-1a3 2 0 0 1-4 0v1Zm10 0a3 2 0 0 0 4 0v-1a3 2 0 0 1-4 0v1Z',
  // Domain: large rounded boundary with inner dashed marks
  domain:    'M2 3.5A1.5 1.5 0 0 1 3.5 2h9A1.5 1.5 0 0 1 14 3.5v9a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 12.5v-9Zm1.5 1A.5.5 0 0 0 3 5v6a.5.5 0 0 0 .5.5h9A.5.5 0 0 0 13 11V5a.5.5 0 0 0-.5-.5h-9ZM5 7h2v2H5V7Zm4 0h2v2H9V7Z',
}
