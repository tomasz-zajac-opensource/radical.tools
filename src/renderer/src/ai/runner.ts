// ─── High-level orchestrator: prompt → patch → store ───────────────────────
//
// We run the model, apply its patch, and — if the apply pass surfaced any
// per-op errors (typically metamodel rejections or unresolved ids) — feed
// the failures back to the model and ask it for a corrective patch. Up to
// `maxRetries` extra round-trips. Each round operates on the *current*
// diagram state (after the previous partial-apply succeeded), so retries
// can build on what already worked.

import { applyPatch, validatePatch, type ApplyReport, type DiagramFacade } from './applyPatch'
import { formatModelQueryResults, runModelQuery } from './queryLanguage'
import { getAdapter } from './registry'
import { buildMessages, extractJsonObject } from './systemPrompt'
import type { AIQueryModelOp, AISettings, ChatMessage } from './types'

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
  /** Maximum local query rounds before forcing a final answer. Default: 3. */
  maxQueryRounds?: number
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

const QUERY_RESULTS_PROMPT_PREFIX = `You asked the built-in local model query engine to inspect the CURRENT diagram.
The results are below. Continue solving the ORIGINAL user request.

Rules:
  - If you now have enough information, return the final JSON object.
  - If you still need more exact data, you may return ONLY query_model ops again.
  - Do NOT mix query_model ops with mutation ops in the same response.

Query results:
`

const QUERY_ERROR_PROMPT_PREFIX = `Your previous query_model request could not be executed.
Return ONLY valid query_model ops, or the final JSON object if you no longer
need the query.

Errors:
`

function mergeReports(into: ApplyReport, more: ApplyReport): void {
  into.added.nodes += more.added.nodes
  into.added.relations += more.added.relations
  into.added.views += more.added.views
  into.updated.nodes += more.updated.nodes
  into.updated.views += more.updated.views
  into.deleted.nodes += more.deleted.nodes
  into.deleted.relations += more.deleted.relations
  into.deleted.views += more.deleted.views
  if (more.focusNodeId !== undefined) into.focusNodeId = more.focusNodeId
  // Errors are scoped to "still failing after retries"; replace each round
  // so the UI doesn't show the same problem multiple times.
  into.errors = more.errors.slice()
}

export async function runAIPrompt(opts: RunAIOptions): Promise<RunAIResult> {
  const { settings, prompt, diagram, history = [], signal } = opts
  const maxRetries = opts.maxRetries ?? 2
  const maxQueryRounds = opts.maxQueryRounds ?? 3
  const cfg = settings.providers[settings.active]
  const adapter = getAdapter(settings.active)
  const model = cfg.model || adapter.defaultModel

  // Working transcript for THIS run — we keep appending the assistant turns
  // and corrective user turns so the model sees the whole back-and-forth
  // (without polluting the caller's `history` outside this run).
  const turns: ChatMessage[] = []

  const combined: ApplyReport = {
    added: { nodes: 0, relations: 0, views: 0 },
    updated: { nodes: 0, views: 0 },
    deleted: { nodes: 0, relations: 0, views: 0 },
    errors: [],
  }

  let lastSummary: string | undefined
  let lastRaw = ''
  let retries = 0
  let queryRounds = 0
  let nextUserPrompt = prompt

  while (true) {
    if (signal?.aborted) throw new Error('Aborted')

    const messages = buildMessages(
      nextUserPrompt,
      // Re-read state every round so the model sees the partial application.
      diagram.getNodes(),
      diagram.getRelations(),
      [...history, ...turns],
      diagram.getMetamodel?.(),
      diagram.getActiveView?.() ?? null,
      diagram.getViews?.(),
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
      const mm = diagram.getMetamodel?.()
      const knownTypes = mm ? new Set(Object.keys(mm.nodeTypes)) : undefined
      patch = validatePatch(extractJsonObject(res.content), { knownTypes })
    } catch (err) {
      // Parse/validate failure. Instead of giving up, feed the error back
      // to the model so it can correct the malformed op (most often: an
      // unknown node type because the user has a custom metamodel).
      const msg = (err as Error).message
      if (retries >= maxRetries) {
        combined.errors.push(`Patch parse failed: ${msg}`)
        break
      }
      retries++
      nextUserPrompt =
        `Your previous response could not be parsed as a valid patch. The\n` +
        `error was:\n  ${msg}\n\nReturn ONLY the JSON patch object, with all\n` +
        `operations using node types listed in the metamodel above. No prose,\n` +
        `no Markdown fences.`
      continue
    }

    const queryOps = patch.operations.filter((op): op is AIQueryModelOp => op.op === 'query_model')
    if (queryOps.length > 0) {
      if (queryOps.length !== patch.operations.length) {
        if (queryRounds >= maxQueryRounds) {
          combined.errors.push('query_model cannot be mixed with mutation ops, and the query round limit was exceeded')
          break
        }
        queryRounds++
        nextUserPrompt =
          'Your previous response mixed query_model with non-query operations. ' +
          'Return ONLY query_model ops to inspect the model first, OR return the final JSON object.'
        continue
      }

      if (queryRounds >= maxQueryRounds) {
        combined.errors.push('Maximum query_model rounds exceeded before reaching a final answer')
        break
      }

      const queryErrors: string[] = []
      const queryResults = queryOps.flatMap((op, index) => {
        try {
          return [runModelQuery(op.query, {
            nodes: diagram.getNodes(),
            relations: diagram.getRelations(),
            views: diagram.getViews?.(),
          })]
        } catch (err) {
          queryErrors.push(`Query #${index + 1} (${op.query}): ${(err as Error).message}`)
          return []
        }
      })

      queryRounds++
      nextUserPrompt = queryErrors.length > 0
        ? QUERY_ERROR_PROMPT_PREFIX + queryErrors.map((e) => `  - ${e}`).join('\n')
        : QUERY_RESULTS_PROMPT_PREFIX + '```json\n' + formatModelQueryResults(queryResults) + '\n```'
      continue
    }

    if (patch.summary) lastSummary = patch.summary

    const roundReport = applyPatch(patch, diagram)
    mergeReports(combined, roundReport)

    if (roundReport.errors.length === 0) {
      // Clean round → done.
      break
    }

    if (retries >= maxRetries) {
      // Out of retries; return whatever we have plus the remaining errors.
      break
    }

    // Build the corrective prompt for the next round.
    retries++
    nextUserPrompt = RETRY_PROMPT_PREFIX + roundReport.errors.map((e) => `  - ${e}`).join('\n')
  }

  return { summary: lastSummary, report: combined, raw: lastRaw, retries }
}
