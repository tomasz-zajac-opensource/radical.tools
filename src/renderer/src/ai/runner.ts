// ─── High-level orchestrator: prompt → patch → store ───────────────────────

import { applyPatch, validatePatch, type ApplyReport, type DiagramFacade } from './applyPatch'
import { getAdapter } from './registry'
import { buildMessages, extractJsonObject } from './systemPrompt'
import type { AISettings, ChatMessage } from './types'

export interface RunAIResult {
  summary?: string
  report: ApplyReport
  /** Raw assistant content — useful for debugging. */
  raw: string
}

export interface RunAIOptions {
  prompt: string
  settings: AISettings
  diagram: DiagramFacade
  history?: ChatMessage[]
  signal?: AbortSignal
}

export async function runAIPrompt(opts: RunAIOptions): Promise<RunAIResult> {
  const { settings, prompt, diagram, history, signal } = opts
  const cfg = settings.providers[settings.active]
  const adapter = getAdapter(settings.active)
  const model = cfg.model || adapter.defaultModel

  const messages = buildMessages(prompt, diagram.getNodes(), diagram.getRelations(), history)
  const res = await adapter.chat(
    { model, messages, jsonMode: true, temperature: 0.2, signal },
    cfg,
  )
  const parsed = extractJsonObject(res.content)
  const patch = validatePatch(parsed)
  const report = applyPatch(patch, diagram)
  return { summary: patch.summary, report, raw: res.content }
}
