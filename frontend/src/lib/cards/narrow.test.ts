import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DESKTOP_MIN_WIDTH, PHONE_MAX_WIDTH, coarsePointerQuery, createCoarsePointerStore, createNarrowStore, desktopQuery, narrowQuery, useCoarsePointer, useDesktop, useNarrow } from './narrow'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

function environment(matches = false) {
  const state = { matches, listeners: new Set<() => void>(), stopped: 0 }
  const store = createNarrowStore({
    matches: () => state.matches,
    listen: (listener) => {
      state.listeners.add(listener)
      return () => { state.listeners.delete(listener); state.stopped += 1 }
    },
  })
  const resize = (value: boolean) => {
    state.matches = value
    for (const listener of state.listeners) listener()
  }
  return { state, store, resize }
}

afterEach(() => vi.unstubAllGlobals())

describe('phone threshold', () => {
  it('is the one width of the project', () => {
    expect(PHONE_MAX_WIDTH).toBe(540)
    expect(narrowQuery).toBe('(max-width: 540px)')
  })

  it('equals the width in the media query of the action bar', () => {
    const widths = [...read('../../components/ActionBar.css').matchAll(/@media[^{]*\(max-width:\s*(\d+)px\)/g)].map((match) => Number(match[1]))
    expect(widths).toEqual([PHONE_MAX_WIDTH])
  })
})

describe('desktop threshold', () => {
  it('is the one width of two columns', () => {
    expect(DESKTOP_MIN_WIDTH).toBe(960)
    expect(desktopQuery).toBe('(min-width: 960px)')
    expect(coarsePointerQuery).toBe('(pointer: coarse)')
  })

  it('equals the width of every desktop media query', () => {
    // Skeleton.css also holds a (min-width: 541px) block of the phone boundary and two 960 blocks: values, not count.
    for (const path of ['../../theme/desktop.css', '../../features/dashboard/Dashboard.css', '../../components/Skeleton.css']) {
      const widths = [...read(path).matchAll(/@media[^{]*\(min-width:\s*(\d+)px\)/g)].map((match) => Number(match[1])).filter((width) => width > PHONE_MAX_WIDTH + 1)
      expect([...new Set(widths)], path).toEqual([DESKTOP_MIN_WIDTH])
    }
  })
})

describe('narrow store', () => {
  it('reports the current answer of the environment and never the server one', () => {
    expect(environment(false).store.getSnapshot()).toBe(false)
    expect(environment(true).store.getSnapshot()).toBe(true)
    expect(environment(true).store.getServerSnapshot()).toBe(false)
  })

  it('does not touch the environment until it is asked', () => {
    let calls = 0
    createNarrowStore({ matches: () => { calls += 1; return true }, listen: () => { calls += 1; return () => {} } })
    expect(calls).toBe(0)
  })

  it('announces a change of the width while somebody is subscribed', () => {
    const { state, store, resize } = environment(false)
    const seen: boolean[] = []
    const unsubscribe = store.subscribe(() => seen.push(store.getSnapshot()))
    expect(state.listeners.size).toBe(1)

    resize(true)
    resize(false)
    expect(seen).toEqual([true, false])

    unsubscribe()
    expect(state.stopped).toBe(1)
    resize(true)
    expect(seen).toEqual([true, false])
    expect(store.getSnapshot()).toBe(true)
  })

  it('stays wide when the environment fails', () => {
    const refuse = () => { throw new TypeError('matchMedia is not a function') }
    const store = createNarrowStore({ matches: refuse, listen: refuse })
    expect(store.getSnapshot()).toBe(false)
    let unsubscribe = () => {}
    expect(() => { unsubscribe = store.subscribe(() => {}) }).not.toThrow()
    expect(() => unsubscribe()).not.toThrow()

    const leaky = createNarrowStore({ matches: () => true, listen: () => refuse })
    expect(() => leaky.subscribe(() => {})()).not.toThrow()
  })

  it('takes only a real true for a phone', () => {
    const store = createNarrowStore({ matches: () => 'yes' as unknown as boolean, listen: () => () => {} })
    expect(store.getSnapshot()).toBe(false)
  })
})

describe('useNarrow without a browser', () => {
  const Probe = () => (useNarrow() ? 'cards' : 'table')

  it('has no window in this test run and renders the wide view', () => {
    expect(typeof window).toBe('undefined')
    expect(renderToStaticMarkup(createElement(Probe))).toBe('table')
  })

  it('keeps the wide view of a server render whatever matchMedia says', () => {
    const matchMedia = vi.fn(() => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }))
    vi.stubGlobal('window', { matchMedia })
    expect(renderToStaticMarkup(createElement(Probe))).toBe('table')
  })
})

describe('useDesktop without a browser', () => {
  const Probe = () => (useDesktop() ? 'table' : 'cards')

  it('has no window in this test run and never renders the desktop view', () => {
    expect(typeof window).toBe('undefined')
    expect(renderToStaticMarkup(createElement(Probe))).toBe('cards')
  })

  it('keeps the server render off the desktop view whatever matchMedia says', () => {
    const matchMedia = vi.fn(() => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }))
    vi.stubGlobal('window', { matchMedia })
    expect(renderToStaticMarkup(createElement(Probe))).toBe('cards')
  })
})

describe('useCoarsePointer without a browser', () => {
  const Probe = () => (useCoarsePointer() ? 'Снять чек' : 'Загрузить чек')

  it('takes a finger for the pointer of a server render', () => {
    expect(renderToStaticMarkup(createElement(Probe))).toBe('Снять чек')
    const matchMedia = vi.fn(() => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }))
    vi.stubGlobal('window', { matchMedia })
    expect(renderToStaticMarkup(createElement(Probe))).toBe('Снять чек')
  })

  it('follows the environment in the browser and the finger on the server', () => {
    const coarse = (matches: boolean) => createCoarsePointerStore({ matches: () => matches, listen: () => () => {} })
    expect(coarse(false).getServerSnapshot()).toBe(true)
    expect(coarse(false).getSnapshot()).toBe(false)
    expect(coarse(true).getSnapshot()).toBe(true)
  })
})
