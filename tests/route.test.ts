import { describe, it, expect } from 'vitest'
import { parseHash, formatRoute, type Route } from '../src/renderer/src/route'

describe('route parse/format', () => {
  it('formats mode + view', () => {
    expect(formatRoute({ mode: 'designer', view: 'canvas' })).toBe('#/m/designer/v/canvas')
  })

  it('omits focus on canvas, includes it on a real view', () => {
    expect(formatRoute({ mode: 'viewer', view: 'canvas', focus: 'n1' })).toBe('#/m/viewer/v/canvas')
    expect(formatRoute({ mode: 'viewer', view: 'view-1', focus: 'n1' })).toBe(
      '#/m/viewer/v/view-1/f/n1',
    )
  })

  it('includes the optional doc segment', () => {
    expect(formatRoute({ doc: 'ls:abc', mode: 'designer', view: 'v2' })).toBe(
      '#/d/ls%3Aabc/m/designer/v/v2',
    )
  })

  it('round-trips an fs doc path with slashes', () => {
    const r: Route = { doc: 'fs:/Users/me/model.c4.json', mode: 'presenter', view: 'wiki-1', focus: 'el-9' }
    const parsed = parseHash(formatRoute(r))
    expect(parsed).toEqual(r)
  })

  it('encodes an active milestone (snapshot)', () => {
    expect(formatRoute({ mode: 'designer', view: 'view-1', snap: 'snap-3' })).toBe(
      '#/m/designer/v/view-1/s/snap-3',
    )
    expect(parseHash('#/m/designer/v/view-1/s/snap-3')).toMatchObject({ snap: 'snap-3' })
  })

  it('encodes presentation playback only when playing', () => {
    // play flag absent → pres/slide dropped
    expect(formatRoute({ mode: 'presenter', view: 'canvas', pres: 'p1', slide: 2 })).toBe(
      '#/m/presenter/v/canvas',
    )
    // playing → full presentation segment
    const r: Route = { mode: 'presenter', view: 'canvas', pres: 'p1', play: true, slide: 2 }
    expect(formatRoute(r)).toBe('#/m/presenter/v/canvas/p/p1/play/1/sl/2')
    expect(parseHash('#/m/presenter/v/canvas/p/p1/play/1/sl/2')).toMatchObject({
      pres: 'p1',
      play: true,
      slide: 2,
    })
  })

  it('round-trips milestone + presentation together', () => {
    const r: Route = {
      doc: 'ls:abc',
      mode: 'presenter',
      view: 'view-1',
      snap: 'snap-9',
      pres: 'pres-2',
      play: true,
      slide: 0,
    }
    expect(parseHash(formatRoute(r))).toEqual(r)
  })

  it('parses null for empty / non-route hashes', () => {
    expect(parseHash('')).toBeNull()
    expect(parseHash('#')).toBeNull()
    expect(parseHash('#/')).toBeNull()
  })

  it('defaults an unknown mode to designer', () => {
    expect(parseHash('#/m/bogus/v/canvas')).toEqual({
      doc: undefined,
      mode: 'designer',
      view: 'canvas',
      focus: undefined,
    })
  })

  it('parses doc + mode + view + focus', () => {
    expect(parseHash('#/d/ls%3Aabc/m/viewer/v/view-1/f/n1')).toEqual({
      doc: 'ls:abc',
      mode: 'viewer',
      view: 'view-1',
      focus: 'n1',
    })
  })
})
