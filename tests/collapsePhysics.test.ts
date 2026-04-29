/**
 * Verify that the live cola physics keeps running after a node is collapsed.
 *
 * Reproduces the workflow:
 *   1. start live layout against a small model (parent + 2 children)
 *   2. wait for the d3.timer to tick at least once → applyPositions called
 *   3. flip parent.collapsed = true and call invalidate()
 *   4. wait for more ticks → applyPositions must be called again with the
 *      collapsed-size parent (= COLLAPSED_WIDTH/HEIGHT)
 *
 * If physics dies on collapse, step 4 never produces fresh emissions.
 */
import { describe, it, expect } from 'vitest'
import { LiveColaLayout } from '../src/renderer/src/layout/liveColaLayout'
import type { C4Node, C4Relation } from '../src/renderer/src/types/c4'
import { NODE_SIZES } from '../src/renderer/src/types/c4'

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

describe('Live layout physics survives a collapse', () => {
  it('continues to emit positions after invalidate triggered by collapse', async () => {
    const nodes: Record<string, C4Node> = {
      sys: {
        id: 'sys', type: 'system', label: 'Sys', collapsed: false,
        x: 100, y: 100, width: 600, height: 400,
      } as any,
      a: {
        id: 'a', type: 'container', label: 'A', collapsed: false, parentId: 'sys',
        x: 40, y: 60, ...NODE_SIZES.container,
      } as any,
      b: {
        id: 'b', type: 'container', label: 'B', collapsed: false, parentId: 'sys',
        x: 320, y: 60, ...NODE_SIZES.container,
      } as any,
      ext: {
        id: 'ext', type: 'system', label: 'Ext', collapsed: false, external: true,
        x: 800, y: 100, ...NODE_SIZES.system,
      } as any,
    }
    const relations: Record<string, C4Relation> = {
      r1: { id: 'r1', sourceId: 'a', targetId: 'b', label: '' } as any,
      r2: { id: 'r2', sourceId: 'b', targetId: 'ext', label: '' } as any,
    }

    let emissionCount = 0
    let lastEmission: Record<string, { x: number; y: number; width?: number; height?: number }> = {}

    const layout = new LiveColaLayout({
      getModel: () => ({ nodes, relations }),
      applyPositions: (positions) => {
        emissionCount++
        lastEmission = positions
        for (const [id, pos] of Object.entries(positions)) {
          const n = nodes[id]
          if (n) {
            n.x = pos.x
            n.y = pos.y
            if (pos.width != null) n.width = pos.width
            if (pos.height != null) n.height = pos.height
          }
        }
      },
    })

    layout.start()
    expect(layout.running).toBe(true)

    // Let physics tick a few frames
    await wait(120)
    const beforeCount = emissionCount
    expect(beforeCount).toBeGreaterThan(0)

    // Collapse the parent system + invalidate
    nodes.sys.collapsed = true
    layout.invalidate()

    // Layout must still be running after invalidate
    expect(layout.running).toBe(true)

    // Wait for further ticks
    await wait(200)
    const afterCount = emissionCount

    expect(afterCount).toBeGreaterThan(beforeCount)

    // Once collapsed, the parent ('sys') is a leaf cola node again, so
    // emitPositions reports {x, y} for it (no width/height — leaf path).
    // Children become hidden (parent collapsed) → not present in emission.
    expect(lastEmission.sys).toBeTruthy()
    expect(lastEmission.a).toBeUndefined()
    expect(lastEmission.b).toBeUndefined()
    // External system still present
    expect(lastEmission.ext).toBeTruthy()

    layout.stop()
    expect(layout.running).toBe(false)
  })

  it('expanding a collapsed node also keeps physics alive', async () => {
    const nodes: Record<string, C4Node> = {
      sys: {
        id: 'sys', type: 'system', label: 'Sys', collapsed: true,
        x: 100, y: 100, ...NODE_SIZES.system,
      } as any,
      a: {
        id: 'a', type: 'container', label: 'A', collapsed: false, parentId: 'sys',
        x: 40, y: 60, ...NODE_SIZES.container,
      } as any,
      ext: {
        id: 'ext', type: 'person', label: 'User', collapsed: false,
        x: 600, y: 100, ...NODE_SIZES.person,
      } as any,
    }
    const relations: Record<string, C4Relation> = {
      r1: { id: 'r1', sourceId: 'sys', targetId: 'ext', label: '' } as any,
    }

    let emissionCount = 0
    const layout = new LiveColaLayout({
      getModel: () => ({ nodes, relations }),
      applyPositions: (positions) => {
        emissionCount++
        for (const [id, pos] of Object.entries(positions)) {
          const n = nodes[id]
          if (n) {
            n.x = pos.x
            n.y = pos.y
            if (pos.width != null) n.width = pos.width
            if (pos.height != null) n.height = pos.height
          }
        }
      },
    })

    layout.start()
    await wait(120)
    const before = emissionCount
    expect(before).toBeGreaterThan(0)

    // Expand
    nodes.sys.collapsed = false
    layout.invalidate()
    expect(layout.running).toBe(true)

    await wait(200)
    expect(emissionCount).toBeGreaterThan(before)

    layout.stop()
  })
})
