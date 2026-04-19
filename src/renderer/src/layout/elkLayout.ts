/**
 * ELK-based hierarchical layout.
 *
 * Uses the ELK "layered" algorithm (Sugiyama framework) which minimises
 * edge crossings via the LAYER_SWEEP barycenter heuristic.
 *
 * Key implementation detail:
 * ELK requires edges to be placed in the ElkNode that corresponds to the
 * Lowest Common Ancestor (LCA) of their source and target nodes.
 * Cross-hierarchy edges are placed at root.
 *
 * Reference: https://eclipse.dev/elk/reference/algorithms/org-eclipse-elk-layered.html
 */

import ELK from 'elkjs/lib/elk.bundled.js'
import type { ElkNode, ElkExtendedEdge, LayoutOptions } from 'elkjs'
import { C4Node, C4Relation, PositionMap, COLLAPSED_HEIGHT, COLLAPSED_WIDTH } from '../types/c4'

const elk = new ELK()

// ─── ELK layout options ──────────────────────────────────────────────────────

const LAYERED_OPTIONS: LayoutOptions = {
  'elk.algorithm': 'layered',
  'elk.direction': 'DOWN',

  // SEPARATE_CHILDREN (default): each compound node is laid out independently.
  // Cross-boundary crossing minimisation is handled by our geometric post-process
  // (minimizeCrossings in crossingOpt.ts) — safer than INCLUDE_CHILDREN which
  // crashes ELK's internal scanline constraint calculator with compound graphs.

  // ── Connected-component placement ────────────────────────────────────────
  'elk.separateConnectedComponents': 'true',
  'elk.spacing.componentComponent': '80',

  // ── Crossing minimisation ─────────────────────────────────────────────────
  'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
  'elk.layered.crossingMinimization.greedySwitch.type': 'TWO_SIDED',
  'elk.layered.thoroughness': '50',
  'elk.layered.considerModelOrder.strategy': 'NONE',

  // ── Node placement ────────────────────────────────────────────────────────
  'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',

  // ── Spacing ───────────────────────────────────────────────────────────────
  'elk.spacing.nodeNode': '60',
  'elk.layered.spacing.nodeNodeBetweenLayers': '80',
  'elk.spacing.edgeNode': '20',
  'elk.spacing.edgeEdge': '10',

  // ── Post-layout ──────────────────────────────────────────────────────────
  'elk.layered.unnecessaryBendpoints': 'true',
  'elk.layered.compaction.postCompaction.strategy': 'EDGE_LENGTH',
  'elk.padding': '[top=40, right=30, bottom=30, left=30]',
}

// Layout options for compound nodes (systems containing containers, or
// containers containing components).  RIGHT direction: children are laid
// out left-to-right in the layered algorithm.
const CHILD_OPTIONS: LayoutOptions = {
  'elk.algorithm': 'layered',
  'elk.direction': 'RIGHT',
  'elk.separateConnectedComponents': 'true',
  'elk.spacing.componentComponent': '40',
  'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
  'elk.layered.crossingMinimization.greedySwitch.type': 'TWO_SIDED',
  'elk.layered.thoroughness': '50',
  'elk.layered.considerModelOrder.strategy': 'NONE',
  'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
  'elk.spacing.nodeNode': '30',
  'elk.layered.spacing.nodeNodeBetweenLayers': '50',
  'elk.spacing.edgeNode': '12',
  'elk.spacing.edgeEdge': '8',
  'elk.layered.unnecessaryBendpoints': 'true',
  'elk.layered.compaction.postCompaction.strategy': 'EDGE_LENGTH',
  'elk.padding': '[top=40, right=20, bottom=20, left=20]',
}

// ─── Ancestor helpers ─────────────────────────────────────────────────────────

function ancestorChain(nodeId: string, nodes: Record<string, C4Node>): string[] {
  const chain: string[] = [nodeId]
  let cur = nodes[nodeId]
  while (cur?.parentId) {
    chain.push(cur.parentId)
    cur = nodes[cur.parentId]
  }
  return chain
}

function lcaContainerId(
  srcId: string,
  tgtId: string,
  nodes: Record<string, C4Node>
): string | undefined {
  if (srcId === tgtId) return nodes[srcId]?.parentId
  const srcSet = new Set(ancestorChain(srcId, nodes))
  for (const id of ancestorChain(tgtId, nodes)) {
    if (srcSet.has(id) && id !== srcId && id !== tgtId) return id
  }
  return undefined
}

// ─── Build ELK graph ─────────────────────────────────────────────────────────

type ElkNodeMap = Record<string, ElkNode>

function buildElkNode(
  n: C4Node,
  allNodes: Record<string, C4Node>,
  elkNodeMap: ElkNodeMap
): ElkNode {
  const isCollapsed = n.collapsed && (n.type === 'system' || n.type === 'container')
  const width  = isCollapsed ? COLLAPSED_WIDTH[n.type]  : n.width
  const height = isCollapsed ? COLLAPSED_HEIGHT[n.type] : n.height
  const childC4 = isCollapsed ? [] : Object.values(allNodes).filter((c) => c.parentId === n.id)
  const children = childC4.map((c) => buildElkNode(c, allNodes, elkNodeMap))

  const elkNode: ElkNode = {
    id: n.id,
    width,
    height,
    layoutOptions: children.length > 0 ? CHILD_OPTIONS : undefined,
    children,
    edges: [],
  }
  elkNodeMap[n.id] = elkNode
  return elkNode
}

// ─── Parse ELK result ────────────────────────────────────────────────────────

function parseElkResult(node: ElkNode, result: PositionMap): void {
  if (node.id !== 'root' && node.x != null && node.y != null) {
    result[node.id] = { x: node.x, y: node.y, width: node.width, height: node.height }
  }
  for (const child of node.children ?? []) {
    parseElkResult(child, result)
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function applyElkLayout(
  c4Nodes: Record<string, C4Node>,
  c4Relations: Record<string, C4Relation>
): Promise<PositionMap> {
  const elkNodeMap: ElkNodeMap = {}

  const rootChildren = Object.values(c4Nodes)
    .filter((n) => !n.parentId)
    .map((n) => buildElkNode(n, c4Nodes, elkNodeMap))

  const root: ElkNode = {
    id: 'root',
    layoutOptions: LAYERED_OPTIONS,
    children: rootChildren,
    edges: [],
  }
  elkNodeMap['root'] = root

  // Place each edge at its LCA container.
  // NOTE: ELK's SEPARATE_CHILDREN mode resolves deep-descendant edge endpoints
  // to direct children for layer-assignment purposes.  Using the raw component
  // ids (e.g. cmp8 inside sys1) is safe for ELK compound-edge routing; the
  // layer assignment at the root level is handled by crossingOpt post-process.
  for (const rel of Object.values(c4Relations)) {
    if (!c4Nodes[rel.sourceId] || !c4Nodes[rel.targetId]) continue
    const lca = lcaContainerId(rel.sourceId, rel.targetId, c4Nodes)
    const container: ElkNode = (lca ? elkNodeMap[lca] : root) ?? root
    const edge: ElkExtendedEdge = { id: rel.id, sources: [rel.sourceId], targets: [rel.targetId] }
    if (!container.edges) container.edges = []
    container.edges.push(edge)
  }

  try {
    const result = await elk.layout(root)
    const positions: PositionMap = {}
    parseElkResult(result, positions)
    return positions
  } catch (err) {
    console.error('[ELK] Layout error:', err)
    return {}
  }
}
