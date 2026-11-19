import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HOME_FIGURES, defaultHomeFigure, homeFigureStorageKey, parseHomeFigure, readHomeFigure, resetHomeFigureForTests, writeHomeFigure } from './home-figure'
import HomeFigureSetting from './HomeFigureSetting'

const memory = () => {
  const saved = new Map<string, string>()
  return { saved, storage: { getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => { saved.set(key, value) } } }
}

beforeEach(() => resetHomeFigureForTests())
afterEach(() => { vi.unstubAllGlobals(); resetHomeFigureForTests() })

describe('«Главное число» of the device (checkist.homeFigure)', () => {
  it('offers four numbers, «Потрачено» first and by default', () => {
    expect(homeFigureStorageKey).toBe('checkist.homeFigure')
    expect(HOME_FIGURES.map((option) => [option.value, option.label])).toEqual([['spent', 'Потрачено'], ['left', 'Осталось'], ['free', 'Свободно'], ['daily', 'В день']])
    expect(HOME_FIGURES.every((option) => option.note.length > 0)).toBe(true)
    expect(defaultHomeFigure).toBe('spent')
    expect(parseHomeFigure('daily')).toBe('daily')
    expect(parseHomeFigure('allowance')).toBe('spent')
    expect(parseHomeFigure(null)).toBe('spent')
  })

  it('reads the stored choice, remembers a new one and keeps it for the page', () => {
    const { saved, storage } = memory()
    saved.set('checkist.homeFigure', 'left')
    vi.stubGlobal('localStorage', storage)
    expect(readHomeFigure()).toBe('left')
    writeHomeFigure('free')
    expect(saved.get('checkist.homeFigure')).toBe('free')
    expect(readHomeFigure()).toBe('free')
  })

  it('takes the default without a browser, from an unknown value and when the storage refuses', () => {
    expect(readHomeFigure()).toBe('spent')
    resetHomeFigureForTests()
    vi.stubGlobal('localStorage', { getItem: () => 'something', setItem: () => {} })
    expect(readHomeFigure()).toBe('spent')
    resetHomeFigureForTests()
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') } })
    expect(readHomeFigure()).toBe('spent')
    // A refused write still changes the number for the open page.
    expect(() => writeHomeFigure('daily')).not.toThrow()
    expect(readHomeFigure()).toBe('daily')
  })
})

describe('HomeFigureSetting markup (Vitest/SSR)', () => {
  it('is one labelled radio group of four options, each described by its note, the choice checked', () => {
    const { saved, storage } = memory()
    saved.set('checkist.homeFigure', 'left')
    vi.stubGlobal('localStorage', storage)
    const html = renderToStaticMarkup(<HomeFigureSetting />)
    expect(html).toMatch(/^<fieldset class="home-figure-setting"><legend class="ck-title home-figure-legend">Главное число на Главной<\/legend>/)
    expect(html.match(/type="radio"/g)).toHaveLength(4)
    expect(html.match(/<input type="radio" class="home-figure-radio"[^>]*name="[^"]+"/g)?.length).toBe(4)
    // One name: the radios form one group for the keyboard and a screen reader.
    expect(new Set([...html.matchAll(/name="([^"]+)"/g)].map((match) => match[1])).size).toBe(1)
    expect(html).toMatch(/checked="" value="left"/)
    expect(html).not.toMatch(/checked="" value="spent"/)
    const note = /aria-describedby="([^"]+)" name="[^"]+" value="free"/.exec(html)?.[1]
    expect(note).toBeTruthy()
    expect(html).toContain(`<span class="home-figure-note" id="${note}">Доход минус траты, платежи и планы</span>`)
  })

  it('draws an option that cannot be shown disabled, with its reason in place of the note; the legend may be hidden', () => {
    const html = renderToStaticMarkup(<HomeFigureSetting hideLegend unavailable={{ left: 'Бюджет месяца не задан', daily: 'Только для текущего месяца' }} />)
    expect(html).toContain('<legend class="ck-visually-hidden">Главное число на Главной</legend>')
    expect(html).toMatch(/<label class="home-figure-option is-disabled"><input type="radio" class="home-figure-radio" disabled="" aria-describedby="[^"]+" name="[^"]+" value="left"/)
    expect(html).toContain('>Бюджет месяца не задан</span>')
    expect(html).toContain('>Только для текущего месяца</span>')
    expect(html.match(/disabled=""/g)).toHaveLength(2)
    expect(html).toMatch(/checked="" value="spent"/)
  })
})
