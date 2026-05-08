/**
 * WebCoLa physics-based layout.
 *
 * WebCoLa (Constraint-based layout) uses a force-directed simulation
 * augmented with hard constraints and group bounding boxes.
 * It excels at interactive / organic layouts and avoids node overlaps
 * while respecting containment hierarchy via "groups".
 *
 * Reference: https://ialab.it.monash.edu/webcola/
 */

import { Layout, InputNode, Group, Link } from 'webcola'
import {
  C4Node,
  C4Relation,
  PositionMap,
  COLLAPSED_HEIGHT,
  COLLAPSED_WIDTH,
  NODE_SIZES,
  isContainerType,
} from '../types/c4'

// webcola Node at runtime has x/y mutated in-place
interface ColaNode extends InputNode {
  x: number
  y: number
  width: number
  height: number
}

type ColaLink = Link<ColaNode | number>

// ─── Helpers ─────────────────────────────────────────────────────────────────

function effectiveHeight(n: C4Node): number {
  if (isContainerType(n.type) && n.collapsed) {
    return COLLAPSED_HEIGHT[n.type]
  }
  return n.height ?? NODE_SIZES[n.type].height
}

function effectiveWidth(n: C4Node): number {
  if (isContainerType(n.type) && n.collapsed) {
    return COLLAPSED_WIDTH[n.type]
  }
  return n.width ?? NODE_SIZES[n.type].width
}

// ─── Build cola graph ─────────────────────────────────────────────────────────

/**
 * Only "visible" nodes participate in the layout.
 * A node is visible if none of its ancestors are collapsed.
 */
function isVisible(node: C4Node, allNodes: Record<string, C4Node>): boolean {
  if (!node.parentId) return true
  const parent = allNodes[node.parentId]
  if (!parent) return true
  if (parent.collapsed) return false
  return isVisible(parent, allNodes)
}

export function applyColaLayout(
  c4Nodes: Record<string, C4Node>,
  c4Relations: Record<string, C4Relation>
): PositionMap {
  const visibleNodes = Object.values(c4Nodes).filter((n) =>
    isVisible(n, c4Nodes)
  )

  if (visibleNodes.length === 0) return {}

  // Map c4 id → cola node object
  const idToColaNode: Record<string, ColaNode> = {}
  const colaNodes: ColaNode[] = []

  for (const n of visibleNodes) {
    const cn: ColaNode = {
      x: n.x + effectiveWidth(n) / 2,  // webcola uses centre coords
      y: n.y + effectiveHeight(n) / 2,
      width:  effectiveWidth(n),
      height: effectiveHeight(n),
    }
    idToColaNode[n.id] = cn
    colaNodes.push(cn)
  }

  // Links from relations (only between visible nodes)
  const colaLinks: ColaLink[] = []
  for (const rel of Object.values(c4Relations)) {
    const src = idToColaNode[rel.sourceId]
    const tgt = idToColaNode[rel.targetId]
    if (!src || !tgt) continue
    colaLinks.push({ source: src, target: tgt })
  }

  // Groups: containers that have visible component children, and
  // systems that have visible container children.
  const colaGroups: Group[] = []
  const nodeToGroup: Record<string, Group> = {}

  // First pass: container → component groups
  for (const n of visibleNodes) {
    if (n.type === 'container' && !n.collapsed) {
      const childLeaves = visibleNodes
        .filter((c) => c.parentId === n.id)
        .map((c) => idToColaNode[c.id])
        .filter(Boolean)

      if (childLeaves.length > 0) {
        const g: Group = { leaves: childLeaves as any[], padding: 20 }
        nodeToGroup[n.id] = g
        colaGroups.push(g)
      }
    }
  }

  // Second pass: system → container groups (may reference sub-groups)
  for (const n of visibleNodes) {
    if (n.type === 'system' && !n.collapsed) {
      const childLeaves: any[] = []
      const childGroups: Group[] = []

      for (const c of visibleNodes.filter((v) => v.parentId === n.id)) {
        const subGroup = nodeToGroup[c.id]
        if (subGroup) {
          childGroups.push(subGroup)
        } else {
          const cn = idToColaNode[c.id]
          if (cn) childLeaves.push(cn)
        }
      }

      if (childLeaves.length + childGroups.length > 0) {
        const g: Group = {
          leaves: childLeaves.length > 0 ? childLeaves : undefined,
          groups: childGroups.length > 0 ? childGroups : undefined,
          padding: 40,
        }
        nodeToGroup[n.id] = g
        colaGroups.push(g)
      }
    }
  }

  // ── Run WebCoLa simulation ──────────────────────────────────────────────────
  const canvasW = 1800
  const canvasH = 1200

  try {
    const layout = new Layout()
    layout
      .nodes(colaNodes)
      .links(colaLinks)
      .groups(colaGroups)
      .size([canvasW, canvasH])
      .avoidOverlaps(true)
      .handleDisconnected(true)
      // Longer link distance → nodes spread farther apart → fewer edge crossings
      .linkDistance(180)
      .convergenceThreshold(1e-4)
      .start(
        100,  // unconstrained iterations (longer force simulation)
        20,   // user-constraint iterations
        100,  // all-constraint iterations (avoidOverlaps + groups)
        0,    // grid-snap iterations
        false // keepRunning = false → synchronous
      )

    // Collect absolute (canvas-space) positions from cola
    const absolutePos: Record<string, { x: number; y: number }> = {}
    for (const n of visibleNodes) {
      const cn = idToColaNode[n.id]
      // Cola uses centre coordinates → convert to top-left
      absolutePos[n.id] = {
        x: cn.x - cn.width / 2,
        y: cn.y - cn.height / 2,
      }
    }

    // Convert to parent-relative positions (React Flow parentNode convention).
    // Must use orignal absolute cola positions (not already-converted values)
    // to handle multi-level nesting correctly.
    const result: PositionMap = {}
    for (const n of visibleNodes) {
      const absPos = absolutePos[n.id]
      if (n.parentId && absolutePos[n.parentId]) {
        const parentAbs = absolutePos[n.parentId]
        result[n.id] = {
          x: absPos.x - parentAbs.x,
          y: absPos.y - parentAbs.y,
        }
      } else {
        result[n.id] = { x: absPos.x, y: absPos.y }
      }
    }

    return result
  } catch (err) {
    console.error('[WebCoLa] Layout error:', err)
    return {}
  }
}
