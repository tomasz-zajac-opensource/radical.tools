/**
 * Public entry point for Smart Layout.
 *
 * Kept in a **separate module** from smartLayout.ts intentionally:
 * smartLayout.worker.ts imports runSmartLayoutCore from smartLayout.ts.
 * If the ?worker import lived in smartLayout.ts, Vite would bundle it into
 * the worker chunk → the worker would try to import itself → circular error.
 *
 * By isolating the ?worker import here, the worker bundle only includes
 * smartLayout.ts (computation) and never references this file.
 */

import type { C4Node, C4Relation } from '../types/c4'
import type { Metamodel } from '../types/metamodel'
import { runSmartLayoutCore, runSmartLayoutELKPhase, type SmartLayoutResult } from './smartLayout'
// Vite ?worker import — processed at build time into a separate worker chunk.
// Static top-level import is required for Vite's worker plugin to detect it.
import SmartLayoutWorkerClass from './smartLayout.worker?worker'

/**
 * Runs the layout in a dedicated Web Worker so the renderer thread stays
 * fully responsive during the computation (typically 800–1200 ms on large
 * diagrams).
 *
 * Protocol (split across main thread / worker):
 *   1. Main thread: ELK candidate generation (elk-worker.min.js cannot run
 *      inside a nested worker, so this must stay on the main thread).
 *   2. Worker: SA refinement phases A / B / C — CPU-intensive, off-thread.
 *
 * Falls back to `runSmartLayoutCore` in-thread when the Worker API is not
 * available (Node.js / Vitest).
 */
export async function runSmartLayout(
  nodes: Record<string, C4Node>,
  relations: Record<string, C4Relation>,
  metamodel?: Metamodel,
): Promise<SmartLayoutResult> {
  // Node / Vitest — no Worker API, fall back to direct in-thread call.
  if (typeof Worker === 'undefined') {
    return runSmartLayoutCore(nodes, relations, metamodel)
  }

  // Phase 1: ELK candidate generation on the main thread.
  const elkResult = await runSmartLayoutELKPhase(nodes, relations, metamodel)
  if (elkResult.done) {
    // All candidates failed — return the baseline result immediately.
    return elkResult.result
  }

  const { valid, rootIds, baseline } = elkResult

  // Phase 2: SA refinement in the worker.
  return new Promise<SmartLayoutResult>((resolve, reject) => {
    const worker = new SmartLayoutWorkerClass()

    worker.onmessage = (e: MessageEvent<{ type: 'result'; result: SmartLayoutResult } | { type: 'error'; message: string }>) => {
      worker.terminate()
      if (e.data.type === 'result') {
        resolve(e.data.result)
      } else {
        reject(new Error(e.data.message))
      }
    }

    worker.onerror = (e: ErrorEvent) => {
      worker.terminate()
      reject(new Error(e.message ?? 'smartLayout worker error'))
    }

    worker.postMessage({ nodes, relations, valid, rootIds, baseline })
  })
}
