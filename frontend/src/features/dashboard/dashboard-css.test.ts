import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const css = read('./Dashboard.css').replace(/\/\*[\s\S]*?\*\//g, '')
const tokens = read('../../theme/tokens.css')
/** The tokens of Чекист 2.0: everything defined before the trailing LEGACY block of the names of 1.x. */
const current = tokens.slice(0, tokens.indexOf('LEGACY:'))
const legacy = tokens.slice(tokens.indexOf('LEGACY:'))
const names = (text: string) => new Set([...text.matchAll(/^\s*(--ck-[a-z0-9-]+):/gm)].map((match) => match[1]))
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].flatMap((match) => match[1].split(',').map((selector) => ({ selector: selector.trim(), body: match[2] })))
const body = (selector: string) => rules.filter((rule) => rule.selector === selector).map((rule) => rule.body).join(' ')
const block = (start: string, end?: string) => css.slice(css.indexOf(start), end ? css.indexOf(end) : undefined)

describe('«Главная», «Лимиты» and «Траты категории» styles of Чекист 2.0 (text of the rules, not rendering)', () => {
  it('reads only the tokens of 2.0, never a name of 1.x or a colour of its own', () => {
    const defined = names(current)
    const used = [...new Set([...css.matchAll(/var\((--ck-[a-z0-9-]+)/g)].map((match) => match[1]))]
    expect(used.length).toBeGreaterThan(20)
    // --ck-tone is the tone of a category tile, set by the .ck-tone-N bricks of tokens.css.
    expect(tokens).toContain(':where(.ck-tone-1) { --ck-tone: var(--ck-cat-1); }')
    expect(used.filter((name) => !defined.has(name) && name !== '--ck-tone')).toEqual([])
    // Not one alias of the LEGACY block is read here.
    expect(used.filter((name) => names(legacy).has(name) && !defined.has(name))).toEqual([])
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/i)
    // The tone of a category is the --ck-tone of the bricks (.ck-tone-N, tokens.css), no colour classes of its own.
    expect(css).not.toMatch(/\.dash-cat-\d|--dash-cat/)
    expect(body('.dash-legend-swatch')).toContain('background: var(--ck-tone, var(--ck-ink-2));')
    expect(body('.dash-limit-dot')).toContain('background: var(--ck-tone, var(--ck-ink-2));')
  })

  it('keeps money calm: spending in ink, the over tone only with words, gold only for the assistant and a goal reached', () => {
    // No seal on the screen of the month: the «＋» of the bar is its one main action.
    expect(css).not.toMatch(/var\(--ck-seal\)/)
    expect(body('.dash-pace-spent')).toContain('background: var(--ck-ink);')
    expect(body('.is-near .dash-pace-spent')).toContain('background: var(--ck-over-bar);')
    expect(body('.is-over .dash-pace-spent')).toContain('background: var(--ck-over-bar);')
    expect(body('.dash-pace-words')).toContain('color: var(--ck-over);')
    expect(body('.dash-limit-note.is-over')).toContain('color: var(--ck-over);')
    expect(body('.ck-row-meta.is-over')).toContain('color: var(--ck-over);')
    expect(body('.dash-amount-caption.is-over')).toContain('color: var(--ck-over);')
    const gold = rules.filter((rule) => /--ck-gold/.test(rule.body)).map((rule) => rule.selector)
    expect(gold.sort()).toEqual(['.dash-attention-badge.is-ai', '.dash-tile.is-reached .dash-mini-part.is-on', '.dash-tile.is-reached .dash-tile-note'])
    expect(body('.dash-mini-part.is-on')).toContain('background: var(--ck-ink);')
    expect(body('.dash-pulse-today')).toContain('background: var(--ck-ink);')
  })

  it.each(['.dash-limit-value', '.limits-current', '.limits-input-currency', '.dash-sub-count', '.dash-sub-hint', '.dash-ring-value', '.dash-tile-value',
    '.cat-spends-month', '.cat-part-amount', '.dash-limit-note', '.dash-pace-key', '.dash-amount-caption', '.dash-total', '.cat-spend-whole', '.dash-hero-label',
    '.dash-recent-meta-text', '.dash-legend-name', '.dash-limit-name'])(
    'keeps the value %s on one line', (selector) => {
      expect(body(selector)).toContain('white-space: nowrap')
    })

  it('keeps every target of a tap at the size of the platform', () => {
    // The round steps of a month are the .ck-round control of the shell, 36 px to the eye with the full target around them.
    expect(read('../../shell.css')).toMatch(/\.ck-round \{[^}]*width: var\(--ck-tap\); height: var\(--ck-tap\);/)
    expect(body('.dash-month-steps .dash-month-step')).toContain('width: 36px; height: 36px;')
    expect(body('.dash-month-step::before')).toContain('inset: min(0px, calc((36px - var(--ck-tap)) / 2));')
    expect(body('.ck-icon-button.dash-privacy::before')).toContain('inset: min(0px, calc((36px - var(--ck-tap)) / 2));')
    for (const selector of ['.ck-panel-head > .dash-card-link', '.dash-sub-toggle', '.dash-limit-link', '.dash-tile', '.dash-hero-pick', '.cat-crumbs a', '.cat-part',
      '.limits-toggle', '.limits-input input']) {
      expect(body(selector), selector).toContain('min-height: var(--ck-tap)')
    }
    expect(body('.home-figure-option')).toContain('min-height: 60px')
    expect(body('.dash-limits-empty')).toContain('min-height: 60px')
    expect(body('.limits-save')).toContain('min-height: 52px')
  })

  it('never widens a phone: the names give way with an ellipsis, the toggle of sub-categories stays inside its row', () => {
    for (const selector of ['.dash-limit-name', '.dash-sublimit-name', '.dash-legend-name', '.dash-hero-label', '.cat-part-name', '.dash-sub-hint']) {
      expect(body(selector), selector).toContain('min-width: 0')
      expect(body(selector), selector).toContain('text-overflow: ellipsis')
    }
    expect(body('.dash-sub-toggle')).toContain('max-width: 100%; min-width: 0;')
    expect(body('.dash-sub-toggle')).toMatch(/margin: calc\(-1 \* var\(--ck-space-3\)\) 0 calc\(-1 \* var\(--ck-space-3\)\);/)
    expect(body('.dash-limit-head')).not.toContain('flex-wrap')
    expect(body('.dash-limit-value')).toContain('margin-left: auto;')
    // The long sentences of «Требует внимания» take two lines instead of pushing the sum away.
    expect(body('.dash-attention-row .ck-row-title')).toContain('-webkit-line-clamp: 2;')
  })

  it('draws the main number, the ring, the pulse and the tiles by the tokens of the direction', () => {
    expect(body('.dash-hero-figure')).toContain('font-size: min(var(--ck-text-money-hero), 11vw);')
    expect(body('.dash-hero-wait')).toContain('background: var(--ck-skeleton);')
    expect(body('.dash-pace-ahead')).toContain('repeating-linear-gradient(-45deg, var(--ck-ink-2) 0 2px, transparent 2px 5px)')
    expect(body('.dash-pace-today')).toContain('left: var(--x);')
    expect(body('.dash-ring-wrap')).toContain('grid-template-columns: 132px minmax(0, 1fr);')
    expect(body('.dash-pulse')).toContain('height: 44px;')
    expect(body('.dash-pulse-future')).toContain('height: 3px; background: var(--ck-track);')
    expect(body('.dash-pulse-average')).toContain('border-top: 1.5px dashed var(--ck-ink-2);')
    expect(body('.dash-legend-rest .dash-legend-swatch')).toContain('background: var(--ck-track);')
    expect(body('.dash-tiles')).toContain('grid-template-columns: repeat(3, minmax(0, 1fr));')
    expect(body('.dash-tile')).toContain('border: 1px solid var(--ck-line);')
    expect(body('.dash-tile')).not.toContain('shadow')
    expect(body('.dash-mini')).toContain('height: 5px;')
    // The ring itself is a chart of lib/charts: its colours are the category tokens there.
    const charts = read('../../lib/charts/Charts.css')
    for (let tone = 1; tone <= 6; tone += 1) expect(charts).toMatch(new RegExp(`\\.ck-ring-tone-${tone} \\{[^}]*var\\(--ck-cat-${tone}\\)`))
  })

  it('draws letters and pictures on a category tint in ink, never in the colour of the category alone', () => {
    expect(body('.dash-avatar')).toContain('background: color-mix(in srgb, var(--ck-tone, var(--ck-ink-2)) 22%, var(--ck-surface));')
    expect(body('.dash-avatar')).toContain('color: var(--ck-ink);')
  })

  it('uses the single phone breakpoint of the project, two columns on a wide screen, and moves only without reduced motion', () => {
    expect([...css.matchAll(/@media[^{]+/g)].map((match) => match[0].trim())).toEqual(['@media (prefers-reduced-motion: no-preference)', '@media (min-width: 960px)', '@media (max-width: 540px)'])
    const motion = block('@media (prefers-reduced-motion', '@media (min-width')
    expect(css.replace(motion, '')).not.toMatch(/animation|@keyframes|transition/)
    expect(motion).toContain('.dash-slide-forward { animation: dash-slide-forward 200ms var(--ck-ease-out); }')
    expect(motion).toContain('.dash-slide-back { animation: dash-slide-back 200ms var(--ck-ease-out); }')
    // A phone reads one column: the number, the attention, the spends, the tiles, the ring, the limits.
    expect(body('.dash-column')).toContain('display: contents;')
    expect(body('.dash-attention')).toContain('order: 1;')
    expect(body('.dash-recent')).toContain('order: 2;')
    expect(body('.dash-column-side > *')).toContain('order: 3;')
    expect(body('.dash-where')).toContain('order: 4;')
    expect(body('.dash-column-side > .dash-limits')).toContain('order: 5;')
    // On a wide screen «Лимиты» are the first card of the side column, the tiles under them.
    const wide = block('@media (min-width: 960px)', '@media (max-width: 540px)')
    expect(wide).toContain('.dash-column-side > .dash-limits { order: 0; }')
    expect(wide).toContain('.dash-column-side > .dash-tiles { order: 1; }')
    expect(wide).toContain('.dash-column { display: grid; gap: var(--ck-space-3); min-width: 0; }')
  })

  it('lays «Лимиты» out in two columns from 960 px only: the list at the left, the history at the right, a row on one line', () => {
    const base = css.slice(0, css.indexOf('@media'))
    const wide = block('@media (min-width: 960px)', '@media (max-width: 540px)')
    const phone = block('@media (max-width: 540px)')
    // Below 960 the wrapper is boxless: the phone and 541–959 keep one column and the 760 px cap.
    expect(base).toContain('\n.limits-main { display: contents; }\n')
    expect(css.match(/\.limits-main/g)).toHaveLength(2)
    expect(body('.limits')).toContain('max-width: 760px;')
    expect(wide).toContain('.limits { max-width: none; grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); align-items: start; }')
    expect(wide).toContain('.limits > .limits-intro, .limits > .limits-back { grid-column: 1 / -1; max-width: 760px; }')
    expect(wide).toContain('.limits-main { display: grid; gap: var(--ck-space-3); min-width: 0; grid-column: 1; }')
    expect(wide).toContain('.limits > .limits-history { grid-column: 2; }')
    expect(wide).toContain('.limits-list .limits-form { grid-template-columns: minmax(0, 1fr) minmax(0, 16rem); align-items: center; column-gap: var(--ck-space-4); }')
    expect(wide).toContain('.limits-list .limits-form > .limits-row-head { grid-column: 1; }')
    expect(wide).toContain('.limits-list .limits-form > .limits-controls { grid-column: 2; }')
    expect(wide).toContain('.limits-list .limits-form > .receipt-field-error, .limits-list .limits-form > .limits-done { grid-column: 1 / -1; }')
    // The budget card renders the same form markup and keeps its stacked layout: no unscoped `.limits-form` rule on a wide screen.
    const formSelectors = [...wide.matchAll(/([^{}]+)\{/g)].flatMap((match) => match[1].split(',').map((selector) => selector.trim()))
      .filter((selector) => selector.includes('.limits-form'))
    expect(formSelectors.length).toBeGreaterThanOrEqual(4)
    expect(formSelectors.filter((selector) => !selector.startsWith('.limits-list .limits-form'))).toEqual([])
    expect(wide).not.toContain('.limits-budget')
    expect(phone).toContain('.limits-savebar { margin-inline: calc(-1 * var(--ck-space-4)); padding-inline: var(--ck-space-4); }')
    expect(phone).not.toContain('limits-main')
  })

  it('sizes text only by the type scale of 2.0, a field never under 16 px', () => {
    const sizes = [...css.matchAll(/font-size:\s*([^;]+);/g)].map((match) => match[1].trim())
    expect(sizes.filter((size) => !/^(var\(--ck-text-(caption|label|body|field|title|heading|money-display|title-large|money-hero)\)|min\(var\(--ck-text-money-hero\), 11vw\)|inherit)$/.test(size))).toEqual([])
    expect(body('.limits-input input')).toContain('font-size: var(--ck-text-field)')
    expect(body('.limits-add-row input')).toContain('font-size: var(--ck-text-field)')
  })

  it('keeps the focus ring of a recent spend outside of its row, inside of the card', () => {
    expect(body('.dash-recent-item:focus-visible')).toBe(' outline-offset: 2px; ')
    // The field of a limit shows the ring of the system around the whole field (the input itself draws none).
    expect(body('.limits-input:has(input:focus-visible)')).toContain('outline: 2px solid var(--ck-focus); outline-offset: 2px;')
  })
})
