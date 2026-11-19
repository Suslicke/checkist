import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = new URL('../', import.meta.url)
const raw = (path: string) => readFileSync(new URL(path, source), 'utf8')
const strip = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '')
const app = strip(raw('App.css'))
const tokensSource = raw('theme/tokens.css')
const tokens = strip(tokensSource)

const rules = (text: string) => [...text.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .flatMap((match) => match[1].split(',').map((selector) => ({ selector: selector.trim(), body: match[2].trim() })))
const rule = (selector: string, text: string) => rules(text).filter((item) => item.selector === selector).map((item) => item.body).join(' ')

const phone = '@media (max-width: 540px) {'
const block = (query: string) => app.slice(app.indexOf(query) + query.length).split('\n}')[0]
const narrow = block(phone)
const wide = app.slice(0, app.indexOf('@media'))
/** The utilities after the theme blocks of tokens.css, to its end (the LEGACY aliases of 1.x are gone). */
const utilities = strip(tokensSource.slice(tokensSource.indexOf('\n.ck-figures {')))

describe('utilities of the mobile design in tokens.css (text of the rules, not rendering)', () => {
  it('draws figures in the display font of sums, in columns, never broken (Чекист 2.0)', () => {
    expect(rule('.ck-figures', utilities)).toBe('font-family: var(--ck-font-display); font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap;')
  })

  it('draws the hero sum in the display font at the hero size, no wider than the window allows', () => {
    const hero = rule('.ck-hero-figure', utilities)
    expect(hero).toContain('font-family: var(--ck-font-display);')
    expect(hero).toContain('font-size: min(var(--ck-text-money-hero), 11vw);')
    expect(hero).toContain('font-weight: 600;')
    expect(hero).toContain('font-variant-numeric: tabular-nums;')
    expect(hero).toContain('white-space: nowrap;')
  })

  it('puts the dotted leader before the last child of the row, in the colour of secondary text', () => {
    expect(rule('.ck-leader', utilities)).toContain('display: flex;')
    expect(rule('.ck-leader > :last-child', utilities)).toBe('order: 2; flex: none; white-space: nowrap;')
    const dots = rule('.ck-leader::before', utilities)
    expect(dots).toContain('order: 1;')
    expect(dots).toContain('var(--ck-ink-2)')
  })

  it('tears the bottom of a tape card by a mask only where masks work: elsewhere it is a plain card', () => {
    const supports = '@supports (mask-repeat: repeat-x) or (-webkit-mask-repeat: repeat-x) {'
    expect(tokens.split(supports)).toHaveLength(2)
    const start = tokens.indexOf(supports)
    const tape = tokens.slice(start, tokens.indexOf('\n}\n', start) + 2)
    expect(tape).toContain('-webkit-mask: conic-gradient(')
    expect(tape).toMatch(/\n\s*mask: conic-gradient\(/)
    expect(tape).toContain('var(--ck-tape-tooth)')
    // Outside of @supports no rule names the tape: without masks nothing changes.
    expect(tokens.slice(0, tokens.indexOf(supports))).not.toContain('.ck-tape')
    // A mask has no colour of its own: it works on every background of both themes.
    expect(tape).not.toMatch(/var\(--ck-(bg|surface)/)
  })

  it('writes no colour value in the utilities', () => {
    expect(utilities).toContain(':where(.ck-panel)')
    expect(utilities).not.toMatch(/#[0-9a-f]{3,8}\b|\b(?:rgb|hsl)a?\(/i)
  })

  it('draws the bricks of 2.0: a panel with a line and no shadow, a category tile in its tone, a stamp, a limit bar', () => {
    const panel = rule(':where(.ck-panel)', utilities)
    expect(panel).toContain('border: 1px solid var(--ck-line);')
    expect(panel).toContain('border-radius: var(--ck-radius-card);')
    expect(panel).not.toContain('shadow')
    const badge = rule(':where(.ck-row-badge)', utilities)
    expect(badge).toContain('background: color-mix(in srgb, var(--ck-tone, var(--ck-ink-2)) 15%, var(--ck-surface));')
    expect(badge).toContain('color: var(--ck-tone, var(--ck-ink-2));')
    for (let tone = 1; tone <= 6; tone += 1) expect(rule(`:where(.ck-tone-${tone})`, utilities)).toBe(`--ck-tone: var(--ck-cat-${tone});`)
    expect(rule(':where(.ck-stamp)', utilities)).toContain('border: 1px solid var(--ck-line);')
    expect(rule(':where(.ck-bar > span)', utilities)).toContain('background: var(--ck-ink);')
    expect(rule(':where(.ck-bar.is-near > span)', utilities)).toBe('background: var(--ck-over-bar);')
    expect(rule(':where(.ck-bar.is-over > span)', utilities)).toBe('background: var(--ck-over-bar);')
    // Every brick weighs nothing: a class of a screen may still change it. No comma inside :where().
    for (const item of rules(utilities).filter((entry) => /ck-(panel|list|row|stamp|bar|stack|tone)/.test(entry.selector))) {
      expect(item.selector.startsWith(':where('), item.selector).toBe(true)
    }
  })
})

describe('text sizes go through the scale (mobile design 2026-10-12, text of the rules)', () => {
  const files = (readdirSync(source, { recursive: true }) as string[]).map((path) => path.replaceAll('\\', '/'))
  // The type scale of Чекист 2.0 (tokens.css): rem sizes by role.
  const scale = /^(?:var\(--ck-text-(?:caption|label|body|field|title|heading|money-display|title-large|money-hero)\)|max\(var\(--ck-text-field\), 1em\)|min\(var\(--ck-text-money-hero\), 11vw\)|0\.7em|0\.82em)$/

  it('sizes every text of the new shared parts by a token of the scale', () => {
    // The LEGACY aliases of tokens.css are not sizes: only the rules are checked. 0.7em and 0.82em are the kopecks and the
    // currency sign of a sum, relative to its own size (README «Деньги»).
    const rulesOf = (path: string) => strip(raw(path)).replace(/^\s*--ck-[a-z0-9-]+:[^;]*;/gm, '')
    for (const path of ['components/Sheet.css', 'components/ChipScroller.css', 'components/ResponsiveFilters.css', 'theme/tokens.css', 'App.css']) {
      for (const [, size] of rulesOf(path).matchAll(/font-size:\s*([^;]+);/g)) expect(size.trim(), path).toMatch(scale)
    }
  })

  it('sizes the rules of the phone block by the scale too (the shell moves to shell.css with its own guards)', () => {
    const shell = /brand|intro|main-|section-navigation|ck-back|ck-round|footer|ck-theme-toggle-header/
    const sizes = rules(narrow).filter((item) => !shell.test(item.selector))
      .flatMap((item) => [...item.body.matchAll(/font-size:\s*([^;]+);/g)].map((match) => [item.selector, match[1].trim()]))
    expect(sizes.length).toBeGreaterThan(0)
    expect(sizes.filter(([, size]) => !scale.test(size)).map(([selector, size]) => `${selector}: ${size}`)).toEqual([])
  })

  it('moves only in the sheet, the month, the network bar and the skeleton: no other stylesheet of the client has an animation', () => {
    const moving = files.filter((path) => path.endsWith('.css') && !/(^|[/-])preview\//.test(path) && /@keyframes/.test(strip(raw(path))))
    // The plan allows two motions: the sheet and the change of a month on «Главная»; loading in parts (2026-10-13) adds
    // the running segment of the network bar and the pulse of a skeleton; Чекист 2.0 (contract §4) adds the move between
    // screens (View Transitions, shell.css), the action sheet of a confirmation, the countdown of the undo toast and the
    // print of a receipt slip with its stamp, once after recognition (features/receipts).
    expect(moving.sort()).toEqual(['components/ConfirmDialog.css', 'components/NetworkBar.css', 'components/Sheet.css', 'components/Skeleton.css',
      'components/Snackbar.css', 'features/dashboard/Dashboard.css', 'features/receipts/Receipts.css', 'shell.css'])
  })

  it('moves only without reduced motion: every keyframe and animation of the client stands in that media block', () => {
    const motion = '@media (prefers-reduced-motion: no-preference)'
    /** The text of a stylesheet without its blocks of motion (balanced braces). */
    const still = (text: string) => {
      let rest = text
      for (let at = rest.indexOf(motion); at >= 0; at = rest.indexOf(motion)) {
        let end = rest.indexOf('{', at) + 1
        for (let depth = 1; depth > 0 && end < rest.length; end += 1) depth += rest[end] === '{' ? 1 : rest[end] === '}' ? -1 : 0
        rest = rest.slice(0, at) + rest.slice(end)
      }
      return rest
    }
    const sheets = files.filter((path) => path.endsWith('.css') && !/(^|[/-])preview\//.test(path))
    const loose = sheets.filter((path) => /@keyframes|(^|[;{\s])animation(-name)?\s*:/.test(still(strip(raw(path)))))
    expect(loose).toEqual([])
  })
})

describe('controls and the top bar of a phone (text of the rules, not rendering)', () => {
  it('makes the fields of a page a tap tall (48 px, 44 px on iOS) and never smaller than 16 px, weightless before a screen class', () => {
    const field = 'main :where(input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="file"]))'
    expect(rule(field, narrow)).toBe('min-height: var(--ck-tap); font-size: max(var(--ck-text-field), 1em);')
    expect(rule('main :where(select)', narrow)).toBe(rule(field, narrow))
    expect(rule('main :where(textarea)', narrow)).toBe(rule(field, narrow))
    expect(rule('main :where(button)', narrow)).toBe('min-height: var(--ck-tap);')
    // The tap is 48 px (Android and a computer) and 44 px on iOS (platforms.md).
    expect(tokens).toMatch(/:root \{[^}]*--ck-tap: 48px;/)
    expect(rule(':root[data-platform="ios"]', tokens)).toBe('--ck-tap: 44px;')
  })

  it('gives every field of 2.0 the surface, a strong line, the corner of a field and 16 px, as weak as the element', () => {
    const field = 'input:where(:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="file"]):not([type="color"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="image"]))'
    const look = 'min-height: var(--ck-tap); padding: 10px 12px; border: 1px solid var(--ck-line-strong); border-radius: var(--ck-radius-field); background: var(--ck-surface); color: var(--ck-ink); font-size: var(--ck-text-field);'
    expect(rule(field, wide)).toBe(look)
    for (const element of ['select', 'textarea']) expect(rules(wide).filter((item) => item.selector === element).map((item) => item.body), element).toContain(look)
    // A checkbox, a radio and the switch keep their own box: the look never reaches them.
    expect(field).toContain(':not([type="checkbox"]):not([type="radio"])')
  })

  it('keeps the general focus ring for a text area too', () => {
    expect(rule('textarea:focus-visible', app)).toBe('outline: 2px solid var(--ck-focus); outline-offset: 2px;')
  })

  it('gives buttons a tonal look, a ghost look and a quiet danger look: an outline in the error colour, never a fill', () => {
    expect(rule('button', wide)).toContain('background: var(--ck-seal); color: var(--ck-on-seal);')
    expect(rule('button', wide)).toContain('min-height: var(--ck-tap);')
    expect(rule('.ck-button-secondary', wide)).toBe('border-color: transparent; background: var(--ck-surface-2); color: var(--ck-ink);')
    expect(rule('.ck-button-ghost', wide)).toBe('border-color: transparent; background: transparent; color: var(--ck-seal-ink);')
    const danger = 'border-color: var(--ck-error); background: transparent; color: var(--ck-error);'
    expect(rule('.ck-button-danger', wide)).toBe(danger)
    expect(rule('.expense-danger', wide)).toBe(danger)
    expect(rule('.expense-danger:where(:active:not(:disabled))', wide)).toBe('border-color: var(--ck-error); background: var(--ck-error-soft); color: var(--ck-error);')
    expect(rule('.action-link', wide)).toContain('background: var(--ck-surface-2); color: var(--ck-ink);')
    expect(rule('.action-link.ck-btn-primary', wide)).toBe('border-color: var(--ck-seal); background: var(--ck-seal); color: var(--ck-on-seal);')
  })

  it('presses by a squeeze to 97 % only without reduced motion, dims on iOS, hovers only where a pointer hovers', () => {
    const motion = block('@media (prefers-reduced-motion: no-preference) {')
    expect(rule('button:where(:active:not(:disabled))', motion)).toBe('transform: scale(0.97);')
    expect(rule('button', motion)).toContain('var(--ck-dur-press)')
    expect(wide).not.toMatch(/transition|transform: scale/)
    expect(rule(':where(:root[data-platform="ios"]) button:where(:active:not(:disabled))', wide)).toBe('opacity: 0.55;')
    const hover = block('@media (hover: hover) {')
    expect(rule('button:where(:hover:not(:disabled))', hover)).toBe('border-color: var(--ck-seal-press); background: var(--ck-seal-press);')
    expect(rules(wide).filter((item) => /:hover/.test(item.selector) && !/brand|main-|section-navigation|ck-chat-link|ck-round/.test(item.selector))).toEqual([])
  })

  // «Назад», «✕», the round controls of a page, the pinned top bar and the bottom bar are the shell of Чекист 2.0
  // (src/shell.css): their guards — targets of a tap, safe areas, layers, the current section not by colour alone —
  // live in menu/menu-css.test.ts.

  it('draws the action slot of an empty or failed state as a row that a phone stretches', () => {
    expect(rule('.request-state-action', wide)).toContain('display: flex;')
    expect(rule('.request-state-action > :where(button)', narrow)).toBe('flex: 1 1 100%;')
  })
})
