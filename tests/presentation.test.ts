/**
 * Presentation tests.
 *
 * Covers:
 *   - addPresentation creates and activates one
 *   - addPresentationSlide captures the current viewport AND a deep
 *     modelSnapshot (so the slide is independent of later edits)
 *   - removePresentationSlide drops it and clamps the slide index
 *   - startPresentation: sets presentationActive, snapshots
 *     window.__prePresState, and rebuilds rfNodes with locked draggable;
 *     starts from the current presentationSlideIndex (not always 0)
 *   - toggleCollapse is a no-op while a presentation is active
 *   - stopPresentation: clears presentationActive, restores
 *     __prePresState, unlocks rfNodes
 *   - goToSlide: replays viewport, restores model snapshot — only called
 *     while a presentation is already active
 *   - previewSlide: navigates to the slide's linked view WITHOUT starting
 *     presentation mode; sets presentationSlideIndex so Present starts there
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useDiagramStore } from '../src/renderer/src/store/diagramStore'
import type { C4Node, C4Relation } from '../src/renderer/src/types/c4'

const initial = (() => {
  const s = useDiagramStore.getState()
  return {
    c4Nodes: JSON.parse(JSON.stringify(s.c4Nodes)) as Record<string, C4Node>,
    c4Relations: JSON.parse(JSON.stringify(s.c4Relations)) as Record<string, C4Relation>,
  }
})()

beforeEach(() => {
  // Fresh document-ish state
  useDiagramStore.setState({
    c4Nodes: JSON.parse(JSON.stringify(initial.c4Nodes)),
    c4Relations: JSON.parse(JSON.stringify(initial.c4Relations)),
    presentations: [{ id: 'p-test', name: 'P', slides: [] }],
    activePresentationId: 'p-test',
    presentationSlides: [],
    presentationSlideIndex: 0,
    presentationActive: false,
    appMode: 'designer',
  } as any)
  ;(window as any).__rfCurrentViewport = { x: 100, y: 200, zoom: 1.5 }
  ;(window as any).__prePresState = undefined
  useDiagramStore.getState()._sync()
})

describe('addPresentationSlide', () => {
  it('captures viewport + inline modelSnapshot', () => {
    useDiagramStore.getState().addPresentationSlide('s1')
    const slides = useDiagramStore.getState().presentationSlides as any[]
    expect(slides.length).toBe(1)
    expect(slides[0].name).toBe('s1')
    expect(slides[0].viewport).toEqual({ x: 100, y: 200, zoom: 1.5 })
    expect(slides[0].modelSnapshot).toBeDefined()
    expect(Object.keys(slides[0].modelSnapshot.nodes).length).toBe(
      Object.keys(useDiagramStore.getState().c4Nodes).length,
    )
  })

  it('modelSnapshot is independent of later live edits', () => {
    useDiagramStore.getState().addPresentationSlide('s1')
    const sid = (useDiagramStore.getState().presentationSlides as any[])[0].id
    // Mutate live HEAD
    useDiagramStore.setState((s: any) => {
      s.c4Nodes['ctn1'].label = 'CHANGED-AFTER-SLIDE'
      return s
    })
    const slide = (useDiagramStore.getState().presentationSlides as any[]).find(
      (s) => s.id === sid,
    )
    expect(slide.modelSnapshot.nodes['ctn1'].label).not.toBe('CHANGED-AFTER-SLIDE')
  })
})

describe('removePresentationSlide', () => {
  it('drops it and clamps the slide index', () => {
    useDiagramStore.getState().addPresentationSlide('a')
    useDiagramStore.getState().addPresentationSlide('b')
    useDiagramStore.setState({ presentationSlideIndex: 1 } as any)
    const last = (useDiagramStore.getState().presentationSlides as any[])[1]
    useDiagramStore.getState().removePresentationSlide(last.id)
    expect(useDiagramStore.getState().presentationSlides.length).toBe(1)
    expect(useDiagramStore.getState().presentationSlideIndex).toBe(0)
  })
})

describe('startPresentation / stopPresentation', () => {
  it('sets presentationActive, snapshots __prePresState, locks rfNodes', () => {
    useDiagramStore.getState().addPresentationSlide('a')
    // pollute live HEAD with a sentinel so we can prove restore on stop
    useDiagramStore.setState((s: any) => {
      s.c4Nodes['ctn1'].label = 'LIVE-HEAD'
      return s
    })
    useDiagramStore.getState().startPresentation()
    const s = useDiagramStore.getState()
    expect(s.presentationActive).toBe(true)
    expect((window as any).__prePresState).toBeDefined()
    expect((window as any).__prePresState.c4Nodes['ctn1'].label).toBe('LIVE-HEAD')
    // rfNodes per-node draggable should now be false (locked)
    const someRf = (s.rfNodes as any[]).find((n) => !n.hidden)
    expect(someRf?.draggable).toBe(false)
    expect(someRf?.selectable).toBe(false)
  })

  it('toggleCollapse is a no-op during an active presentation', () => {
    useDiagramStore.getState().addPresentationSlide('a')
    useDiagramStore.getState().startPresentation()
    const before = useDiagramStore.getState().c4Nodes['sys1'].collapsed === true
    useDiagramStore.getState().toggleCollapse('sys1')
    const after = useDiagramStore.getState().c4Nodes['sys1'].collapsed === true
    expect(after).toBe(before)
  })

  it('stopPresentation clears the flag, restores __prePresState, unlocks rfNodes', () => {
    useDiagramStore.getState().addPresentationSlide('a')
    useDiagramStore.setState((s: any) => {
      s.c4Nodes['ctn1'].label = 'LIVE-HEAD'
      return s
    })
    useDiagramStore.getState().startPresentation()
    // While presenting, simulate a slide-replay overwriting c4Nodes
    useDiagramStore.setState((s: any) => {
      s.c4Nodes['ctn1'].label = 'SLIDE'
      return s
    })
    useDiagramStore.getState().stopPresentation()
    const s = useDiagramStore.getState()
    expect(s.presentationActive).toBe(false)
    expect(s.c4Nodes['ctn1'].label).toBe('LIVE-HEAD')
    expect((window as any).__prePresState).toBeUndefined()
    const someRf = (s.rfNodes as any[]).find((n) => !n.hidden)
    expect(someRf?.draggable).toBe(true)
  })
})

describe('goToSlide', () => {
  it('replays the captured viewport via setViewportFn (during active presentation)', () => {
    const setVP = vi.fn()
    useDiagramStore.getState().setViewportFns(() => ({ x: 0, y: 0, zoom: 1 }), setVP)
    useDiagramStore.getState().addPresentationSlide('a')
    ;(window as any).__rfCurrentViewport = { x: 0, y: 0, zoom: 1 }
    useDiagramStore.getState().startPresentation()
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(setVP).toHaveBeenCalled()
        const [vpArg] = setVP.mock.calls.at(-1)!
        expect(vpArg).toEqual({ x: 100, y: 200, zoom: 1.5 })
        resolve()
      }, 100)
    })
  })

  it('does NOT overwrite __prePresState on subsequent goToSlide calls (already presenting)', () => {
    useDiagramStore.getState().addPresentationSlide('a')
    useDiagramStore.getState().addPresentationSlide('b')
    useDiagramStore.getState().startPresentation()
    const savedState = (window as any).__prePresState
    setTimeout(() => {
      useDiagramStore.getState().goToSlide(1) // already active — must not overwrite
      expect((window as any).__prePresState).toBe(savedState) // same object reference
    }, 60)
  })

  it('does NOT auto-activate presentation when called outside a running presentation', () => {
    useDiagramStore.getState().addPresentationSlide('a')
    expect(useDiagramStore.getState().presentationActive).toBe(false)
    useDiagramStore.getState().goToSlide(0)
    expect(useDiagramStore.getState().presentationActive).toBe(false)
    expect((window as any).__prePresState).toBeUndefined()
  })
})

describe('previewSlide', () => {
  it('sets presentationSlideIndex without starting presentation', () => {
    useDiagramStore.getState().addPresentationSlide('a')
    useDiagramStore.getState().addPresentationSlide('b')
    expect(useDiagramStore.getState().presentationActive).toBe(false)
    useDiagramStore.getState().previewSlide(1)
    expect(useDiagramStore.getState().presentationSlideIndex).toBe(1)
    expect(useDiagramStore.getState().presentationActive).toBe(false)
    expect((window as any).__prePresState).toBeUndefined()
  })

  it('does not modify c4Nodes (no snapshot restore)', () => {
    useDiagramStore.setState((s: any) => {
      s.c4Nodes['ctn1'].label = 'LIVE'
      return s
    })
    useDiagramStore.getState().addPresentationSlide('a')
    useDiagramStore.getState().previewSlide(0)
    expect(useDiagramStore.getState().c4Nodes['ctn1'].label).toBe('LIVE')
  })

  it('startPresentation after previewSlide starts from the previewed slide index', () => {
    useDiagramStore.getState().addPresentationSlide('a')
    useDiagramStore.getState().addPresentationSlide('b')
    useDiagramStore.getState().previewSlide(1)
    useDiagramStore.getState().startPresentation()
    // startPresentation now preserves presentationSlideIndex (1)
    expect(useDiagramStore.getState().presentationSlideIndex).toBe(1)
    expect(useDiagramStore.getState().presentationActive).toBe(true)
  })
})
