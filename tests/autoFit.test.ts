/**
 * Auto-fit toggle tests.
 *
 * Verifies the toggleAutoFit flow:
 *   - state.autoFitActive flips on each toggle
 *   - immediate fit fires when enabling
 *   - interval-based fit fires repeatedly while active
 *   - timer is cleared and fit stops firing when disabled
 *   - fit doesn't fire while a presentation is active
 *   - re-init via setFitViewFn doesn't break an active loop
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useDiagramStore } from '../src/renderer/src/store/diagramStore'

// jsdom-like minimal window stub for the timer registry the store uses.
beforeEach(() => {
  // @ts-ignore
  if (typeof globalThis.window === 'undefined') {
    // @ts-ignore
    globalThis.window = globalThis as any
  }
  // Reset timer registry between tests
  ;(globalThis.window as any).__radicalAutoFitTimer = null
  ;(globalThis.window as any).__rfCurrentViewport = undefined
  // Make sure we start with autofit OFF
  if (useDiagramStore.getState().autoFitActive) {
    useDiagramStore.getState().toggleAutoFit()
  }
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  // Always disable autofit after a test so global timers don't leak
  if (useDiagramStore.getState().autoFitActive) {
    useDiagramStore.getState().toggleAutoFit()
  }
  useDiagramStore.getState().setFitViewFn(null, null)
})

describe('Auto-fit toggle', () => {
  it('flips state.autoFitActive on each toggle', () => {
    const s = useDiagramStore.getState()
    expect(s.autoFitActive).toBe(false)
    s.toggleAutoFit()
    expect(useDiagramStore.getState().autoFitActive).toBe(true)
    useDiagramStore.getState().toggleAutoFit()
    expect(useDiagramStore.getState().autoFitActive).toBe(false)
  })

  it('fires the registered fitView immediately when enabled', () => {
    const fit = vi.fn()
    const fitInstant = vi.fn()
    useDiagramStore.getState().setFitViewFn(fit, fitInstant)
    // setFitViewFn calls instant once on registration when no autofit was active
    fit.mockClear()
    fitInstant.mockClear()

    useDiagramStore.getState().toggleAutoFit()

    expect(fit).toHaveBeenCalledTimes(1)
  })

  it('keeps firing fitView while active (interval)', () => {
    const fit = vi.fn()
    const fitInstant = vi.fn()
    useDiagramStore.getState().setFitViewFn(fit, fitInstant)
    fit.mockClear()
    fitInstant.mockClear()

    useDiagramStore.getState().toggleAutoFit()
    // Initial animated fit
    expect(fit).toHaveBeenCalledTimes(1)
    expect(fitInstant).toHaveBeenCalledTimes(0)

    // Two interval ticks (300 ms each)
    vi.advanceTimersByTime(310)
    expect(fitInstant).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(310)
    expect(fitInstant).toHaveBeenCalledTimes(2)
  })

  it('stops firing after disabled', () => {
    const fit = vi.fn()
    const fitInstant = vi.fn()
    useDiagramStore.getState().setFitViewFn(fit, fitInstant)
    useDiagramStore.getState().toggleAutoFit()
    vi.advanceTimersByTime(310)
    fitInstant.mockClear()

    useDiagramStore.getState().toggleAutoFit() // disable
    vi.advanceTimersByTime(2000)
    expect(fitInstant).not.toHaveBeenCalled()
  })

  it('does not fit while a presentation is active', () => {
    const fit = vi.fn()
    const fitInstant = vi.fn()
    useDiagramStore.getState().setFitViewFn(fit, fitInstant)
    useDiagramStore.getState().toggleAutoFit()
    fit.mockClear()
    fitInstant.mockClear()

    // Force presentation flag
    useDiagramStore.setState({ presentationActive: true } as any)
    vi.advanceTimersByTime(1000)
    expect(fitInstant).not.toHaveBeenCalled()

    // Restore — interval should resume
    useDiagramStore.setState({ presentationActive: false } as any)
    vi.advanceTimersByTime(310)
    expect(fitInstant).toHaveBeenCalled()
  })

  it('re-registering fitView while active keeps the loop running with the new fn', () => {
    const oldFit = vi.fn()
    const oldInstant = vi.fn()
    useDiagramStore.getState().setFitViewFn(oldFit, oldInstant)
    useDiagramStore.getState().toggleAutoFit()
    vi.advanceTimersByTime(310)
    expect(oldInstant).toHaveBeenCalled()

    // Simulate Canvas remount: register new fns
    const newFit = vi.fn()
    const newInstant = vi.fn()
    oldInstant.mockClear()
    useDiagramStore.getState().setFitViewFn(newFit, newInstant)

    // Old fns must NOT be called again, new instant fn must fire on next tick
    vi.advanceTimersByTime(310)
    expect(oldInstant).not.toHaveBeenCalled()
    expect(newInstant).toHaveBeenCalled()
  })

  it('setFitViewFn does not cancel the auto-fit loop while active', () => {
    const fit = vi.fn()
    const instant = vi.fn()
    useDiagramStore.getState().setFitViewFn(fit, instant)
    useDiagramStore.getState().toggleAutoFit()
    expect(useDiagramStore.getState().autoFitActive).toBe(true)

    // Re-register (HMR / remount). Active loop should survive.
    useDiagramStore.getState().setFitViewFn(fit, instant)
    expect(useDiagramStore.getState().autoFitActive).toBe(true)
    instant.mockClear()
    vi.advanceTimersByTime(310)
    expect(instant).toHaveBeenCalled()
  })

  it('fitAll calls the animated fit fn', () => {
    const fit = vi.fn()
    const instant = vi.fn()
    useDiagramStore.getState().setFitViewFn(fit, instant)
    fit.mockClear()
    instant.mockClear()
    useDiagramStore.getState().fitAll()
    expect(fit).toHaveBeenCalledTimes(1)
    expect(instant).not.toHaveBeenCalled()
  })
})
