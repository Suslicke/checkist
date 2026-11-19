import { describe, expect, it } from 'vitest'
import { scrolledUnder, topBarKind, watchTopBar } from './top-bar'

describe('the top bar of a page (pure, no browser)', () => {
  it('tells the root of a section, a nested page and a focus screen by the control of the header row', () => {
    expect(topBarKind(undefined)).toBe('root')
    expect(topBarKind({ kind: 'back' })).toBe('nested')
    expect(topBarKind({ kind: 'close' })).toBe('focus')
  })

  it('counts the page as under the bar only when the mark has gone above the lower edge of the bar', () => {
    // At rest: the mark is under the bar, in sight.
    expect(scrolledUnder({ isIntersecting: true, boundingClientRect: { top: 120 }, rootBounds: { top: 44 } })).toBe(false)
    // Scrolled: the mark has gone above the edge of the bar.
    expect(scrolledUnder({ isIntersecting: false, boundingClientRect: { top: 10 }, rootBounds: { top: 44 } })).toBe(true)
    // Below the window (a very tall header row): no scroll at all.
    expect(scrolledUnder({ isIntersecting: false, boundingClientRect: { top: 900 }, rootBounds: { top: 44 } })).toBe(false)
    // Without the bounds of the root: its top is the top of the window.
    expect(scrolledUnder({ isIntersecting: false, boundingClientRect: { top: -2 }, rootBounds: null })).toBe(true)
  })

  it('does nothing without a browser and without its parts', () => {
    const stop = watchTopBar(null, [null], null)
    expect(() => stop()).not.toThrow()
  })
})
