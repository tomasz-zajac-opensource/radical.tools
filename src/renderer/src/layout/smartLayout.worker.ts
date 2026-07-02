/**
 * Web Worker entry point for Smart Layout — SA refinement only.
 *
 * The ELK candidate generation phase runs on the main thread (elk-worker.min.js
 * is itself a web-worker script and cannot be imported inside another worker).
 * This worker receives the pre-ranked ELK candidates and runs the CPU-intensive
 * SA refinement phases A / B / C off the main thread.
 *
 * Protocol
 * ─────────
 * Main → Worker  { nodes, relations, valid, rootIds, baseline }
 * Worker → Main  { type: 'result', result: SmartLayoutResult }
 *              | { type: 'error',  message: string }
 */

import { runSmartLayoutSAPhase, type SmartLayoutResult, type SmartLayoutCandidate } from './smartLayout'
import type { C4Node, C4Relation } from '../types/c4'
import type { LayoutMetrics } from './crossingOpt'

self.onmessage = async (e: MessageEvent) => {
  const { nodes, relations, valid, rootIds, baseline } = e.data as {
    nodes: Record<string, C4Node>
    relations: Record<string, C4Relation>
    valid: SmartLayoutCandidate[]
    rootIds: string[]
    baseline: LayoutMetrics
  }
  try {
    const result: SmartLayoutResult = await runSmartLayoutSAPhase(nodes, relations, valid, rootIds, baseline)
    self.postMessage({ type: 'result', result })
  } catch (err) {
    self.postMessage({ type: 'error', message: String(err) })
  }
}
