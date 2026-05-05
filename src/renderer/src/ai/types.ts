// ─── AI integration: shared types ───────────────────────────────────────────

import type { C4ElementType } from '../types/c4'

export type AIProviderId = 'ollama' | 'openai' | 'anthropic' | 'gemini'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChatRequest {
  /** Provider-specific model name. e.g. "llama3.1", "gpt-4o-mini", "claude-3-5-sonnet-20241022", "gemini-1.5-flash" */
  model: string
  messages: ChatMessage[]
  /** If true, ask the provider to return strict JSON. Best-effort per-provider. */
  jsonMode?: boolean
  /** Max tokens for the response. */
  maxTokens?: number
  /** Sampling temperature, 0..1. */
  temperature?: number
  /** Abort signal for cancellation. */
  signal?: AbortSignal
}

export interface ChatResponse {
  /** Raw assistant text content. */
  content: string
  /** Provider-reported model name (if available). */
  model?: string
}

/** Provider configuration entry stored in settings. */
export interface ProviderConfig {
  /** API key (not used for Ollama). */
  apiKey?: string
  /** Base URL override. Defaults to provider-default if empty. */
  baseUrl?: string
  /** Default model name to use for this provider. */
  model?: string
}

export interface AISettings {
  /** Master enable/disable switch for the whole AI feature. When false,
   *  the AI UI (Quick Search ✨ toggle, Ask-AI shortcuts, etc.) stays
   *  hidden even if a provider is fully configured. */
  enabled: boolean
  /** Currently active provider. */
  active: AIProviderId
  providers: Record<AIProviderId, ProviderConfig>
}

/** Function signature implemented by every provider adapter. */
export type ChatFn = (req: ChatRequest, cfg: ProviderConfig) => Promise<ChatResponse>

export interface ProviderAdapter {
  id: AIProviderId
  label: string
  /** Human-friendly default model (used as a hint in the UI). */
  defaultModel: string
  /** Default base URL — providers may ignore if hard-coded. */
  defaultBaseUrl?: string
  chat: ChatFn
}

// ─── Patch operations the model applies to the diagram ─────────────────────

/**
 * AddNode — `tempId` is a model-provided identifier so subsequent operations
 * (relations, child nodes via parentId) can reference this newly created node
 * before a real id has been assigned by the store.
 */
export interface AIAddNodeOp {
  op: 'add_node'
  tempId: string
  type: C4ElementType | string
  label: string
  description?: string
  technology?: string
  /** Either an existing real node id or a tempId from a previous op in the same patch. */
  parentId?: string | null
  external?: boolean
}

export interface AIAddRelationOp {
  op: 'add_relation'
  /** sourceId / targetId may reference a real id or a tempId from the same patch. */
  sourceId: string
  targetId: string
  label?: string
  technology?: string
}

export interface AIUpdateNodeOp {
  op: 'update_node'
  id: string
  label?: string
  description?: string
  technology?: string
  external?: boolean
  type?: C4ElementType | string
}

export interface AIDeleteNodeOp {
  op: 'delete_node'
  id: string
}

export interface AIDeleteRelationOp {
  op: 'delete_relation'
  id: string
}

// ─── Views ────────────────────────────────────────────────────────────────

/** Create a new view. `tempId` lets later ops (set_active_view, set_view_nodes)
 *  reference it before a real id is assigned. nodeIds may include node tempIds
 *  produced by `add_node` ops earlier in the same patch. */
export interface AIAddViewOp {
  op: 'add_view'
  tempId: string
  name: string
  nodeIds?: string[]
  /** Switch to this view immediately after creation. */
  active?: boolean
}

/** Replace the entire visible-node set of an existing view. */
export interface AISetViewNodesOp {
  op: 'set_view_nodes'
  /** Real id or tempId from an `add_view` earlier in the same patch. */
  id: string
  nodeIds: string[]
}

export interface AIDeleteViewOp {
  op: 'delete_view'
  id: string
}

export interface AISetActiveViewOp {
  op: 'set_active_view'
  /** Real id, tempId from same patch, or null to clear the active view. */
  id: string | null
}

/** Pan + zoom the canvas to a specific node after all other ops are applied. */
export interface AIFocusNodeOp {
  op: 'focus_node'
  /** Real node id or tempId from an earlier add_node in the same patch. */
  id: string
}

/**
 * Clear the entire diagram (all nodes, relations and views) before the
 * remaining ops in this patch run. Use when creating a model from scratch
 * so old content does not bleed into the new architecture.
 * This op MUST appear first in the operations array.
 */
export interface AIResetDiagramOp {
  op: 'reset_diagram'
}

/**
 * Ask the built-in local query engine to inspect the CURRENT model structure.
 * The runner executes these ops before any mutation ops and feeds the results
 * back to the model in a follow-up round.
 */
export interface AIQueryModelOp {
  op: 'query_model'
  query: string
}

export type AIPatchOp =
  | AIAddNodeOp
  | AIAddRelationOp
  | AIUpdateNodeOp
  | AIDeleteNodeOp
  | AIDeleteRelationOp
  | AIAddViewOp
  | AISetViewNodesOp
  | AIDeleteViewOp
  | AISetActiveViewOp
  | AIFocusNodeOp
  | AIResetDiagramOp
  | AIQueryModelOp

export interface AIPatch {
  operations: AIPatchOp[]
  /** Optional human-readable summary the assistant returns. */
  summary?: string
}
