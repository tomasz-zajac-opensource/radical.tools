/**
 * Standalone test: verify d3adaptor works identically to the smallgroups example.
 * Run: node tests/d3adaptor-test.mjs
 *
 * Uses the exact same pattern as the reference:
 *   https://ialab.it.monash.edu/webcola/examples/smallgroups.html
 */

import { d3adaptor, Layout } from 'webcola'
import { dispatch } from 'd3-dispatch'
import { timer } from 'd3-timer'
import { drag as d3drag } from 'd3-drag'

// Exactly the same data as the reference example
const graph = {
  nodes: [
    { name: 'a', width: 60, height: 40 },
    { name: 'b', width: 60, height: 40 },
    { name: 'c', width: 60, height: 40 },
    { name: 'd', width: 60, height: 40 },
    { name: 'e', width: 60, height: 40 },
    { name: 'f', width: 60, height: 40 },
    { name: 'g', width: 60, height: 40 },
  ],
  links: [
    { source: 1, target: 2 },
    { source: 2, target: 3 },
    { source: 3, target: 4 },
    { source: 0, target: 1 },
    { source: 2, target: 0 },
    { source: 3, target: 5 },
    { source: 0, target: 5 },
  ],
  groups: [
    { leaves: [0], groups: [1] },
    { leaves: [1, 2] },
    { leaves: [3, 4] },
  ],
}

// Create d3 context exactly as liveColaLayout does
const d3Context = { dispatch, timer, drag: d3drag, event: null }

console.log('=== d3adaptor smallgroups test ===\n')

// Exactly the same setup as the reference
const cola = d3adaptor(d3Context)
cola
  .linkDistance(100)
  .avoidOverlaps(true)
  .handleDisconnected(false)
  .size([960, 500])

let tickCount = 0
let endCalled = false

// NOTE: d3-dispatch v3 passes event as `this`, not as first arg.
// webcola d3v4adaptor was written for d3-dispatch v1 where event was first arg.
// Use regular functions to access `this` (the event data).

cola.on('start', function () {
  console.log('EVENT: start  alpha=' + this.alpha)
})

cola.on('tick', function () {
  tickCount++
  if (tickCount <= 5 || tickCount % 20 === 0) {
    const positions = graph.nodes.map(
      (n) =>
        n.name +
        ':(' +
        Math.round(n.x) +
        ',' +
        Math.round(n.y) +
        ')'
    )
    console.log(
      'tick #' + String(tickCount).padStart(3) + '  alpha=' + (this.alpha?.toFixed?.(6) ?? this.alpha) + '  stress=' + (this.stress?.toFixed?.(2) ?? this.stress) + '  ' + positions.join(' ')
    )
  }
})

cola.on('end', function () {
  endCalled = true
  const positions = graph.nodes.map(
    (n) =>
      n.name +
      ':(' +
      Math.round(n.x) +
      ',' +
      Math.round(n.y) +
      ')'
  )
  console.log(
    '\nEVENT: end after ' + tickCount + ' ticks  stress=' + (this.stress?.toFixed?.(2) ?? this.stress)
  )
  console.log('Final positions: ' + positions.join(' '))

  // Show group bounds
  for (let i = 0; i < graph.groups.length; i++) {
    const g = graph.groups[i]
    const b = g.bounds
    if (b) {
      console.log(
        'Group ' + i + ' bounds: (' +
        Math.round(b.x) + ',' + Math.round(b.y) + ') ' +
        Math.round(b.X - b.x) + 'x' + Math.round(b.Y - b.y)
      )
    }
  }

  console.log('\n--- Phase 2: Simulate drag of node 0 ---')
  simulateDrag()
})

// Start — exactly like the reference: .start() with no arguments
cola.nodes(graph.nodes).links(graph.links).groups(graph.groups).start()

console.log('start() called, waiting for simulation...\n')

// Timeout to show results if simulation doesn't converge
setTimeout(() => {
  if (!endCalled) {
    console.log('\nTIMEOUT: ' + tickCount + ' ticks, simulation still running')
    const positions = graph.nodes.map(
      (n) => n.name + ':(' + Math.round(n.x) + ',' + Math.round(n.y) + ')'
    )
    console.log('Positions: ' + positions.join(' '))
  }
}, 10000)

function simulateDrag() {
  const node = graph.nodes[0]
  tickCount = 0

  // Exactly what cola.drag does internally:
  Layout.dragStart(node)
  node.px = node.x
  node.py = node.y

  // Move the node
  const targetX = 200
  const targetY = 100

  Layout.drag(node, { x: targetX, y: targetY })
  cola.resume()

  console.log('Dragged node 0 to (' + targetX + ',' + targetY + ')')

  // Wait for simulation to settle
  setTimeout(() => {
    Layout.dragEnd(node)
    console.log(
      'Released. Ticks during drag: ' + tickCount
    )
    const positions = graph.nodes.map(
      (n) =>
        n.name +
        ':(' +
        Math.round(n.x) +
        ',' +
        Math.round(n.y) +
        ')'
    )
    console.log('Positions after drag: ' + positions.join(' '))
    console.log('\n=== DONE ===')
    process.exit(0)
  }, 3000)
}
