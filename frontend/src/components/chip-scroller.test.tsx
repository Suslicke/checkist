import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import ChipScroller from './ChipScroller'
import { chipEdges } from './chip-edges'

const css = readFileSync(new URL('./ChipScroller.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const tokens = readFileSync(new URL('../theme/tokens.css', import.meta.url), 'utf8')

describe('edges of a chip row (pure, no browser)', () => {
  it('fades nothing when everything fits', () => {
    expect(chipEdges(0, 320, 320)).toEqual({ start: false, end: false })
    expect(chipEdges(0, 320, 321)).toEqual({ start: false, end: false })
  })

  it('fades the end at the start of a long row, both in the middle, the start at its end', () => {
    expect(chipEdges(0, 320, 900)).toEqual({ start: false, end: true })
    expect(chipEdges(200, 320, 900)).toEqual({ start: true, end: true })
    expect(chipEdges(580, 320, 900)).toEqual({ start: true, end: false })
    // Fractional widths of a zoomed page leave a remainder under a pixel.
    expect(chipEdges(579.5, 320, 900)).toEqual({ start: true, end: false })
  })

  it('reads a right-to-left position by its size', () => {
    expect(chipEdges(-200, 320, 900)).toEqual({ start: true, end: true })
  })
})

describe('markup of the chip row (Node server render)', () => {
  const html = renderToStaticMarkup(
    <ChipScroller label="Месяцы"><button type="button" className="ck-chip" aria-pressed="true">Октябрь</button><button type="button" className="ck-chip">Сентябрь</button></ChipScroller>,
  )

  it('is a named scroll region that the keyboard reaches, with the chips in one row', () => {
    expect(html).toBe('<div class="ck-chip-scroller"><div class="ck-chip-scroller-track" role="region" aria-label="Месяцы" tabindex="0">'
      + '<button type="button" class="ck-chip" aria-pressed="true">Октябрь</button><button type="button" class="ck-chip">Сентябрь</button></div></div>')
  })

  it('takes a class of the screen beside its own', () => {
    expect(renderToStaticMarkup(<ChipScroller label="Фильтры" className="spends-active"><span /></ChipScroller>))
      .toContain('<div class="ck-chip-scroller spends-active">')
  })
})

describe('ChipScroller.css (text of the rules, not rendering)', () => {
  it('keeps the chips in one row that scrolls sideways', () => {
    expect(css).toMatch(/\.ck-chip-scroller-track \{[^}]*flex-wrap: nowrap;[^}]*overflow-x: auto;/)
    expect(css).toContain('.ck-chip-scroller-track > * { flex: none; }')
  })

  it('fades an edge by a mask of the fade token, only while chips hide behind it', () => {
    expect(css).toContain('.ck-chip-scroller[data-fade-start] { --ck-chip-fade-start: var(--ck-fade-size); }')
    expect(css).toContain('.ck-chip-scroller[data-fade-end] { --ck-chip-fade-end: var(--ck-fade-size); }')
    expect(css).toContain('-webkit-mask-image: linear-gradient(')
    expect(css).toMatch(/\n\s*mask-image: linear-gradient\(/)
  })

  it('keeps a chip low (32 px, 34 px on iOS) but a tap-tall target that never wraps, the selected one filled with ink', () => {
    const chip = /\.ck-chip \{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(chip).toContain('position: relative;')
    expect(chip).toContain('min-height: 32px;')
    expect(chip).toContain('white-space: nowrap;')
    expect(chip).toContain('font-size: var(--ck-text-label);')
    // The touch target: the ::before reaches above and below the chip to a tap (48 px, 44 px on iOS).
    expect(css).toContain('.ck-chip::before { content: ""; position: absolute; inset: min(0px, calc((100% - var(--ck-tap)) / 2)) 0; }')
    expect(css).toContain(':where(:root[data-platform="ios"]) .ck-chip { min-height: 34px;')
    // Selected — ink, the text paper (the choice is ink, the action is seal); Android adds a check mark.
    expect(css).toContain('.ck-chip[aria-pressed="true"], .ck-chip[aria-current]:not([aria-current="false"]), .ck-chip[aria-checked="true"] { border-color: var(--ck-ink); background: var(--ck-ink); color: var(--ck-paper); }')
    expect(css).toContain(':where(:root:not([data-platform="ios"])) .ck-chip[aria-pressed="true"]::after')
  })

  it('writes no colour and reads only tokens that the theme defines', () => {
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|\b(?:rgb|hsl)a?\(/i)
    const defined = new Set([...tokens.matchAll(/^\s*(--ck-[a-z0-9-]+):/gm)].map((match) => match[1]))
    const local = new Set(['--ck-chip-fade-start', '--ck-chip-fade-end'])
    const used = [...new Set([...css.matchAll(/var\((--[a-z0-9-]+)/g)].map((match) => match[1]))]
    expect(used.filter((name) => !defined.has(name) && !local.has(name))).toEqual([])
    // Text sizes only by the scale; a change of state only under reduced motion: no-preference; no animation.
    for (const [, size] of css.matchAll(/font-size:\s*([^;]+);/g)) expect(size).toMatch(/^var\(--ck-text-[a-z-]+\)$/)
    expect(css).not.toMatch(/animation|@keyframes/)
    const motion = '@media (prefers-reduced-motion: no-preference) {'
    expect(css.slice(0, css.indexOf(motion))).not.toContain('transition')
  })
})
