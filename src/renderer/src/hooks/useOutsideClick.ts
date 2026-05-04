import { useEffect, type RefObject } from 'react'

/**
 * Close-on-outside-click hook.
 *
 * Calls `onOutside` whenever a pointerdown / mousedown happens outside ALL
 * provided refs and the popup is `active`. Uses `pointerdown` (preferred for
 * mouse + touch + pen, fires before mousedown/click) with a `mousedown`
 * fallback for legacy environments.
 *
 * Multiple refs are supported so a popover can stay open when clicking its
 * trigger button (rendered as a sibling, e.g. AppMenu's brand button vs its
 * popover content).
 *
 * Capture phase = true: ensures we run BEFORE descendants that might call
 * `e.stopPropagation()` (some libs — including React Flow node renderers —
 * stop bubbling for their own purposes; capture phase bypasses that).
 *
 * Pure DOM/JS — no React-specific renderer state — which keeps it trivially
 * unit-testable under node + a tiny element shim.
 */
export function useOutsideClick(
  refs: ReadonlyArray<RefObject<Element | null>>,
  active: boolean,
  onOutside: () => void,
): void {
  useEffect(() => {
    if (!active) return
    if (typeof document === 'undefined' && typeof window === 'undefined') return

    const handler = (e: Event): void => {
      const target = e.target as Node | null
      if (!target) return
      for (const r of refs) {
        const el = r.current
        if (el && el.contains(target)) return
      }
      onOutside()
    }

    // pointerdown fires for mouse, touch and pen; mousedown is a fallback
    // for environments without Pointer Events.
    const opts: AddEventListenerOptions = { capture: true }
    const root: EventTarget = (typeof document !== 'undefined' ? document : window)
    root.addEventListener('pointerdown', handler, opts)
    root.addEventListener('mousedown', handler, opts)
    return () => {
      root.removeEventListener('pointerdown', handler, opts)
      root.removeEventListener('mousedown', handler, opts)
    }
  }, [active, onOutside, ...refs])
}
