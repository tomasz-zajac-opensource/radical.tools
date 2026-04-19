/**
 * Standalone test: reproduce Cola layout behavior matching the smallgroups example.
 * Run: node tests/cola-oscillation-test.mjs
 *
 * Uses Layout.dragStart / drag / dragEnd (official API)
 * + substeps per frame (needed for large 280x180 nodes).
 */

import { Layout } from 'webcola'

const NODE_W = 280
const NODE_H = 180
const STABLE_THRESHOLD = 2  // px — same as liveColaLayout

console.log('=== Cola smallgroups-style tick loop (1 system + 3 containers) ===\n')

const colaNodes = [
  { c4id: 'ctn1', x: 30 + NODE_W / 2,  y: 60 + NODE_H / 2,  width: NODE_W, height: NODE_H },
  { c4id: 'ctn2', x: 280 + NODE_W / 2, y: 60 + NODE_H / 2,  width: NODE_W, height: NODE_H },
  { c4id: 'ctn3', x: 530 + NODE_W / 2, y: 60 + NODE_H / 2,  width: NODE_W, height: NODE_H },
]
const colaLinks = [
  { source: colaNodes[0], target: colaNodes[1] },
  { source: colaNodes[1], target: colaNodes[2] },
]
const colaGroups = [{ c4id: 'sys1', leaves: colaNodes, padding: 50 }]

const layout = new Layout()
layout
  .nodes(colaNodes)
  .links(colaLinks)
  .groups(colaGroups)
  .size([1800, 1200])
  .avoidOverlaps(true)
  .handleDisconnected(false)
  .linkDistance(350)
  .start(10, 5, 10, 0, false)

function formatPos() {
  const parts = []
  for (const cn of colaNodes) {
    parts.push(cn.c4id + ':(' + Math.round(cn.x - cn.width / 2) + ',' + Math.round(cn.y - cn.height / 2) + ')')
  }
  const bounds = colaGroups[0].bounds
  if (bounds) {
    parts.push('sys1:(' + Math.round(bounds.x) + ',' + Math.round(bounds.y) + ' ' + Math.round(bounds.X - bounds.x) + 'x' + Math.round(bounds.Y - bounds.y) + ')')
  }
  return parts.join('  ')
}

const SUBSTEPS_NORMAL = 3
const SUBSTEPS_DRAG = 5
let stableFrames = 0
let prevPos = new Map()
let grabbedId = null

function runFrame() {
  const substeps = grabbedId ? SUBSTEPS_DRAG : SUBSTEPS_NORMAL
  let converged = false
  for (let s = 0; s < substeps; s++) {
    converged = layout.tick()
    if (converged) break
  }
  let anyMoved = false
  for (const cn of colaNodes) {
    const prev = prevPos.get(cn.c4id)
    const rx = Math.round(cn.x), ry = Math.round(cn.y)
    if (!prev || Math.abs(rx - prev.x) > STABLE_THRESHOLD || Math.abs(ry - prev.y) > STABLE_THRESHOLD) anyMoved = true
    prevPos.set(cn.c4id, { x: rx, y: ry })
  }
  if (anyMoved) stableFrames = 0; else stableFrames++
  return converged
}

console.log('--- Phase 1: Initial settling ---')
for (let i = 1; i <= 200; i++) {
  const converged = runFrame()
  const alpha = layout._alpha
  if (i <= 10 || i % 20 === 0 || converged || stableFrames >= 5) {
    console.log('tick #' + String(i).padStart(3) + '  alpha=' + (alpha && alpha.toFixed ? alpha.toFixed(4).padStart(10) : String(alpha).padStart(10)) + '  converged=' + converged + '  stable=' + stableFrames + '  ' + formatPos())
  }
  if (converged) { console.log('Converged at tick ' + i); break }
  if (stableFrames >= 5) { console.log('Stable at tick ' + i); break }
}

console.log('\n--- Phase 2: Drag ctn1 (grab + 10 drag steps + release) ---')
const cn = colaNodes[0]
grabbedId = 'ctn1'
Layout.dragStart(cn)
cn.px = 200 + cn.width / 2
cn.py = 300 + cn.height / 2
layout.resume()

for (let step = 0; step < 10; step++) {
  Layout.drag(cn, { x: (200 + step * 30) + cn.width / 2, y: 300 + cn.height / 2 })
  layout.resume()
  runFrame()
  const alpha = layout._alpha
  console.log('drag step ' + step + '  alpha=' + (alpha && alpha.toFixed ? alpha.toFixed(4).padStart(10) : String(alpha).padStart(10)) + '  ' + formatPos())
}

Layout.dragEnd(cn)
grabbedId = null
stableFrames = 0
prevPos.clear()

console.log('\n--- Phase 3: After release ---')
for (let i = 1; i <= 200; i++) {
  const converged = runFrame()
  const alpha = layout._alpha
  if (i <= 10 || i % 20 === 0 || converged || stableFrames >= 5) {
    console.log('tick #' + String(i).padStart(3) + '  alpha=' + (alpha && alpha.toFixed ? alpha.toFixed(4).padStart(10) : String(alpha).padStart(10)) + '  converged=' + converged + '  stable=' + stableFrames + '  ' + formatPos())
  }
  if (converged) { console.log('Converged at tick ' + i); break }
  if (stableFrames >= 5) { console.log('Stable at tick ' + i); break }
}

console.log('\n=== Done ===')
