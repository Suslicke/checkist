import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const css = read('./Dashboard.css').replace(/\/\*[\s\S]*?\*\//g, '')
const tokens = read('../../theme/tokens.css')
const block = (selector: string) => {
  const start = tokens.indexOf(`\n${selector} {`)
  return tokens.slice(start, tokens.indexOf('\n}', start))
}
const names = (text: string) => new Set([...text.matchAll(/^\s*(--ck-[a-z0-9-]+):/gm)].map((match) => match[1]))
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].flatMap((match) => match[1].split(',').map((selector) => ({ selector: selector.trim(), body: match[2] })))
const body = (selector: string) => rules.filter((rule) => rule.selector === selector).map((rule) => rule.body).join(' ')

describe('«Главная» and «Лимиты» styles (text of the rules, not rendering)', () => {
  it('reads only theme tokens, each defined for the dark theme and, for colours, again for the light one', () => {
    const dark = new Set(names(block(':root')))
    // Sizes, fonts and the tooth of the tape are the same in both themes: only colours come again for the light one.
    const light = new Set([...names(block(':root[data-theme="light"]')), ...[...dark].filter((name) => /^--ck-(text-(xs|sm|base|lg|xl|hero)|font-|tape-)/.test(name))])
    const used = [...new Set([...css.matchAll(/var\((--ck-[a-z0-9-]+)/g)].map((match) => match[1]))]
    expect(used.filter((name) => !dark.has(name))).toEqual([])
    expect(used.filter((name) => !light.has(name) && !name.startsWith('--ck-radius'))).toEqual([])
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/i)
  })
  it('has the family-budget tokens in both themes', () => {
    const contract = [...Array.from({ length: 6 }, (_, index) => [`--ck-cat-${index + 1}`, `--ck-cat-${index + 1}-tint`]).flat(),
      '--ck-over-text', '--ck-over-bar', '--ck-track', '--ck-on-accent']
    for (const selector of [':root', ':root[data-theme="light"]']) {
      const defined = names(block(selector))
      expect(contract.filter((name) => !defined.has(name)), selector).toEqual([])
    }
  })
  it('gives each of the six category colours its class, and a neutral one', () => {
    for (let tone = 1; tone <= 6; tone += 1) {
      expect(body(`.dash-cat-${tone}`)).toBe(` --dash-cat: var(--ck-cat-${tone}); --dash-cat-tint: var(--ck-cat-${tone}-tint); `)
    }
    expect(body('.dash-cat-0')).toContain('--dash-cat: var(--ck-text-muted)')
  })
  it.each(['.dash-total', '.dash-value', '.dash-limit-value', '.limits-current', '.dash-action', '.dash-chip', '.limits-input-currency', '.dash-sub-count', '.dash-sub-hint',
    '.dash-plain-value', '.dash-days', '.cat-spends-month', '.cat-part-amount', '.cat-spend-amount'])(
    'keeps the value %s on one line', (selector) => {
      expect(body(selector)).toContain('white-space: nowrap')
    })
  it('keeps touch targets at 44 px, the big actions at 64 px and the overspend in its own colours', () => {
    // The round steps of a month are the .ck-round control of the shell (App.css, 44 px).
    expect(read('../../App.css')).toMatch(/\.ck-round \{[^}]*width: 44px; height: 44px;/)
    expect(body('.ck-panel-head > .dash-card-link')).toContain('min-height: 44px')
    expect(body('.dash-chip')).toContain('min-height: 44px')
    expect(body('.dash-sub-toggle')).toContain('min-height: 44px')
    expect(body('.dash-limit-link')).toContain('min-height: 44px')
    expect(body('.dash-action')).toContain('min-height: 64px')
    expect(body('.dash-empty-action')).toContain('min-height: 52px')
    expect(body('.limits-save')).toContain('min-height: 56px')
    expect(body('.dash-over')).toContain('color: var(--ck-over-text)')
    expect(body('.dash-limit-spent-over')).toContain('color: var(--ck-over-text)')
    expect(body('.dash-bar-over .dash-bar-fill')).toContain('background: var(--ck-over-bar)')
    expect(body('.dash-bar')).toContain('background: var(--ck-track)')
    // «Снять чек» on the fill of the main action, «Трата» an outline in the colour of links (the artifact).
    expect(body('.dash-action-shot')).toContain('background: var(--ck-primary); color: var(--ck-on-primary);')
    expect(body('.dash-action')).toContain('border: 1.5px solid var(--ck-link);')
  })
  it('draws letters on a category tint in the main text colour, never in the category colour', () => {
    for (const selector of ['.dash-avatar', '.dash-badge', '.cat-spend-badge']) {
      expect(body(selector), selector).toContain('background: var(--dash-cat-tint);')
      expect(body(selector), selector).toContain('color: var(--ck-text);')
      expect(body(selector), selector).not.toMatch(/(^|[;\s])color: var\(--dash-cat\)/)
    }
  })
  it('keeps «spent / limit» on one line at the right and lets the name take the rest', () => {
    expect(body('.dash-limit-head')).not.toContain('flex-wrap')
    expect(body('.dash-limit-value')).toContain('margin-left: auto;')
    expect(body('.dash-limit-value')).toContain('white-space: nowrap')
    expect(body('.dash-limit-name')).toContain('overflow-wrap: normal;')
    expect(body('.dash-limit-name')).toContain('min-width: 0;')
  })
  it('uses the single phone breakpoint of the project, two columns on a wide screen, and moves only without reduced motion', () => {
    expect([...css.matchAll(/@media[^{]+/g)].map((match) => match[0].trim())).toEqual(['@media (prefers-reduced-motion: no-preference)', '@media (min-width: 960px)', '@media (max-width: 540px)'])
    const motion = css.slice(css.indexOf('@media (prefers-reduced-motion'), css.indexOf('@media (min-width'))
    expect(css.replace(motion, '')).not.toMatch(/animation|@keyframes|transition/)
    expect(motion).toContain('.dash-slide-forward { animation: dash-slide-forward 200ms ease-out; }')
    expect(motion).toContain('.dash-slide-back { animation: dash-slide-back 200ms ease-out; }')
    // A phone reads one column in the order of the artifact: the money and the actions, the limits, the latest spends.
    expect(body('.dash-column')).toContain('display: contents;')
    expect(body('.dash-column-side > *')).toContain('order: 1;')
    expect(body('.dash-recent')).toContain('order: 2;')
    // On a wide screen «Лимиты» stay the first card of the side column: the income line and the recurring cards follow.
    const wide = css.slice(css.indexOf('@media (min-width: 960px)'), css.indexOf('@media (max-width: 540px)'))
    expect(wide).toContain('.dash-column-side > .dash-limits { order: 0; }')
  })
  it('lays «Лимиты» out in two columns from 960 px only: the list at the left, the history at the right, a row on one line', () => {
    const base = css.slice(0, css.indexOf('@media'))
    const wide = css.slice(css.indexOf('@media (min-width: 960px)'), css.indexOf('@media (max-width: 540px)'))
    const phone = css.slice(css.indexOf('@media (max-width: 540px)'))
    // Below 960 the wrapper is boxless: the phone and 541–959 keep today's one column, gap and 760 px cap.
    expect(base).toContain('\n.limits-main { display: contents; }\n')
    expect(css.match(/\.limits-main/g)).toHaveLength(2)
    expect(body('.limits')).toContain('max-width: 760px;')
    expect(wide).toContain('.limits { max-width: none; grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); align-items: start; }')
    expect(wide).toContain('.limits > .limits-intro, .limits > .limits-back { grid-column: 1 / -1; max-width: 760px; }')
    expect(wide).toContain('.limits-main { display: grid; gap: 16px; min-width: 0; grid-column: 1; }')
    expect(wide).toContain('.limits > .limits-history { grid-column: 2; }')
    // A row of the list: the head at the left, the field and «Удалить» in 16 rem at the right, a message under both.
    expect(wide).toContain('.limits-list .limits-form { grid-template-columns: minmax(0, 1fr) minmax(0, 16rem); align-items: center; column-gap: 16px; }')
    expect(wide).toContain('.limits-list .limits-form > .limits-row-head { grid-column: 1; }')
    expect(wide).toContain('.limits-list .limits-form > .limits-controls { grid-column: 2; }')
    expect(wide).toContain('.limits-list .limits-form > .receipt-field-error, .limits-list .limits-form > .limits-done { grid-column: 1 / -1; }')
    expect((wide.match(/\.limits-list \.limits-form/g) ?? []).length).toBeGreaterThanOrEqual(4)
    // The budget card renders the same form markup and keeps its stacked layout: no unscoped `.limits-form` rule on a wide screen.
    const formSelectors = [...wide.matchAll(/([^{}]+)\{/g)].flatMap((match) => match[1].split(',').map((selector) => selector.trim()))
      .filter((selector) => selector.includes('.limits-form'))
    expect(formSelectors.length).toBeGreaterThanOrEqual(4)
    expect(formSelectors.filter((selector) => !selector.startsWith('.limits-list .limits-form'))).toEqual([])
    expect(wide).not.toContain('.limits-budget')
    // The phone block of «Лимиты» is as it was.
    expect(phone).toContain('.limits-savebar { margin-inline: -16px; padding-inline: 16px; }')
    expect(phone).toContain('.limits-row { padding: 14px 16px; }')
    expect(phone).not.toContain('limits-main')
  })
  it('sizes text only by the tokens of the type scale, a field never under 16 px', () => {
    const sizes = [...css.matchAll(/font-size:\s*([^;]+);/g)].map((match) => match[1].trim())
    expect(sizes.filter((size) => !/^var\(--ck-text-(xs|sm|base|lg|xl|hero)\)$/.test(size))).toEqual([])
    expect(body('.limits-input input')).toContain('font-size: var(--ck-text-lg)')
    expect(body('.limits-add-row input')).toContain('font-size: var(--ck-text-base)')
  })
  it('keeps the focus ring of a recent spend outside of its row, inside of the card', () => {
    expect(body('.dash-recent-item:focus-visible')).toBe(' outline-offset: 2px; ')
  })
})
