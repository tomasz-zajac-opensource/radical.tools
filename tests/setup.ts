/**
 * Global vitest setup — minimal `window` stub so the renderer store
 * (which references `window.__rfCurrentViewport` and similar globals
 * for canvas plumbing) can run under node without jsdom.
 */
// @ts-ignore
if (typeof globalThis.window === 'undefined') {
  // @ts-ignore
  globalThis.window = globalThis as any
}
;(globalThis as any).window.__rfCurrentViewport = undefined
;(globalThis as any).window.__radicalAutoFitTimer = null

// Polyfill requestAnimationFrame / cancelAnimationFrame for node env so
// store actions that defer work via rAF can run under tests.
if (typeof (globalThis as any).requestAnimationFrame === 'undefined') {
  ;(globalThis as any).requestAnimationFrame = (cb: (t: number) => void): any =>
    setTimeout(() => cb(Date.now()), 0)
  ;(globalThis as any).cancelAnimationFrame = (id: any): void => clearTimeout(id)
}
