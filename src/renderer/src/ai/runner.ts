// ─── High-level orchestrator: prompt → patch → store ───────────────────────
//
// We run the model, apply its patch, and — if the apply pass surfaced any
// per-op errors (typically metamodel rejections or unresolved ids) — feed
// the failures back to the model and ask it for a corrective patch. Up to
// `maxRetries` extra round-trips. Each round operates on the *current*
// diagram state (after the previous partial-apply succeeded), so retries
// can build on what already worked.

import { applyPatch, validatePatch, type ApplyReport, type DiagramFacade } from './applyPatch'
import { getAdapter } from './registry'
import { buildMessages, extractJsonObject } from './systemPrompt'
import type { AISettings, ChatMessage } from './types'

export interface RunAIResult {
  summary?: string
  /** Combined report aggregated across the initial pass + any retries. */
  report: ApplyReport
  /** Raw assistant content from the last round — useful for debugging. */
  raw: string
  /** How many corrective rounds were attempted (0 if the first pass was clean). */
  retries: number
}

export interface RunAIOptions {
  prompt: string
  settings: AISettings
  diagram: DiagramFacade
  history?: ChatMessage[]
  signal?: AbortSignal
  /** Maximum corrective rounds after the initial attempt. Default: 2. */
  maxRetries?: number
}

const RETRY_PROMPT_PREFIX = `Your previous patch was applied PARTIALLY. Some operations were rejected
by the diagram store (typically because they violated the metamodel) or
referenced ids that did not resolve. The current diagram state above
already includes whatever DID succeed. Produce a corrective JSON patch
that:

  - does NOT repeat the operations that already succeeded,
  - fixes the rejected ones (e.g. add the required parent first and use
    its tempId; pick a valid type; respect cardinality),
  - returns ONLY the same JSON shape as before — no prose.

Errors from the previous attempt:
`

function mergeReports(into: ApplyReport, more: ApplyReport): void {
  into.added.nodes += more.added.nodes
  into.added.relations += more.added.relations
  into.updated.nodes += more.updated.nodes
  into.deleted.nodes += more.deleted.nodes
  into.deleted.relations += more.deleted.relations
  // Errors are scoped to "still failing after retries"; replace each round
  // so the UI doesn't show the same problem multiple times.
  into.errors = more.errors.slice()
}

export async function runAIPrompt(opts: RunAIOptions): Promise<RunAIResult> {
  const { settings, prompt, diagram, history = [], signal } = opts
  const maxRetries = opts.maxRetries ?? 2
  const cfg = settings.providers[settings.active]
  const adapter = getAdapter(settings.active)
  const model = cfg.model || adapter.defaultModel

  // Working transcript for THIS run — we keep appending the assistant turns
  // and corrective user turns so the model sees the whole back-and-forth
  // (without polluting the caller's `history` outside this run).
  const turns: ChatMessage[] = []

  const combined: ApplyReport = {
    added: { nodes: 0, relations: 0 },
    updated: { nodes: 0 },
    deleted: { nodes: 0, relations: 0 },
    errors: [],
  }

  let lastSummary: string | undefined
  let lastRaw = ''
  let retries = 0
  let nextUserPrompt = prompt

  for (let round = 0; round <= maxRetries; round++) {
    if (signal?.aborted) throw new Error('Aborted')

    const messages = buildMessages(
      nextUserPrompt,
      // Re-read state every round so the model sees the partial application.
      diagram.getNodes(),
      diagram.getRelations(),
      [...history, ...turns],
      diagram.getMetamodel?.(),
      diagram.getActiveView?.() ?? null,
    )

    const res = await adapter.chat(
      { model, messages, jsonMode: true, temperature: 0.2, signal },
      cfg,
    )
    lastRaw = res.content

    // Record this round in the running transcript so the next corrective
    // turn sees what the model said.
    turns.push({ role: 'user', content: nextUserPrompt })
    turns.push({ role: 'assistant', content: res.content })

    let patch
    try {
      patch = validatePatch(extractJsonObject(res.content))
    } catch (err) {
      // Parse/validate failure — surface and stop. We don't try to retry
      // malformed JSON; jsonMode + the system prompt already do the lifting.
      combined.errors.push(`Patch parse failed: ${(err as Error).message}`)
      break
    }

    if (patch.summary) lastSummary = patch.summary

    const roundReport = applyPatch(patch, diagram)
    mergeReports(combined, roundReport)

    if (roundReport.errors.length === 0) {
      // Clean round → done.
      break
    }

    if (round === maxRetries) {
      // Out of retries; return whatever we have plus the remaining errors.
      break
    }

    // Build the corrective prompt for the next round.
    retries++
    nextUserPrompt = RETRY_PROMPT_PREFIX + roundReport.errors.map((e) => `  - ${e}`).join('\n')
  }

  return { summary: lastSummary, report: combined, raw: lastRaw, retries }
}
