// ─── C4 domain types ────────────────────────────────────────────────────────

export type C4ElementType = 'person' | 'system' | 'container' | 'component' | 'database'

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

export interface DiagramView {
  id: string
  name: string
  /** C4 node IDs included in this view. Ancestors are auto-included. */
  nodeIds: string[]
  /** Per-node positions for this view */
  positions: Record<string, NodePosition>
}

/** Named snapshot (version) of the diagram state */
export interface DiagramSnapshot {
  id: string
  name: string
  timestamp: number
  nodes: Record<string, C4Node>
  relations: Record<string, C4Relation>
}

export interface DiagramData {
  nodes: C4Node[]
  relations: C4Relation[]
  views?: DiagramView[]
  /** Positions for the "All" (default) view */
  defaultPositions?: Record<string, NodePosition>
  /** Named snapshots (versions) */
  snapshots?: DiagramSnapshot[]
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
}

// ─── Layout position map ─────────────────────────────────────────────────────

export type PositionMap = Record<string, { x: number; y: number; width?: number; height?: number }>

// ─── Node default sizes ──────────────────────────────────────────────────────

export const NODE_SIZES: Record<C4ElementType, { width: number; height: number }> = {
  person:    { width: 130, height: 140 },
  system:    { width: 340, height: 240 },
  container: { width: 280, height: 180 },
  component: { width: 200, height: 100 },
  database:  { width: 200, height: 120 },
}

export const COLLAPSED_HEIGHT: Record<C4ElementType, number> = {
  person:    140,
  system:    70,
  container: 60,
  component: 100,
  database:  120,
}

export const COLLAPSED_WIDTH: Record<C4ElementType, number> = {
  person:    130,
  system:    220,
  container: 200,
  component: 200,
  database:  200,
}

export const NODE_COLORS: Record<C4ElementType, string> = {
  person:    '#08427b',
  system:    '#1168bd',
  container: '#438dd5',
  component: '#85bbf0',
  database:  '#438dd5',
}

export const NODE_FG: Record<C4ElementType, string> = {
  person:    '#fff',
  system:    '#fff',
  container: '#fff',
  component: '#000',
  database:  '#fff',
}

export const TYPE_LABELS: Record<C4ElementType, string> = {
  person:    'Person',
  system:    'Software System',
  container: 'Container',
  component: 'Component',
  database:  'Database',
}

// ─── SVG icon paths (16×16 viewBox) ──────────────────────────────────────────

/** SVG path data for each C4 element type (viewBox 0 0 16 16) */
export const TYPE_ICON_PATHS: Record<C4ElementType, string> = {
  person:    'M8 2a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5ZM3 12.5C3 10.01 5.24 8 8 8s5 2.01 5 4.5V14H3v-1.5Z',
  system:    'M2 3.5A1.5 1.5 0 0 1 3.5 2h9A1.5 1.5 0 0 1 14 3.5v9a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 12.5v-9ZM4 5h8v1H4V5Zm0 2.5h8v1H4v-1Zm0 2.5h5v1H4V10Z',
  container: 'M1 4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v1H1V4Zm0 2.5h14V12a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V6.5ZM3 3a.5.5 0 1 0 0 1 .5.5 0 0 0 0-1Zm2 0a.5.5 0 1 0 0 1 .5.5 0 0 0 0-1Z',
  component: 'M5 1v2H3a1 1 0 0 0-1 1v2h2v2H2v2h2v2H2v2a1 1 0 0 0 1 1h2v2h2v-2h2v2h2v-2h2a1 1 0 0 0 1-1v-2h-2v-2h2V8h-2V6h2V4a1 1 0 0 0-1-1h-2V1H9v2H7V1H5Z',
  database:  'M8 1C4.7 1 2 2.3 2 4v8c0 1.7 2.7 3 6 3s6-1.3 6-3V4c0-1.7-2.7-3-6-3ZM2 4c0 1.7 2.7 3 6 3s6-1.3 6-3',
}
