/**
 * Visual harness: runs `runSmartLayout` on a set of scenarios, renders each
 * resulting layout to an SVG file under tests/visual/out-*.svg, and prints a
 * compact metrics breakdown.
 *
 * Run: `node --import tsx tests/visual/layoutHarness.mjs`
 *
 * SVG matches what RelationEdge would render *closely enough* for visual
 * inspection (uses portAllocator.pickSides + the same cubic Bézier formula
 * used in computeRenderAwareEdgeMetrics).
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

const { runSmartLayout, computeCompositeScore } = await import(
  '../../src/renderer/src/layout/smartLayout.ts'
)
const { pickSides } = await import('../../src/renderer/src/layout/portAllocator.ts')

// ─── Scenarios ────────────────────────────────────────────────────────────

function N(id, type, label, w, h, extras = {}) {
  return { id, type, label, width: w, height: h, x: 0, y: 0, collapsed: false, ...extras }
}
function R(id, s, t, label) {
  return { id, sourceId: s, targetId: t, label }
}

/** Scenario from the user screenshot: 2 systems, 3 components, 2 persons, 1 ext system. */
function scenarioScreenshot() {
  const nodes = [
    // sysA
    N('sysA', 'system', 'System A', 460, 220),
    N('sysA.container', 'container', 'Container', 200, 110, { parentId: 'sysA' }),
    N('sysA.db', 'database', 'Database', 130, 80, { parentId: 'sysA' }),
    // sysB
    N('sysB', 'system', 'System B', 510, 520),
    N('sysB.containerB', 'container', 'Container', 440, 280, { parentId: 'sysB' }),
    N('sysB.db', 'database', 'Database', 130, 80, { parentId: 'sysB' }),
    N('sysB.queue', 'queue', 'Queue', 130, 70, { parentId: 'sysB' }),
    N('compA', 'component', 'Component A', 180, 70, { parentId: 'sysB.containerB' }),
    N('compB', 'component', 'Component B', 180, 70, { parentId: 'sysB.containerB' }),
    N('compC', 'component', 'Component C', 180, 70, { parentId: 'sysB.containerB' }),
    // External actors
    N('personTop', 'person', 'Person', 100, 70, { external: true }),
    N('personSide', 'person', 'Person', 100, 70, { external: true }),
    N('extSys', 'system', 'External', 150, 70, { external: true }),
  ]
  const relations = [
    R('r1', 'personTop', 'sysA.container'),
    R('r2', 'personTop', 'compA'),
    R('r3', 'personSide', 'sysB.containerB'),
    R('r4', 'sysA.container', 'sysA.db'),
    R('r5', 'sysA.container', 'sysB.queue'),
    R('r6', 'sysA.container', 'compB'),
    R('r7', 'extSys', 'sysB.containerB'),
    R('r8', 'extSys', 'sysA.container'),
    R('r9', 'compA', 'compB'),
    R('r10', 'compB', 'compC'),
    R('r11', 'compC', 'sysB.db'),
    R('r12', 'compA', 'sysB.queue'),
  ]
  return toMaps(nodes, relations)
}

/** Tiny: 3 systems chain. */
function scenarioChain() {
  const nodes = [
    N('a', 'system', 'API', 200, 100),
    N('b', 'system', 'Auth', 200, 100),
    N('c', 'system', 'DB', 200, 100),
    N('user', 'person', 'User', 100, 70, { external: true }),
  ]
  const relations = [
    R('e1', 'user', 'a'),
    R('e2', 'a', 'b'),
    R('e3', 'a', 'c'),
    R('e4', 'b', 'c'),
  ]
  return toMaps(nodes, relations)
}

/** Hub: one central service surrounded by 6 satellites + 1 db. */
function scenarioHub() {
  const sats = []
  for (let i = 0; i < 6; i++) sats.push(N(`s${i}`, 'container', `Svc ${i}`, 160, 80))
  const nodes = [
    N('hub', 'system', 'Gateway', 220, 100),
    ...sats,
    N('db', 'database', 'DB', 130, 80),
    N('user', 'person', 'User', 100, 70, { external: true }),
  ]
  const relations = [
    R('e0', 'user', 'hub'),
    ...sats.map((s, i) => R(`er${i}`, 'hub', s.id)),
    ...sats.slice(0, 3).map((s, i) => R(`ed${i}`, s.id, 'db')),
  ]
  return toMaps(nodes, relations)
}

/** Microservices: 2 systems, each 2 containers, each 2-3 components, cross-talk. */
function scenarioMicroservices() {
  const nodes = [
    N('frontend', 'system', 'Frontend', 0, 0),
    N('frontend.web', 'container', 'Web App', 200, 100, { parentId: 'frontend' }),
    N('frontend.bff', 'container', 'BFF', 200, 100, { parentId: 'frontend' }),

    N('backend', 'system', 'Backend', 0, 0),
    N('backend.api', 'container', 'API', 200, 100, { parentId: 'backend' }),
    N('backend.worker', 'container', 'Worker', 200, 100, { parentId: 'backend' }),
    N('backend.db', 'database', 'PG', 130, 80, { parentId: 'backend' }),
    N('backend.queue', 'queue', 'MQ', 130, 70, { parentId: 'backend' }),

    N('user', 'person', 'User', 100, 70, { external: true }),
    N('admin', 'person', 'Admin', 100, 70, { external: true }),
    N('stripe', 'system', 'Stripe', 140, 70, { external: true }),
  ]
  // Set sizes for the 2 root systems based on their would-be children (will be re-fitted by ELK).
  for (const n of nodes) if (n.type === 'system' && !n.external) { n.width = 460; n.height = 240 }
  const relations = [
    R('r1', 'user', 'frontend.web'),
    R('r2', 'admin', 'frontend.web'),
    R('r3', 'frontend.web', 'frontend.bff'),
    R('r4', 'frontend.bff', 'backend.api'),
    R('r5', 'backend.api', 'backend.db'),
    R('r6', 'backend.api', 'backend.queue'),
    R('r7', 'backend.queue', 'backend.worker'),
    R('r8', 'backend.worker', 'backend.db'),
    R('r9', 'backend.api', 'stripe'),
  ]
  return toMaps(nodes, relations)
}

function toMaps(nodes, relations) {
  const nMap = {}, rMap = {}
  for (const n of nodes) nMap[n.id] = n
  for (const r of relations) rMap[r.id] = r
  return { nodes: nMap, relations: rMap }
}

// ─── Geometry helpers (mirror smartLayout) ────────────────────────────────

function buildAbsCenters(nodes) {
  const memo = {}
  function abs(id) {
    if (memo[id]) return memo[id]
    const n = nodes[id]
    if (!n) return { x: 0, y: 0 }
    if (!n.parentId) memo[id] = { x: n.x, y: n.y }
    else {
      const p = abs(n.parentId)
      memo[id] = { x: p.x + n.x, y: p.y + n.y }
    }
    return memo[id]
  }
  const out = {}
  for (const n of Object.values(nodes)) {
    const a = abs(n.id)
    out[n.id] = { x: a.x, y: a.y, w: n.width, h: n.height,
                   cx: a.x + n.width / 2, cy: a.y + n.height / 2 }
  }
  return out
}

function applyPositions(nodes, positions) {
  const out = {}
  for (const [id, n] of Object.entries(nodes)) {
    const p = positions[id]
    out[id] = p ? { ...n, x: p.x, y: p.y, width: p.width ?? n.width, height: p.height ?? n.height } : { ...n }
  }
  return out
}

// ─── SVG renderer ─────────────────────────────────────────────────────────

const COLORS = {
  person:   { fill: '#1e6cb6', stroke: '#0c3d70', text: '#fff' },
  system:   { fill: '#2a78c7', stroke: '#155090', text: '#fff' },
  container:{ fill: '#3a8fde', stroke: '#1e5e9e', text: '#fff' },
  component:{ fill: '#7ab8e8', stroke: '#3a8fde', text: '#fff' },
  database: { fill: '#5fa8e3', stroke: '#2a78c7', text: '#fff' },
  queue:    { fill: '#5fa8e3', stroke: '#2a78c7', text: '#fff' },
  webapp:   { fill: '#3a8fde', stroke: '#1e5e9e', text: '#fff' },
  external: { fill: '#7d7d7d', stroke: '#444',    text: '#fff' },
}

function borderPoint(bx, by, w, h, side) {
  // side: 'left' | 'right' | 'top' | 'bottom' (matches reactflow Position string values)
  switch (side) {
    case 'left':   return { x: bx,         y: by + h / 2, nx: -1, ny: 0 }
    case 'right':  return { x: bx + w,     y: by + h / 2, nx:  1, ny: 0 }
    case 'top':    return { x: bx + w / 2, y: by,         nx:  0, ny: -1 }
    case 'bottom': return { x: bx + w / 2, y: by + h,     nx:  0, ny:  1 }
  }
}

function renderSVG(nodes, relations, scoreBreakdown, title) {
  const abs = buildAbsCenters(nodes)
  // Bbox.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const r of Object.values(abs)) {
    if (r.x < minX) minX = r.x
    if (r.y < minY) minY = r.y
    if (r.x + r.w > maxX) maxX = r.x + r.w
    if (r.y + r.h > maxY) maxY = r.y + r.h
  }
  const pad = 60
  const W = maxX - minX + pad * 2
  const H = maxY - minY + pad * 2 + 120 // extra at bottom for metrics
  const tx = -minX + pad, ty = -minY + pad

  // Sort nodes so parents render before children.
  const sorted = Object.values(nodes).slice().sort((a, b) => {
    const da = depthOf(nodes, a.id), db = depthOf(nodes, b.id)
    return da - db
  })

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" font-family="-apple-system,Segoe UI,sans-serif">
  <rect width="${W}" height="${H}" fill="#eef1f5"/>
  <g transform="translate(${tx},${ty})">`

  // Nodes.
  for (const n of sorted) {
    const a = abs[n.id]
    const isExternal = n.external
    const c = isExternal ? COLORS.external : (COLORS[n.type] ?? COLORS.system)
    const isCompound = n.type === 'system' || n.type === 'container'
    const radius = isCompound ? 8 : 6
    if (isCompound) {
      // Translucent compound
      svg += `\n    <rect x="${a.x}" y="${a.y}" width="${a.w}" height="${a.h}" rx="${radius}" ry="${radius}"
        fill="${c.fill}" fill-opacity="0.08" stroke="${c.stroke}" stroke-dasharray="4 3" stroke-width="1.5"/>`
      svg += `\n    <text x="${a.x + 10}" y="${a.y + 18}" font-size="11" fill="${c.stroke}" font-weight="600">${escapeXml(n.label)} [${n.type}]</text>`
    } else {
      svg += `\n    <rect x="${a.x}" y="${a.y}" width="${a.w}" height="${a.h}" rx="${radius}" ry="${radius}"
        fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.5"/>`
      svg += `\n    <text x="${a.x + a.w / 2}" y="${a.y + a.h / 2 + 4}" font-size="12" fill="${c.text}" text-anchor="middle" font-weight="600">${escapeXml(n.label)}</text>`
      svg += `\n    <text x="${a.x + a.w / 2}" y="${a.y + 14}" font-size="9" fill="${c.text}" text-anchor="middle" opacity="0.75">${(n.type || '').toUpperCase()}</text>`
    }
  }

  // Edges (cubic Bézier, mirrors smartLayout sample geometry).
  for (const e of Object.values(relations)) {
    const sn = abs[e.sourceId], tn = abs[e.targetId]
    if (!sn || !tn) continue
    const view = (n, id) => ({ id, positionAbsolute: { x: n.x, y: n.y }, width: n.w, height: n.h })
    const { sSide, tSide } = pickSides(view(sn, e.sourceId), view(tn, e.targetId))
    const sb = borderPoint(sn.x, sn.y, sn.w, sn.h, String(sSide))
    const tb = borderPoint(tn.x, tn.y, tn.w, tn.h, String(tSide))
    const dist = Math.hypot(tb.x - sb.x, tb.y - sb.y)
    const pull = Math.min(180, Math.max(40, dist * 0.5))
    const c1x = sb.x + sb.nx * pull, c1y = sb.y + sb.ny * pull
    const c2x = tb.x + tb.nx * pull, c2y = tb.y + tb.ny * pull
    const path = `M ${sb.x} ${sb.y} C ${c1x} ${c1y} ${c2x} ${c2y} ${tb.x} ${tb.y}`
    svg += `\n    <path d="${path}" fill="none" stroke="#444" stroke-width="1.2" opacity="0.75"/>`
    // Arrowhead
    const angle = Math.atan2(tb.y - c2y, tb.x - c2x)
    const ah = 7
    const ax1 = tb.x - ah * Math.cos(angle - 0.4)
    const ay1 = tb.y - ah * Math.sin(angle - 0.4)
    const ax2 = tb.x - ah * Math.cos(angle + 0.4)
    const ay2 = tb.y - ah * Math.sin(angle + 0.4)
    svg += `\n    <path d="M ${tb.x} ${tb.y} L ${ax1} ${ay1} L ${ax2} ${ay2} Z" fill="#444"/>`
  }

  svg += `\n  </g>`
  // Metrics footer.
  const lines = [
    `${title}`,
    `composite=${scoreBreakdown.composite.toFixed(1)} | rendCross=${scoreBreakdown.renderedCrossings} ovDraw=${scoreBreakdown.renderedOverdraws} stub=${scoreBreakdown.stubLoopPenalty.toFixed(2)}`,
    `overlap=${scoreBreakdown.nodeOverlap.toFixed(2)} eMean=${scoreBreakdown.edgeLengthMean.toFixed(2)} eMax=${scoreBreakdown.edgeLengthMax.toFixed(2)} leaf=${scoreBreakdown.leafCentrality.toFixed(2)}`,
    `aspect=${scoreBreakdown.aspectPenalty.toFixed(2)} compact=${scoreBreakdown.compactness.toFixed(2)} sym=${scoreBreakdown.symmetryDeficit.toFixed(2)}`,
  ]
  let fy = H - 100
  for (const ln of lines) {
    svg += `\n  <text x="20" y="${fy}" font-size="13" fill="#222" font-family="monospace">${escapeXml(ln)}</text>`
    fy += 18
  }
  svg += `\n</svg>`
  return svg
}

function depthOf(nodes, id) {
  let d = 0, cur = nodes[id]
  while (cur?.parentId) { d++; cur = nodes[cur.parentId] }
  return d
}

function escapeXml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]))
}

// ─── Run ──────────────────────────────────────────────────────────────────

const scenarios = [
  ['screenshot',     scenarioScreenshot()],
  ['chain',          scenarioChain()],
  ['hub',            scenarioHub()],
  ['microservices',  scenarioMicroservices()],
]

mkdirSync(here, { recursive: true })

for (const [name, scene] of scenarios) {
  const t0 = Date.now()
  const result = await runSmartLayout(scene.nodes, scene.relations)
  const dt = Date.now() - t0
  const projected = applyPositions(scene.nodes, result.winner.positions)
  const score = computeCompositeScore(projected, scene.relations)

  const title = `${name} | winner=${result.winner.name} | ${dt}ms | SA: ${result.refinement.before.toFixed(0)}→${result.refinement.after.toFixed(0)} (${result.refinement.iterations} iter) | planarity=${result.planarity.verdict} (${result.planarity.crossingEdges}/${result.planarity.totalEdges})`
  const svg = renderSVG(projected, scene.relations, score, title)
  const fp = resolve(here, `out-${name}.svg`)
  writeFileSync(fp, svg, 'utf8')
  console.log(`[${name}] ${dt}ms  composite=${score.composite.toFixed(1)}  rendCross=${score.renderedCrossings}  ovDraw=${score.renderedOverdraws}  eMax=${score.edgeLengthMax.toFixed(2)}  aspect=${score.aspectPenalty.toFixed(2)}  → ${fp}`)
}
