import { create } from 'zustand'

// ─── Hub concept shape (mirrors hub-data.json) ──────────────────────────────

/** A single parameter that must be filled in before a hub concept is imported. */
export interface TemplateParam {
  key: string
  label: string
  hint?: string
  type?: 'text' | 'number'
  defaultValue?: string
}

/**
 * Persisted record of a hub concept import that used template parameters.
 * Stored in the diagram so the user can reconfigure values later.
 */
export interface HubImportRecord {
  conceptId: string
  conceptName: string
  templateParams: TemplateParam[]
  /** Current substitution values (may change on reconfigure). */
  paramValues: Record<string, string>
  /** New node IDs (UUIDs) that were created by this import. */
  nodeIds: string[]
  /**
   * Original template nodes keyed by new node UUID.
   * Contains the {{TOKEN}} placeholders before substitution.
   * Positions (x/y/width/height) are excluded — they are user-managed.
   */
  originalNodes: Record<string, Record<string, unknown>>
}

export interface HubConcept {
  id: string
  category: 'pattern' | 'fitness-function' | 'requirement' | 'adr'
  name: string
  description: string
  tags: string[]
  requiredMetamodel?: string
  /** Parameters the user must fill in before import; values are substituted
   *  into node fields using {{KEY}} syntax. */
  templateParams?: TemplateParam[]
  nodes: Array<Record<string, unknown>>
  relations?: Array<Record<string, unknown>>
}

// ─── Store types ────────────────────────────────────────────────────────────

interface HubState {
  concepts: HubConcept[]
  loading: boolean
  error: string | null
  lastFetched: number | null

  // Filters
  activeCategory: string | null
  searchQuery: string
  activeTag: string | null

  // Actions
  fetchConcepts: () => Promise<void>
  setCategory: (cat: string | null) => void
  setSearch: (q: string) => void
  setTag: (tag: string | null) => void
  resetFilters: () => void

  // Computed-like
  filteredConcepts: () => HubConcept[]
  allTags: () => Array<{ tag: string; count: number }>
}

// ─── Constants ──────────────────────────────────────────────────────────────

const HUB_URL = 'https://hub.radical.tools/hub-data.json'
const FALLBACK_URL = '/hub-data.json'
const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

// ─── Store ──────────────────────────────────────────────────────────────────

export const useHubStore = create<HubState>()((set, get) => ({
  concepts: [],
  loading: false,
  error: null,
  lastFetched: null,

  activeCategory: null,
  searchQuery: '',
  activeTag: null,

  async fetchConcepts() {
    const { lastFetched, loading } = get()
    if (loading) return
    if (lastFetched && Date.now() - lastFetched < CACHE_TTL_MS) return

    set({ loading: true, error: null })
    try {
      let res: Response
      try {
        res = await fetch(HUB_URL)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
      } catch {
        res = await fetch(FALLBACK_URL)
        if (!res.ok) throw new Error(`Fallback fetch failed: HTTP ${res.status}`)
      }
      // Guard against HTML error pages being returned instead of JSON
      const ct = res.headers.get('content-type') ?? ''
      if (!ct.includes('json')) {
        throw new Error('Hub returned non-JSON response. CORS or network issue.')
      }
      const data: HubConcept[] = await res.json()
      set({ concepts: data, lastFetched: Date.now(), loading: false })
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Failed to fetch hub data',
        loading: false,
      })
    }
  },

  setCategory(cat) {
    set({ activeCategory: cat })
  },
  setSearch(q) {
    set({ searchQuery: q })
  },
  setTag(tag) {
    set({ activeTag: tag })
  },
  resetFilters() {
    set({ activeCategory: null, searchQuery: '', activeTag: null })
  },

  filteredConcepts() {
    const { concepts, activeCategory, searchQuery, activeTag } = get()
    const q = searchQuery.toLowerCase().trim()
    return concepts.filter((c) => {
      if (activeCategory && c.category !== activeCategory) return false
      if (activeTag && !c.tags.includes(activeTag)) return false
      if (q) {
        const haystack = `${c.name} ${c.description} ${c.tags.join(' ')}`.toLowerCase()
        if (!haystack.includes(q)) return false
      }
      return true
    })
  },

  allTags() {
    const counts = new Map<string, number>()
    for (const c of get().concepts) {
      for (const t of c.tags) counts.set(t, (counts.get(t) ?? 0) + 1)
    }
    return [...counts.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count)
  },
}))
