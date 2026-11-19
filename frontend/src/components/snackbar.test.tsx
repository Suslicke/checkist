import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import Snackbar from './Snackbar'
import { SNACKBAR_PLAIN_MS, snackbarLifetime } from './snackbar-time'

const strip = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '')
const css = strip(readFileSync(new URL('./Snackbar.css', import.meta.url), 'utf8'))
const tokens = readFileSync(new URL('../theme/tokens.css', import.meta.url), 'utf8')

describe('markup of the snackbar (Node server render, not browser behaviour)', () => {
  it('is a polite status with the message and one action', () => {
    const html = renderToStaticMarkup(<Snackbar message="Трата удалена" action={{ label: 'Отменить', onClick: () => {} }} countdownMs={5000} onClose={() => {}} />)
    expect(html).toMatch(/^<div class="ck-snackbar" role="status" aria-live="polite" aria-atomic="true"><span class="ck-snackbar-message">Трата удалена<\/span><button type="button" class="ck-snackbar-action">Отменить<\/button>/)
    // The bar of the countdown runs the time of the action; a picture only.
    expect(html).toContain('<span class="ck-snackbar-count" aria-hidden="true" style="--ck-snackbar-countdown:5000ms"></span>')
  })

  it('has no bar without a countdown and no button without an action', () => {
    const html = renderToStaticMarkup(<Snackbar message="Сохранено" onClose={() => {}} />)
    expect(html).toBe('<div class="ck-snackbar" role="status" aria-live="polite" aria-atomic="true"><span class="ck-snackbar-message">Сохранено</span></div>')
  })
})

describe('the time of a snackbar (pure)', () => {
  it('waits for the countdown, closes a plain message after 4 s and leaves an action without a countdown to its owner', () => {
    expect(snackbarLifetime(5000, true)).toBe(5000)
    expect(snackbarLifetime(5000, false)).toBe(5000)
    expect(snackbarLifetime(undefined, false)).toBe(SNACKBAR_PLAIN_MS)
    expect(SNACKBAR_PLAIN_MS).toBe(4000)
    expect(snackbarLifetime(undefined, true)).toBeUndefined()
    for (const nonsense of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) expect(snackbarLifetime(nonsense, true)).toBeUndefined()
  })
})

describe('Snackbar.css (text of the rules, not rendering)', () => {
  it('stands over the bars of the phone on the layer of a toast', () => {
    expect(css).toContain('bottom: calc(var(--ck-bottom-occupied) + var(--ck-space-2));')
    expect(css).toContain('z-index: var(--ck-z-toast);')
    expect(css).toContain('background: var(--ck-ink); color: var(--ck-paper);')
    expect(css).toContain('color: var(--ck-inv-action);')
  })

  it('runs the bar on iOS only, and only for a person who has not asked for less motion', () => {
    const motion = '@media (prefers-reduced-motion: no-preference) {'
    expect(css.split(motion)).toHaveLength(2)
    expect(css.slice(0, css.indexOf(motion))).not.toMatch(/animation|transition|@keyframes/)
    expect(css).toContain('.ck-snackbar-count { display: none; }')
    expect(css.slice(css.indexOf(motion))).toContain(':root[data-platform="ios"] .ck-snackbar-count {')
  })

  it('writes no colour, reads only tokens of the theme (and the time of its own countdown), sizes text by the scale', () => {
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|\b(?:rgb|hsl)a?\(/i)
    const defined = new Set([...tokens.matchAll(/^\s*(--ck-[a-z0-9-]+):/gm)].map((match) => match[1]))
    const used = [...new Set([...css.matchAll(/var\((--[a-z0-9-]+)/g)].map((match) => match[1]))]
    expect(used.filter((name) => !defined.has(name))).toEqual(['--ck-snackbar-countdown'])
    for (const [, size] of css.matchAll(/font-size:\s*([^;]+);/g)) expect(size).toMatch(/^var\(--ck-text-[a-z-]+\)$/)
  })
})
