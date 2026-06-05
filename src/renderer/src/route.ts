// ─── Hash-based deep-link routing ────────────────────────────────────────────
//
// The app is a static SPA (`base: './'`) that runs under `file://` (Electron),
// GitHub Pages, or any host, so path-based routing would need server rewrites.
// Hash routing (`#/...`) works everywhere with zero config and no extra
// dependency, so we keep a tiny custom router that mirrors the relevant slice
// of app state into `location.hash` and back.
//
// URL grammar (segments are key/value pairs, each value URI-encoded):
//
//   #/m/<mode>/v/<viewId>[/f/<focusId>][/s/<snapshotId>]
//   #/d/<docId>/m/<mode>/v/<viewId>...[/p/<presId>/play/1/sl/<n>]
//
//   <mode>    designer | viewer | presenter | metamodel   (default: designer)
//   <viewId>  a view id, or `canvas` for the default Canvas (activeViewId null)
//   <focusId> a Wiki element node id (only applied for wiki views)
//   <docId>   `ls:<uuid>` or `fs:<absolutePath>`. Machine-local identity; when
//             omitted or unresolvable we keep the currently-active document.
//   <snapshotId>  active milestone (`s`). Restores that milestone's frozen model.
//   <presId>/play/1/sl/<n>  presentation playback: which presentation (`p`), the
//             `play` flag, and the 0-based slide index (`sl`). Only present while
//             a presentation is actually running.

import { useEffect } from 'react'
import { useDiagramStore } from './store/diagramStore'
import { documents, useDocumentsStore } from './store/documentStore'

type Mode = 'designer' | 'viewer' | 'presenter' | 'metamodel'
const MODES: readonly Mode[] = ['designer', 'viewer', 'presenter', 'metamodel'] as const

export interface Route {
  /** `ls:<uuid>` or `fs:<absolutePath>`; undefined = keep active document. */
  doc?: string
  mode: Mode
  /** view id, or `canvas` for the default Canvas. */
  view: string
  /** wiki element node id (only meaningful for wiki views). */
  focus?: string
  /** active milestone (snapshot) id. */
  snap?: string
  /** active presentation id (only when playing). */
  pres?: string
  /** whether a presentation is currently playing. */
  play?: boolean
  /** 0-based presentation slide index (only when playing). */
  slide?: number
}

// Guards the state↔URL feedback loop: while we are applying a route to the
// store we must not echo those mutations straight back into the URL.
let applying = false

// ─── Parse / format ──────────────────────────────────────────────────────────

export function parseHash(hash: string): Route | null {
  const raw = hash.replace(/^#\/?/, '')
  if (!raw) return null
  const parts = raw.split('/').filter(Boolean)
  const map: Record<string, string> = {}
  for (let i = 0; i + 1 < parts.length; i += 2) {
    try {
      map[parts[i]] = decodeURIComponent(parts[i + 1])
    } catch {
      map[parts[i]] = parts[i + 1]
    }
  }
  if (map.m === undefined && map.v === undefined && map.d === undefined) return null
  const mode = (MODES as readonly string[]).includes(map.m) ? (map.m as Mode) : 'designer'
  const slide = map.sl !== undefined && /^\d+$/.test(map.sl) ? Number(map.sl) : undefined
  return {
    doc: map.d || undefined,
    mode,
    view: map.v || 'canvas',
    focus: map.f || undefined,
    snap: map.s || undefined,
    pres: map.p || undefined,
    play: map.play === '1' || undefined,
    slide,
  }
}

export function formatRoute(r: Route): string {
  const segs: string[] = []
  if (r.doc) segs.push('d', encodeURIComponent(r.doc))
  segs.push('m', encodeURIComponent(r.mode))
  segs.push('v', encodeURIComponent(r.view))
  if (r.focus && r.view !== 'canvas') segs.push('f', encodeURIComponent(r.focus))
  if (r.snap) segs.push('s', encodeURIComponent(r.snap))
  if (r.play && r.pres) {
    segs.push('p', encodeURIComponent(r.pres), 'play', '1')
    if (typeof r.slide === 'number') segs.push('sl', String(r.slide))
  }
  return '#/' + segs.join('/')
}

// ─── Current state → Route ───────────────────────────────────────────────────

function currentDocToken(): string | undefined {
  const id = documents.getActiveId()
  if (!id) return undefined
  const meta = documents.listDocuments().find((d) => d.id === id)
  if (!meta) return undefined
  return meta.source === 'fs' && meta.filePath ? 'fs:' + meta.filePath : 'ls:' + meta.id
}

export function currentRoute(): Route {
  const s = useDiagramStore.getState()
  let focus: string | undefined
  if (s.activeViewId) {
    const v = s.views[s.activeViewId]
    if (v && v.kind === 'wiki' && v.wikiFocusId) focus = v.wikiFocusId
  }
  const playing = s.presentationActive
  return {
    doc: currentDocToken(),
    mode: s.appMode,
    view: s.activeViewId ?? 'canvas',
    focus,
    snap: s.activeSnapshotId ?? undefined,
    pres: playing ? (s.activePresentationId ?? undefined) : undefined,
    play: playing || undefined,
    slide: playing ? s.presentationSlideIndex : undefined,
  }
}

// ─── Route → state ───────────────────────────────────────────────────────────

function withApplying(fn: () => void): void {
  applying = true
  try {
    fn()
  } finally {
    // Reset after the synchronous subscriber fan-out so store-driven URL
    // writes triggered by these mutations are skipped, but later (async)
    // changes still propagate to the URL.
    queueMicrotask(() => {
      applying = false
    })
  }
}

/** Switch the active document if `doc` resolves to a different one.
 *  Returns true when a switch was initiated (model load is async). */
function resolveDoc(doc: string): boolean {
  const activeId = documents.getActiveId()
  if (doc.startsWith('ls:')) {
    const id = doc.slice(3)
    if (id && id !== activeId && documents.listDocuments().some((d) => d.id === id)) {
      documents.setActiveId(id)
      return true
    }
  } else if (doc.startsWith('fs:')) {
    const path = doc.slice(3)
    if (path) {
      // createFSDocument de-dupes by path; only meaningful under Electron.
      const meta = documents.createFSDocument(path)
      if (meta.id !== activeId) {
        documents.setActiveId(meta.id)
        return true
      }
    }
  }
  return false
}

function applyViewModeFocus(route: Route): void {
  withApplying(() => {
    const store = useDiagramStore.getState()
    if ((MODES as readonly string[]).includes(route.mode) && store.appMode !== route.mode) {
      store.setAppMode(route.mode)
    }
    // Resolve the target view. A view id that doesn't exist in the current
    // document (e.g. a link opened on a machine whose localStorage doesn't
    // hold that doc, so we fell back to the freshly-seeded sample) degrades
    // gracefully to the default Canvas rather than leaving a dangling id.
    const reqView = route.view === 'canvas' ? null : route.view
    const targetView = reqView && useDiagramStore.getState().views[reqView] ? reqView : null
    if (useDiagramStore.getState().activeViewId !== targetView) {
      useDiagramStore.getState().setActiveView(targetView)
    }
    if (route.focus && targetView) {
      const v = useDiagramStore.getState().views[targetView]
      if (v && v.kind === 'wiki' && v.wikiFocusId !== route.focus) {
        useDiagramStore.getState().setWikiFocus(targetView, route.focus)
      }
    }
    // Milestone (snapshot). Apply-only: we restore the requested milestone but
    // never auto-discard on back-nav (discarding can drop unsaved edits). The
    // forward direction — exiting a milestone in-app — still updates the URL.
    if (route.snap) {
      const s = useDiagramStore.getState()
      if (s.activeSnapshotId !== route.snap && s.snapshots.some((sn) => sn.id === route.snap)) {
        s.restoreSnapshot(route.snap)
      }
    }
  })
  applyPresentation(route)
}

/** Drive presentation playback from the URL. Kept outside `withApplying`
 *  because `startPresentation` finishes asynchronously (it re-applies the
 *  current slide on a timer), so we re-assert the target slide just after. */
function applyPresentation(route: Route): void {
  const st = useDiagramStore.getState()
  if (route.play && route.pres && st.presentations.some((p) => p.id === route.pres)) {
    if (st.activePresentationId !== route.pres) st.setActivePresentation(route.pres)
    if (!useDiagramStore.getState().presentationActive) useDiagramStore.getState().startPresentation()
    if (typeof route.slide === 'number') {
      const target = route.slide
      // After startPresentation's internal goToSlide(currentIndex) timer (~50ms).
      setTimeout(() => {
        if (useDiagramStore.getState().presentationActive) {
          useDiagramStore.getState().goToSlide(target)
        }
      }, 140)
    }
  } else if (!route.play && st.presentationActive) {
    st.stopPresentation()
  }
}

/** Apply view/mode/focus once the target view exists (after async doc load),
 *  with a timeout fallback so mode at least still takes effect. */
function schedulePendingApply(route: Route): void {
  const hasTarget = (): boolean =>
    route.view === 'canvas' || !!useDiagramStore.getState().views[route.view]
  if (hasTarget()) {
    applyViewModeFocus(route)
    return
  }
  let done = false
  const finish = (): void => {
    if (done) return
    done = true
    unsub()
    clearTimeout(timer)
    applyViewModeFocus(route)
  }
  const unsub = useDiagramStore.subscribe(() => {
    if (hasTarget()) finish()
  })
  const timer = setTimeout(finish, 4000)
}

export function applyRoute(route: Route): void {
  const switched = route.doc ? resolveDoc(route.doc) : false
  if (switched) schedulePendingApply(route)
  else applyViewModeFocus(route)
}

// ─── State → URL ─────────────────────────────────────────────────────────────

function writeUrl(): void {
  const hash = formatRoute(currentRoute())
  const current = '#/' + location.hash.replace(/^#\/?/, '')
  if (current !== hash) {
    history.replaceState(null, '', hash)
  }
}

// ─── Wiring ──────────────────────────────────────────────────────────────────

export function startRouteSync(): () => void {
  if (typeof window === 'undefined') return () => {}

  const initial = parseHash(location.hash)
  if (initial) applyRoute(initial)
  else writeUrl()

  const onHash = (): void => {
    if (applying) return
    const r = parseHash(location.hash)
    if (r) applyRoute(r)
  }
  window.addEventListener('hashchange', onHash)

  let timer: ReturnType<typeof setTimeout> | null = null
  const schedule = (): void => {
    if (applying) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      writeUrl()
    }, 150)
  }

  const unsubDiagram = useDiagramStore.subscribe((s, p) => {
    if (
      s.appMode !== p.appMode ||
      s.activeViewId !== p.activeViewId ||
      s.views !== p.views ||
      s.activeSnapshotId !== p.activeSnapshotId ||
      s.presentationActive !== p.presentationActive ||
      s.presentationSlideIndex !== p.presentationSlideIndex ||
      s.activePresentationId !== p.activePresentationId
    ) {
      schedule()
    }
  })
  const unsubDocs = useDocumentsStore.subscribe(() => schedule())

  return () => {
    window.removeEventListener('hashchange', onHash)
    unsubDiagram()
    unsubDocs()
    if (timer) clearTimeout(timer)
  }
}

/** React hook: mount the hash↔state sync for the lifetime of the app. */
export function useRouteSync(): void {
  useEffect(() => startRouteSync(), [])
}
