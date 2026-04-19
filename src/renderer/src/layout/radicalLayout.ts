/**
 * Radical Layout — C4-semantic layered layout algorithm.
 *
 * Produces human-quality layouts by understanding C4 model semantics:
 *   1. Components stack vertically inside containers (topo-sorted)
 *   2. Containers left-to-right inside systems (topo-sorted by data flow)
 *   3. Internal systems layered by dependency depth from user entry points
 *   4. Persons centered above their primary containers
 *   5. External systems in a right column, ordered by calling container
 *   6. Downstream systems centered below their upstream sources
 *
 * This is NOT a generic graph layout — it understands C4 hierarchy.
 */

import {
  C4Node,
  C4Relation,
  PositionMap,
  NODE_SIZES,
  COLLAPSED_HEIGHT,
  COLLAPSED_WIDTH,
} from '../types/c4'

// ─── Configuration ───────────────────────────────────────────────────────────

const COMPOUND_PAD_TOP    = 70
const COMPOUND_PAD_SIDE   = 20
const COMPOUND_PAD_BOTTOM = 20
const COMPONENT_GAP       = 20   // vertical gap between stacked components
const CONTAINER_GAP       = 20   // horizontal gap between containers
const SYSTEM_GAP          = 40   // horizontal gap between systems in the same layer
const PERSON_GAP          = 40   // horizontal gap between persons
const PERSON_SYS_GAP      = 40   // vertical gap: person row → first system layer
const SYSTEM_LAYER_GAP    = 60   // vertical gap between system layers
const EXTERNAL_COL_GAP    = 60   // gap: right edge of internal layout → external column
const EXTERNAL_ROW_GAP    = 40   // vertical gap between external systems
const GRID_SIZE           = 20   // snap unit

// ─── Helpers ─────────────────────────────────────────────────────────────────

function snap(v: number): number {
  return Math.round(v / GRID_SIZE) * GRID_SIZE
}

function effectiveWidth(n: C4Node): number {
  if ((n.type === 'system' || n.type === 'container') && n.collapsed) {
    return COLLAPSED_WIDTH[n.type]
  }
  return n.width
}

function effectiveHeight(n: C4Node): number {
  if ((n.type === 'system' || n.type === 'container') && n.collapsed) {
    return COLLAPSED_HEIGHT[n.type]
  }
  return n.height
}

function isVisible(node: C4Node, allNodes: Record<string, C4Node>): boolean {
  if (!node.parentId) return true
  const parent = allNodes[node.parentId]
  if (!parent) return true
  if (parent.collapsed) return false
  return isVisible(parent, allNodes)
}

function getVisibleChildren(
  parentId: string | undefined,
  nodes: Record<string, C4Node>
): C4Node[] {
  return Object.values(nodes).filter(
    (n) => n.parentId === parentId && isVisible(n, nodes)
  )
}

/** Walk up parent chain to root ancestor */
function rootAncestor(id: string, allNodes: Record<string, C4Node>): string {
  const n = allNodes[id]
  if (!n?.parentId) return id
  return rootAncestor(n.parentId, allNodes)
}

/** Find the nearest container ancestor (or the node itself if it's a container) */
function containerAncestor(
  id: string,
  allNodes: Record<string, C4Node>
): string | null {
  const n = allNodes[id]
  if (!n) return null
  if (n.type === 'container') return id
  if (n.parentId) {
    const parent = allNodes[n.parentId]
    if (parent?.type === 'container') return parent.id
    return containerAncestor(n.parentId, allNodes)
  }
  return null
}

/** Compute absolute coordinate by walking up the parent chain */
function absolutePos(
  id: string,
  axis: 'x' | 'y',
  allNodes: Record<string, C4Node>,
  result: PositionMap
): number | null {
  const pos = result[id]
  if (!pos) return null
  let val = pos[axis]
  let current = allNodes[id]
  while (current?.parentId) {
    const parentPos = result[current.parentId]
    if (!parentPos) break
    val += parentPos[axis]
    current = allNodes[current.parentId]
  }
  return val
}

// ─── Topological Sort (Kahn's algorithm) ─────────────────────────────────────

function topoSort(dag: Map<string, Set<string>>): string[] {
  const inDeg = new Map<string, number>()
  for (const [id] of dag) inDeg.set(id, 0)
  for (const [, targets] of dag) {
    for (const t of targets) {
      inDeg.set(t, (inDeg.get(t) ?? 0) + 1)
    }
  }

  const queue: string[] = []
  for (const [id, deg] of inDeg) {
    if (deg === 0) queue.push(id)
  }

  const ordered: string[] = []
  while (queue.length > 0) {
    queue.sort() // deterministic tie-breaking by ID
    const id = queue.shift()!
    ordered.push(id)
    for (const t of dag.get(id) ?? []) {
      const nd = (inDeg.get(t) ?? 0) - 1
      inDeg.set(t, nd)
      if (nd === 0) queue.push(t)
    }
  }

  // Handle cycles: append remaining nodes
  const placed = new Set(ordered)
  for (const [id] of dag) {
    if (!placed.has(id)) ordered.push(id)
  }
  return ordered
}

// ─── Phase 1: Bottom-up inner layout ─────────────────────────────────────────

/**
 * Stack children inside a container:
 *  - If ≤3 children: vertical column
 *  - If >3 children: 2-column grid (left-to-right, top-to-bottom)
 * Topo-sorted by internal edges.
 */
function layoutComponents(
  containerId: string,
  allNodes: Record<string, C4Node>,
  allRelations: Record<string, C4Relation>,
  result: PositionMap
): void {
  const children = getVisibleChildren(containerId, allNodes)
  if (children.length === 0) return

  // Build internal DAG (edges between siblings in the same container)
  const childSet = new Set(children.map((c) => c.id))
  const dag = new Map<string, Set<string>>()
  for (const c of children) dag.set(c.id, new Set())

  for (const rel of Object.values(allRelations)) {
    if (childSet.has(rel.sourceId) && childSet.has(rel.targetId)) {
      dag.get(rel.sourceId)!.add(rel.targetId)
    }
  }

  const order = topoSort(dag)

  const compW = NODE_SIZES.component.width
  const compH = NODE_SIZES.component.height

  const cols = order.length > 3 ? 2 : 1

  for (let i = 0; i < order.length; i++) {
    const col = i % cols
    const row = Math.floor(i / cols)
    result[order[i]] = {
      x: COMPOUND_PAD_SIDE + col * (compW + COMPONENT_GAP),
      y: COMPOUND_PAD_TOP + row * (compH + COMPONENT_GAP),
      width: compW,
      height: compH,
    }
  }
}

/** Compute container size from its laid-out children. */
function sizeContainer(
  containerId: string,
  allNodes: Record<string, C4Node>,
  result: PositionMap
): void {
  const container = allNodes[containerId]
  if (!container) return

  if (container.collapsed) {
    result[containerId] = {
      x: result[containerId]?.x ?? 0,
      y: result[containerId]?.y ?? 0,
      width: COLLAPSED_WIDTH.container,
      height: COLLAPSED_HEIGHT.container,
    }
    return
  }

  const children = Object.values(allNodes).filter(
    (n) => n.parentId === containerId && result[n.id]
  )

  if (children.length === 0) {
    result[containerId] = {
      x: result[containerId]?.x ?? 0,
      y: result[containerId]?.y ?? 0,
      width: NODE_SIZES.container.width,
      height: NODE_SIZES.container.height,
    }
    return
  }

  let maxRight = 0,
    maxBottom = 0
  for (const child of children) {
    const pos = result[child.id]
    maxRight = Math.max(maxRight, pos.x + (pos.width ?? effectiveWidth(child)))
    maxBottom = Math.max(
      maxBottom,
      pos.y + (pos.height ?? effectiveHeight(child))
    )
  }

  result[containerId] = {
    x: result[containerId]?.x ?? 0,
    y: result[containerId]?.y ?? 0,
    width: Math.max(maxRight + COMPOUND_PAD_SIDE, NODE_SIZES.container.width),
    height: Math.max(
      maxBottom + COMPOUND_PAD_BOTTOM,
      NODE_SIZES.container.height
    ),
  }
}

/**
 * Layout containers inside a system:
 *   1. Layout components in each container (vertical stack)
 *   2. Size each container
 *   3. Topo-sort containers by cross-container data flow
 *   4. Place containers in a horizontal row
 *   5. Size the system
 */
function layoutContainersInSystem(
  systemId: string,
  allNodes: Record<string, C4Node>,
  allRelations: Record<string, C4Relation>,
  result: PositionMap
): void {
  const system = allNodes[systemId]
  if (!system) return

  if (system.collapsed) {
    result[systemId] = {
      x: result[systemId]?.x ?? 0,
      y: result[systemId]?.y ?? 0,
      width: COLLAPSED_WIDTH[system.type] ?? effectiveWidth(system),
      height: COLLAPSED_HEIGHT[system.type] ?? effectiveHeight(system),
    }
    return
  }

  const containers = getVisibleChildren(systemId, allNodes).filter(
    (n) => n.type === 'container'
  )

  if (containers.length === 0) {
    // Leaf system / non-system root node — keep its own size
    result[systemId] = {
      x: result[systemId]?.x ?? 0,
      y: result[systemId]?.y ?? 0,
      width: effectiveWidth(system),
      height: effectiveHeight(system),
    }
    return
  }

  // Layout components inside each container, then size it
  for (const ctn of containers) {
    layoutComponents(ctn.id, allNodes, allRelations, result)
    sizeContainer(ctn.id, allNodes, result)
  }

  // Build container-level DAG from cross-container relations
  const containerIds = new Set(containers.map((c) => c.id))
  const nodeToContainer = new Map<string, string>()
  for (const ctn of containers) {
    nodeToContainer.set(ctn.id, ctn.id)
    for (const child of getVisibleChildren(ctn.id, allNodes)) {
      nodeToContainer.set(child.id, ctn.id)
    }
  }

  const dag = new Map<string, Set<string>>()
  for (const ctn of containers) dag.set(ctn.id, new Set())

  for (const rel of Object.values(allRelations)) {
    const srcCtn = nodeToContainer.get(rel.sourceId)
    const tgtCtn = nodeToContainer.get(rel.targetId)
    if (
      srcCtn &&
      tgtCtn &&
      srcCtn !== tgtCtn &&
      containerIds.has(srcCtn) &&
      containerIds.has(tgtCtn)
    ) {
      dag.get(srcCtn)!.add(tgtCtn)
    }
  }

  const order = topoSort(dag)

  // Place containers in a horizontal row
  let x = COMPOUND_PAD_SIDE
  for (const ctnId of order) {
    const pos = result[ctnId]
    if (pos) {
      pos.x = x
      pos.y = COMPOUND_PAD_TOP
    }
    x += (result[ctnId]?.width ?? NODE_SIZES.container.width) + CONTAINER_GAP
  }

  // Size the system to fit its containers
  let maxRight = 0,
    maxBottom = 0
  for (const ctnId of order) {
    const pos = result[ctnId]
    if (!pos) continue
    maxRight = Math.max(
      maxRight,
      pos.x + (pos.width ?? NODE_SIZES.container.width)
    )
    maxBottom = Math.max(
      maxBottom,
      pos.y + (pos.height ?? NODE_SIZES.container.height)
    )
  }

  result[systemId] = {
    x: result[systemId]?.x ?? 0,
    y: result[systemId]?.y ?? 0,
    width: Math.max(maxRight + COMPOUND_PAD_SIDE, NODE_SIZES.system.width),
    height: Math.max(maxBottom + COMPOUND_PAD_BOTTOM, NODE_SIZES.system.height),
  }
}

// ─── Phase 2: Root-level classification and layering ─────────────────────────

function classifyRootNodes(allNodes: Record<string, C4Node>): {
  persons: C4Node[]
  internalNodes: C4Node[]
  externalNodes: C4Node[]
} {
  const persons: C4Node[] = []
  const internalNodes: C4Node[] = []
  const externalNodes: C4Node[] = []

  for (const n of Object.values(allNodes)) {
    if (n.parentId) continue
    if (n.external) {
      externalNodes.push(n)
    } else if (n.type === 'person') {
      persons.push(n)
    } else {
      internalNodes.push(n)
    }
  }

  return { persons, internalNodes, externalNodes }
}

/** Build root-level DAG by collapsing all relations to root ancestors */
function buildRootDAG(
  allNodes: Record<string, C4Node>,
  allRelations: Record<string, C4Relation>
): Map<string, Set<string>> {
  const rootIds = new Set(
    Object.values(allNodes)
      .filter((n) => !n.parentId)
      .map((n) => n.id)
  )

  const dag = new Map<string, Set<string>>()
  for (const id of rootIds) dag.set(id, new Set())

  for (const rel of Object.values(allRelations)) {
    const srcRoot = rootAncestor(rel.sourceId, allNodes)
    const tgtRoot = rootAncestor(rel.targetId, allNodes)
    if (srcRoot !== tgtRoot && rootIds.has(srcRoot) && rootIds.has(tgtRoot)) {
      dag.get(srcRoot)!.add(tgtRoot)
    }
  }

  return dag
}

/**
 * Assign layers to internal nodes using longest-path from persons.
 * Ensures downstream systems are placed below upstream ones even when
 * a person connects directly to both.
 */
function assignLayers(
  persons: C4Node[],
  internalNodes: C4Node[],
  rootDAG: Map<string, Set<string>>
): Map<string, number> {
  const layers = new Map<string, number>()
  const internalIds = new Set(internalNodes.map((s) => s.id))

  // Initialise: internal nodes reachable from persons → layer 0
  for (const p of persons) {
    for (const target of rootDAG.get(p.id) ?? []) {
      if (internalIds.has(target)) {
        layers.set(target, Math.max(layers.get(target) ?? 0, 0))
      }
    }
  }

  // Bellman-Ford relaxation: propagate longest path through internal nodes
  let changed = true
  for (let iter = 0; iter < internalNodes.length + 1 && changed; iter++) {
    changed = false
    for (const [srcId, targets] of rootDAG) {
      if (!internalIds.has(srcId)) continue
      const srcLayer = layers.get(srcId)
      if (srcLayer === undefined) continue
      for (const tgtId of targets) {
        if (!internalIds.has(tgtId)) continue
        const newLayer = srcLayer + 1
        if (newLayer > (layers.get(tgtId) ?? -1)) {
          layers.set(tgtId, newLayer)
          changed = true
        }
      }
    }
  }

  // Unreachable internal nodes → layer 0
  for (const n of internalNodes) {
    if (!layers.has(n.id)) layers.set(n.id, 0)
  }

  return layers
}

// ─── Phase 3: Coordinate assignment ──────────────────────────────────────────

export function applyRadicalLayout(
  c4Nodes: Record<string, C4Node>,
  c4Relations: Record<string, C4Relation>
): PositionMap {
  const result: PositionMap = {}

  // ── Classify root nodes ────────────────────────────────────────────────
  const { persons, internalNodes, externalNodes } = classifyRootNodes(c4Nodes)

  // ── Bottom-up layout of internal nodes ─────────────────────────────────
  for (const node of internalNodes) {
    if (node.type === 'system' && !node.collapsed) {
      layoutContainersInSystem(node.id, c4Nodes, c4Relations, result)
    } else if (node.type === 'container' && !node.collapsed) {
      layoutComponents(node.id, c4Nodes, c4Relations, result)
      sizeContainer(node.id, c4Nodes, result)
    } else {
      result[node.id] = {
        x: 0,
        y: 0,
        width: effectiveWidth(node),
        height: effectiveHeight(node),
      }
    }
  }

  // ── Layer assignment ───────────────────────────────────────────────────
  const rootDAG = buildRootDAG(c4Nodes, c4Relations)
  const nodeLayers = assignLayers(persons, internalNodes, rootDAG)

  // Group internal nodes by layer
  const layerGroups = new Map<number, C4Node[]>()
  for (const node of internalNodes) {
    const layer = nodeLayers.get(node.id) ?? 0
    if (!layerGroups.has(layer)) layerGroups.set(layer, [])
    layerGroups.get(layer)!.push(node)
  }

  // ── Place internal nodes layer by layer ────────────────────────────────
  const personRowH = persons.length > 0 ? NODE_SIZES.person.height : 0
  let currentY = personRowH > 0 ? personRowH + PERSON_SYS_GAP : 0

  const maxLayer =
    layerGroups.size > 0
      ? Math.max(...Array.from(layerGroups.keys()))
      : -1

  for (let layer = 0; layer <= maxLayer; layer++) {
    const systems = layerGroups.get(layer) ?? []
    if (systems.length === 0) continue

    if (layer === 0) {
      // First layer: place in a row starting at x = 0
      let x = 0
      for (const sys of systems) {
        if (result[sys.id]) {
          result[sys.id].x = snap(x)
          result[sys.id].y = snap(currentY)
        }
        x += (result[sys.id]?.width ?? effectiveWidth(sys)) + SYSTEM_GAP
      }
    } else {
      // Downstream layers: center below upstream sources, then resolve overlaps
      const layerSystems = layerGroups.get(layer)!
      
      for (const sys of layerSystems) {
        const sourceCentersX: number[] = []
        for (const rel of Object.values(c4Relations)) {
          const srcRoot = rootAncestor(rel.sourceId, c4Nodes)
          const tgtRoot = rootAncestor(rel.targetId, c4Nodes)
          if (tgtRoot === sys.id && srcRoot !== sys.id) {
            const srcCtn =
              containerAncestor(rel.sourceId, c4Nodes) ?? rel.sourceId
            const absX = absolutePos(srcCtn, 'x', c4Nodes, result)
            const w = result[srcCtn]?.width ?? NODE_SIZES.container.width
            if (absX !== null) sourceCentersX.push(absX + w / 2)
          }
        }

        const sysW = result[sys.id]?.width ?? effectiveWidth(sys)
        let sysX: number
        if (sourceCentersX.length > 0) {
          const avgX =
            sourceCentersX.reduce((a, b) => a + b, 0) /
            sourceCentersX.length
          sysX = avgX - sysW / 2
        } else {
          sysX = 0
        }

        if (result[sys.id]) {
          result[sys.id].x = snap(Math.max(0, sysX))
          result[sys.id].y = snap(currentY)
        }
      }

      // Resolve horizontal overlaps within this layer
      const sorted = [...layerSystems].sort(
        (a, b) => (result[a.id]?.x ?? 0) - (result[b.id]?.x ?? 0)
      )
      for (let i = 1; i < sorted.length; i++) {
        const prev = result[sorted[i - 1].id]
        const cur = result[sorted[i].id]
        if (!prev || !cur) continue
        const prevRight = prev.x + (prev.width ?? effectiveWidth(sorted[i - 1]))
        const minX = prevRight + SYSTEM_GAP
        if (cur.x < minX) cur.x = snap(minX)
      }
    }

    // Advance Y past the tallest node in this layer
    let maxH = 0
    for (const sys of systems) {
      maxH = Math.max(
        maxH,
        result[sys.id]?.height ?? effectiveHeight(sys)
      )
    }
    currentY += maxH + SYSTEM_LAYER_GAP
  }

  // ── Place persons centered above their target containers ───────────────
  if (persons.length > 0) {
    const personW = NODE_SIZES.person.width
    const personH = NODE_SIZES.person.height

    type PP = { person: C4Node; targetX: number }
    const pps: PP[] = []

    for (const p of persons) {
      const weights = new Map<string, number>()
      for (const rel of Object.values(c4Relations)) {
        let targetId: string | null = null
        if (rel.sourceId === p.id) targetId = rel.targetId
        else if (rel.targetId === p.id) targetId = rel.sourceId
        else continue

        const ctn = containerAncestor(targetId, c4Nodes)
        const key = ctn ?? rootAncestor(targetId, c4Nodes)
        weights.set(key, (weights.get(key) ?? 0) + 1)
      }

      if (weights.size > 0) {
        let sumX = 0,
          totalW = 0
        for (const [keyId, w] of weights) {
          const absX = absolutePos(keyId, 'x', c4Nodes, result)
          const nodeW =
            result[keyId]?.width ??
            (c4Nodes[keyId] ? effectiveWidth(c4Nodes[keyId]) : 200)
          if (absX !== null) {
            sumX += (absX + nodeW / 2) * w
            totalW += w
          }
        }
        pps.push({
          person: p,
          targetX: totalW > 0 ? sumX / totalW - personW / 2 : 0,
        })
      } else {
        pps.push({ person: p, targetX: 0 })
      }
    }

    // Sort left-to-right by ideal X
    pps.sort((a, b) => a.targetX - b.targetX)

    // Place at y = 0
    for (const pp of pps) {
      result[pp.person.id] = {
        x: snap(pp.targetX),
        y: 0,
        width: personW,
        height: personH,
      }
    }

    // Resolve horizontal overlaps: push rightward
    for (let i = 1; i < pps.length; i++) {
      const prev = result[pps[i - 1].person.id]
      const cur = result[pps[i].person.id]
      const minX = prev.x + personW + PERSON_GAP
      if (cur.x < minX) cur.x = snap(minX)
    }
  }

  // ── Place external nodes in a right column ─────────────────────────────
  if (externalNodes.length > 0) {
    // Find rightmost edge of internal layout
    let maxRight = 0
    for (const id of Object.keys(result)) {
      const n = c4Nodes[id]
      if (!n || n.parentId) continue
      const pos = result[id]
      maxRight = Math.max(
        maxRight,
        pos.x + (pos.width ?? effectiveWidth(n))
      )
    }

    const extX = snap(maxRight + EXTERNAL_COL_GAP)

    // Order externals by calling node's absolute Y (align vertically with callers)
    type ES = { node: C4Node; callerAbsY: number }
    const scored: ES[] = []

    for (const ext of externalNodes) {
      let sumY = 0
      let count = 0

      for (const rel of Object.values(c4Relations)) {
        let callerId: string | null = null
        if (rel.targetId === ext.id) callerId = rel.sourceId
        else if (rel.sourceId === ext.id) callerId = rel.targetId
        else continue

        // Find the best ancestor to align with
        const ctn = containerAncestor(callerId, c4Nodes)
        const alignId = ctn ?? rootAncestor(callerId, c4Nodes)
        const absY = absolutePos(alignId, 'y', c4Nodes, result)
        const absH = result[alignId]?.height ?? NODE_SIZES.container.height
        if (absY !== null) {
          sumY += absY + absH / 2
          count++
        }
      }

      scored.push({
        node: ext,
        callerAbsY: count > 0 ? sumY / count : Infinity,
      })
    }

    scored.sort((a, b) => a.callerAbsY - b.callerAbsY)

    const extW = 240
    const extH = 100

    for (const s of scored) {
      // Align external node's center-Y with the weighted average of its callers
      let targetY = s.callerAbsY - extH / 2
      if (!isFinite(targetY)) targetY = 0

      result[s.node.id] = {
        x: extX,
        y: snap(Math.max(0, targetY)),
        width: extW,
        height: extH,
      }
    }

    // Resolve vertical overlaps among externals
    const sortedExts = scored.map((s) => s.node.id)
    for (let i = 1; i < sortedExts.length; i++) {
      const prev = result[sortedExts[i - 1]]
      const cur = result[sortedExts[i]]
      if (!prev || !cur) continue
      const prevBottom = prev.y + (prev.height ?? extH)
      const minY = prevBottom + EXTERNAL_ROW_GAP
      if (cur.y < minY) cur.y = snap(minY)
    }
  }

  // ── Final grid snap ────────────────────────────────────────────────────
  for (const id of Object.keys(result)) {
    const p = result[id]
    p.x = snap(p.x)
    p.y = snap(p.y)
  }

  return result
}
