import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/* The shell of Чекист 2.0 (src/shell.css): the bars of a phone by platform, the header of a wide screen, the move between
 * pages. Text of the rules, not rendering: the look is checked by a person on the stand (iOS and Android). */
const source = new URL('../', import.meta.url)
const raw = (path: string) => readFileSync(new URL(path, source), 'utf8')
const strip = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '')
const shell = strip(raw('shell.css'))
const app = strip(raw('App.css'))
const tokens = raw('theme/tokens.css')
const html = raw('../index.html')
const actionBar = strip(raw('components/ActionBar.css'))

/** The text inside the braces of the block that starts with `head`. */
const block = (text: string, head: string) => {
  const start = text.indexOf(head)
  expect(start, head).toBeGreaterThan(-1)
  let depth = 0
  for (let index = start + head.length - 1; index < text.length; index += 1) {
    if (text[index] === '{') depth += 1
    if (text[index] === '}') depth -= 1
    if (depth === 0) return text.slice(start + head.length, index)
  }
  return ''
}
/** Flat rules (selector, body) of a text without nested blocks. */
const rules = (text: string) => [...text.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .flatMap((match) => match[1].split(/,(?![^(]*\))/).map((selector) => ({ selector: selector.trim(), body: match[2].trim() })))
const rule = (selector: string, text: string) => rules(text).filter((item) => item.selector === selector).map((item) => item.body).join(' ')

const phone = '@media (max-width: 540px) {'
const barQuery = '@media (max-width: 540px) and (min-width: 340px) and (min-height: 480px) {'
const wideQuery = '@media (min-width: 541px) {'
const motionQuery = '@media (prefers-reduced-motion: no-preference) {'
const bar = block(shell, barQuery)
const narrow = block(shell, phone)
const motion = block(shell, motionQuery)
/** The rules outside of every block. */
const base = shell.slice(0, shell.indexOf('@media'))
const ios = ':root[data-platform="ios"]'
const android = ':root:not([data-platform="ios"])'

describe('where the shell lives (text of the files)', () => {
  it('has its own stylesheet; App.css keeps none of its rules', () => {
    for (const selector of ['.brand-bar', '.main-navigation', '.main-add', '.section-navigation', '.intro', '.ck-round', '.ck-back', '.ck-close', '.ck-chat-link', '.skip-link']) {
      expect(rules(app).some((item) => item.selector.includes(selector)), selector).toBe(false)
      expect(rules(shell).some((item) => item.selector.includes(selector)), selector).toBe(true)
    }
    expect(rules(app).some((item) => /^footer\b/.test(item.selector))).toBe(false)
  })

  it('holds the blocks of the phone, the wide header and the bars, in that order, and the layout tokens only there', () => {
    const queries = [...shell.matchAll(/@media ([^{]+)\{/g)].map((match) => match[1].trim())
    expect(queries.slice(0, 3)).toEqual(['(min-width: 541px)', '(max-width: 540px)', '(max-width: 540px) and (min-width: 340px) and (min-height: 480px)'])
    expect(shell.replace(bar, '')).not.toMatch(/--ck-(bottom-nav|top-bar)-height:/)
    expect(app).not.toMatch(/--ck-(bottom-nav|top-bar)-height:/)
  })

  it('writes no colour and reads only tokens that the theme defines', () => {
    expect(shell).not.toMatch(/#[0-9a-f]{3,8}\b|\b(?:rgb|hsl|hwb|lab|lch|oklab|oklch)a?\(/i)
    const defined = new Set([...tokens.matchAll(/^\s*(--ck-[a-z0-9-]+):/gm)].map((match) => match[1]))
    const used = [...new Set([...shell.matchAll(/var\((--[a-z0-9-]+)/g)].map((match) => match[1]))]
    expect(used.filter((name) => !defined.has(name))).toEqual([])
    // Only the names of Чекист 2.0: none of the 1.x palette.
    expect(shell).not.toMatch(/--ck-(bg|text|text-muted|text-(2xs|xs|sm|base|lg|xl|hero)|brand[-a-z]*|accent[-a-z]*|primary[-a-z]*|link[-a-z]*|border[-a-z]*|divider|header[-a-z]*|nav-bg|fab-shadow|popover-shadow|chip-selected[-a-z]*|surface-raised|on-primary|on-accent)\)/)
  })

  it('sizes every text by a token of the scale (the 11 px words of the iOS bar are a part of the caption)', () => {
    const sizes = [...new Set([...shell.matchAll(/font-size:\s*([^;]+);/g)].map((match) => match[1].trim()))]
    for (const size of sizes) expect(size).toMatch(/^var\(--ck-text-[a-z-]+\)$|^calc\(var\(--ck-text-caption\) \* 11 \/ 12\)$/)
  })
})

describe('the bottom bar of a phone (text of the rules)', () => {
  const nav = rule('.brand-bar .main-navigation', bar)

  it('takes the header strip away: the logo and the actions are not drawn, the strip has no box', () => {
    expect(rule('.brand-bar', bar)).toBe('display: contents;')
    expect(rule('.brand-bar > .brand', bar)).toBe('display: none;')
    expect(rule('.brand-bar > .brand-actions', bar)).toBe('display: none;')
  })

  it('pins the same nav of the header to the bottom of the window, on its own layer, its columns equal', () => {
    expect(nav).toContain('position: fixed;')
    expect(nav).toContain('z-index: var(--ck-z-bottom-nav);')
    expect(nav).toContain('display: grid; grid-auto-columns: minmax(0, 1fr); grid-auto-flow: column;')
    expect(nav).toContain('overflow: visible;')
    expect(rule('.brand-bar .main-navigation :focus-visible', bar)).toContain('outline-color: var(--ck-focus);')
    // Fixed only here: nothing else of the shell leaves the flow (the FAB of Android stands inside this nav).
    expect(shell.replace(bar, '')).not.toMatch(/position: fixed/)
  })

  it('tells the height of each bar to the action bars, the snackbar and the page through the layout tokens', () => {
    // tokens.css comes after shell.css and sets the defaults on :root: every rule here weighs more than :root.
    expect(rule(`${android}`, bar)).toBe('--ck-bottom-nav-height: var(--ck-navbar-android); --ck-top-bar-height: calc(var(--ck-topbar-android) + env(safe-area-inset-top, 0px));')
    expect(rule(':root', bar)).toBe('')
    // iOS: the capsule and the 8 px under it (its offset over the home indicator); the short top bar of 44 px.
    expect(rule(`${ios}`, bar)).toBe('--ck-bottom-nav-height: calc(var(--ck-tabbar-ios) + var(--ck-space-2)); --ck-top-bar-height: calc(var(--ck-topbar-ios) + env(safe-area-inset-top, 0px));')
    expect(rule(`${ios} .brand-bar .main-navigation`, bar)).toContain('bottom: calc(var(--ck-space-2) + var(--ck-safe-bottom)); left: max(10px, env(safe-area-inset-left, 0px)); height: var(--ck-tabbar-ios);')
    expect(rule(`${android} .brand-bar .main-navigation`, bar)).toContain('min-height: calc(var(--ck-navbar-android) + var(--ck-safe-bottom));')
    expect(rule(`${android} .brand-bar .main-navigation`, bar)).toContain('var(--ck-safe-bottom) max(')
    // The page ends above the bar (and above the FAB on Android); the only scroll padding is in ActionBar.css.
    expect(rule('body .page', bar)).toBe('padding: 0 max(var(--ck-space-4), env(safe-area-inset-right, 0px)) var(--ck-bottom-occupied) max(var(--ck-space-4), env(safe-area-inset-left, 0px));')
    expect(rule(`${android}:not(.ck-focus-mode) body .page`, bar)).toBe('padding-bottom: calc(var(--ck-bottom-occupied) + var(--ck-fab-android) + var(--ck-space-4));')
    expect(shell).not.toContain('scroll-padding')
    expect(actionBar).toContain('bottom: var(--ck-bottom-occupied);')
  })

  it('leaves a focus screen (a new spend) without the bar and «＋»: nothing is occupied at the bottom', () => {
    expect(rule(':root.ck-focus-mode', bar)).toBe('--ck-bottom-nav-height: 0px;')
    expect(rule('.ck-focus-mode .brand-bar .main-navigation', bar)).toBe('display: none;')
    expect(rule('.ck-focus-mode footer', bar)).toBe('display: none;')
    expect(raw('App.tsx')).toContain("document.documentElement.classList.toggle('ck-focus-mode', focus)")
    // The rule for the focus mode comes after the one of iOS: it wins there too.
    expect(bar.indexOf(':root.ck-focus-mode {')).toBeGreaterThan(bar.indexOf(`${ios} {`))
  })

  it('draws the iOS capsule of glass with a solid fallback, and the round «＋» of the seal beside it, apart from the sections', () => {
    const glass = rule(`${ios} .brand-bar .main-navigation::before`, bar)
    expect(glass).toContain('background: var(--ck-material);')
    expect(glass).toContain('border: 1px solid var(--ck-material-line);')
    expect(glass).toContain('backdrop-filter: blur(20px) saturate(1.8);')
    expect(glass).toContain('box-shadow: var(--ck-shadow-float);')
    expect(glass).toContain('border-radius: var(--ck-radius-pill);')
    expect(rule(`${ios} .brand-bar .main-navigation:has(> .main-add)::before`, bar)).toBe('right: calc(var(--ck-tabbar-ios) + var(--ck-space-2));')
    const plus = rule(`${ios} .brand-bar .main-add-toggle`, bar)
    expect(plus).toContain('width: var(--ck-tabbar-ios); height: var(--ck-tabbar-ios);')
    expect(plus).toContain('border-radius: 50%;')
    expect(rule('.brand-bar .main-add-toggle', bar)).toContain('background: var(--ck-seal); color: var(--ck-on-seal); box-shadow: var(--ck-shadow-float);')
    const supports = block(shell, '@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {')
    expect(rule(`${ios} .brand-bar .main-navigation::before`, supports)).toBe('background: var(--ck-surface);')
    const transparency = block(shell, '@media (prefers-reduced-transparency: reduce) {')
    expect(rule(`${ios} .brand-bar .main-navigation::before`, transparency)).toContain('background: var(--ck-surface);')
  })

  it('draws the Material 3 navigation bar of Android and the FAB over it, rising over an action bar and a snackbar', () => {
    expect(rule(`${android} .brand-bar .main-navigation`, bar)).toContain('background: var(--ck-nav-android);')
    const fab = rule(`${android} .brand-bar .main-add-toggle`, bar)
    expect(fab).toBe('width: var(--ck-fab-android); height: var(--ck-fab-android); min-height: var(--ck-fab-android); border-radius: var(--ck-radius-fab);')
    expect(rule(`${android} .brand-bar .main-add`, bar)).toContain('bottom: calc(var(--ck-bottom-occupied) + var(--ck-space-4));')
    expect(rule(`${android}:has(main .ck-action-bar) .brand-bar .main-add`, bar)).toContain('var(--ck-action-bar-room)')
    expect(rule(`${android}:has(.ck-snackbar) .brand-bar .main-add`, bar)).toContain('var(--ck-bottom-occupied)')
  })

  it('marks the current section, and «Ещё» with it, not by colour alone: a pad (iOS) or a pill (Android) and a heavier word', () => {
    const iosCurrent = rule(`${ios} .brand-bar .main-navigation > a[aria-current]`, bar)
    expect(iosCurrent).toContain('color: var(--ck-seal-ink); font-weight: 700;')
    expect(iosCurrent).toContain('background: color-mix(')
    expect(rule(`${ios} .brand-bar .main-more-toggle[data-current]`, bar)).toBe(iosCurrent)
    expect(rule(`${ios} .brand-bar a.main-more-toggle[aria-current]`, bar)).toBe(iosCurrent)
    // The cell itself has no fill: the shared `.main-navigation a[aria-current]` would paint the whole «Ещё» cell, which is
    // no child of the nav (seen in Chrome on Android, 2026-11-20); the pill is the picture's.
    expect(rule(`${android} .brand-bar .main-navigation > a[aria-current]`, bar)).toBe('background: none; color: var(--ck-ink); font-weight: 700;')
    expect(rule(`${android} .brand-bar .main-navigation > a[aria-current] .ck-icon`, bar)).toBe('background: var(--ck-seal-soft); color: var(--ck-seal-ink);')
    // The pill of Android: 56 × 32 around a 24 px picture.
    expect(rule(`${android} .brand-bar .main-navigation > a .ck-icon`, bar)).toBe('box-sizing: content-box; width: 24px; height: 24px; padding: var(--ck-space-1) var(--ck-space-4); border-radius: var(--ck-radius-pill);')
    // The dot of the header row does not belong to the bar.
    expect(rule('.brand-bar .main-navigation > a[aria-current]::before', bar)).toBe('content: none;')
    const forced = block(shell, '@media (forced-colors: active) {')
    expect(rule('.main-more-toggle[data-current]', forced)).toContain('text-decoration: underline;')
    expect(rule('.main-navigation a[aria-current]', forced)).toContain('text-decoration: underline;')
  })

  it('gives every section and «＋» a target of a tap at least', () => {
    expect(rule('.brand-bar .main-navigation > a', bar)).toContain('min-height: var(--ck-tap);')
    expect(rule(`${android} .brand-bar .main-navigation > a`, bar)).toContain('min-height: var(--ck-navbar-android);')
    // The capsule is 62 px with 4 px around: 54 px of a section.
    expect(rule(`${ios} .brand-bar .main-navigation`, bar)).toContain('padding: var(--ck-space-1);')
  })

  it('leads «Ещё» to its screen (/more): the lists of the header row are never drawn in the bar', () => {
    expect(rule('.brand-bar .main-more-list', bar)).toBe('display: none;')
    expect(rules(bar).some((item) => item.selector.includes('[data-open]'))).toBe(false)
  })

  it('draws no «Ещё», no pictures and no «＋» wherever the menu is a row: the links behind it stand in the row', () => {
    expect(rule('.main-more', base)).toBe('display: contents;')
    expect(rule('.main-more-list', base)).toBe('display: contents;')
    expect(rule('.main-navigation .main-more-toggle', base)).toBe('display: none;')
    expect(rule('.main-navigation .ck-icon', base)).toBe('display: none;')
    expect(rule('.main-add', base)).toBe('display: none;')
    expect(rule('.brand-bar .main-more-toggle', bar)).toContain('display: flex; flex-direction: column;')
    expect(rule('.brand-bar .main-navigation .ck-icon', bar)).toContain('display: block;')
  })

  it('ties every rule of the bar about the menu to the header: the sections of a part are another nav', () => {
    const loose = rules(bar).map((item) => item.selector).filter((selector) => /main-(navigation|more|group|add)/.test(selector)
      && !/^(:root(\[[^\]]*\]|:not\([^)]*\)|:has\([^)]*\)|\.[\w-]+)* )?(\.ck-focus-mode )?\.brand-bar /.test(selector))
    expect(loose).toEqual([])
  })
})

describe('the top bar of a phone (text of the rules)', () => {
  it('pins the header row to the top under the status bar, edge to edge, on the page and on its own layer', () => {
    const intro = rule('.intro', bar)
    expect(intro).toContain('position: sticky; top: 0; z-index: var(--ck-z-top-bar);')
    expect(intro).toContain('min-height: var(--ck-top-bar-height);')
    expect(intro).toContain('padding: env(safe-area-inset-top, 0px)')
    expect(intro).toContain('env(safe-area-inset-left, 0px)')
    expect(intro).toContain('env(safe-area-inset-right, 0px)')
    expect(intro).toContain('background: var(--ck-paper);')
    expect(html).toContain('<meta name="apple-mobile-web-app-status-bar-style" content="default" />')
    expect(html).toContain('<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />')
  })

  it('draws the large title at the root of an iOS section and the short bar over it that shows the title on glass under scroll', () => {
    expect(rule(`${ios} .intro[data-nav="root"]`, bar)).toContain('position: static;')
    const large = rule(`${ios} .intro[data-nav="root"] h1`, bar)
    expect(large).toContain('font-family: var(--ck-font-display); font-size: var(--ck-text-title-large); font-weight: 700;')
    const short = rule(`${ios} .ck-topbar[data-nav="root"]`, bar)
    expect(short).toContain('position: sticky; top: 0; z-index: var(--ck-z-top-bar);')
    expect(short).toContain('height: var(--ck-top-bar-height);')
    expect(rule('.ck-topbar-title', bar)).toContain('opacity: 0;')
    expect(rule('main[data-scrolled] > .ck-topbar .ck-topbar-title', bar)).toBe('opacity: 1;')
    const glass = rule(`${ios} main[data-scrolled] > .ck-topbar`, bar)
    expect(glass).toContain('background: var(--ck-material);')
    expect(glass).toContain('backdrop-filter: blur(20px) saturate(1.8);')
    expect(rule('.ck-topbar', base)).toBe('display: none;')
  })

  it('centres the short title of a nested iOS page and keeps the title of Android on the left, filled under scroll', () => {
    const middle = rule(`${ios} .intro h1`, bar)
    expect(middle).toContain('position: absolute;')
    expect(middle).toContain('left: 50%;')
    expect(middle).toContain('text-align: center;')
    expect(middle).toContain('font-size: var(--ck-text-title);')
    expect(rule(`${android} main[data-scrolled] > .intro`, bar)).toBe('background: var(--ck-nav-android);')
    expect(rule('.intro h1', narrow)).toContain('font-size: var(--ck-text-heading);')
  })

  it('shows «назад» only on a phone: «‹ Траты» in the brand ink on iOS, «←» as a 48 px icon button on Android', () => {
    expect(rule('.ck-back', base)).toBe('display: none;')
    expect(rule('.ck-back', narrow)).toContain('display: inline-flex;')
    expect(rule('.ck-back', narrow)).toContain('min-width: var(--ck-tap); min-height: var(--ck-tap);')
    expect(rule(`${android} .ck-back`, narrow)).toContain('width: 48px; height: 48px;')
    expect(rule(`${ios} .ck-back`, narrow)).toContain('color: var(--ck-seal-ink);')
    expect(rule(`${ios} .ck-back-arrow`, narrow)).toBe('display: none;')
    expect(rule('.ck-back-chevron', narrow)).toBe('display: none;')
    expect(rule(`${ios} .ck-back-text`, narrow)).toContain('display: block;')
    // Android draws the arrow alone, but the words stay the name of the link (hidden from the eye, never display: none).
    expect(rule('.ck-back-text', narrow)).toBe('position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap;')
    expect(rule(`${ios} .ck-back-text`, narrow)).toContain('position: static;')
    expect(rule(`${ios} .ck-back-text`, narrow)).toContain('clip-path: none;')
  })

  it('draws the round controls of a page and «✕» as targets of a tap', () => {
    expect(rule('.ck-round', base)).toContain('width: var(--ck-tap); height: var(--ck-tap); min-height: var(--ck-tap);')
    expect(rule('.ck-close', base)).toContain('width: var(--ck-tap); height: var(--ck-tap); min-height: var(--ck-tap); margin-left: auto;')
    expect(rule('.intro-slot', base)).toBe('display: contents;')
    expect(rule('.ck-chat-link', base)).toContain('width: var(--ck-tap); height: var(--ck-tap);')
    expect(rule('.ck-chat-link', base)).toContain('background: var(--ck-gold-soft);')
  })
})

describe('the header of a wide screen (text of the rules)', () => {
  const wide = block(shell, wideQuery)

  it('lies on the surface with a hairline under it, keeps the vertical of the page and the status bar of an iPad', () => {
    const header = rule('.brand-bar', base)
    expect(header).toContain('background: var(--ck-surface); color: var(--ck-ink);')
    expect(header).toContain('border-bottom: 1px solid var(--ck-line);')
    expect(header).toContain('padding: max(var(--ck-space-3), env(safe-area-inset-top, 0px)) max(36px, calc(50% - 564px)) var(--ck-space-3);')
    expect(rule('.page', app)).toContain('max-width: 1200px; padding: 0 36px;')
  })

  it('marks the current item as a pill of the soft brand with a dot, and opens «Данные ▾» as a popover on the surface', () => {
    expect(rule('.main-navigation a[aria-current]', base)).toBe('background: var(--ck-seal-soft); color: var(--ck-seal-ink); font-weight: 700;')
    expect(rule('.main-navigation a[aria-current]::before', base)).toContain('border-radius: 50%; background: currentColor;')
    const list = rule('.brand-bar .main-group[data-open] .main-group-list', wide)
    expect(list).toContain('z-index: var(--ck-z-menu-sheet);')
    expect(list).toContain('background: var(--ck-surface);')
    expect(list).toContain('box-shadow: var(--ck-shadow-float);')
    expect(rule('.brand-bar .main-group-toggle[data-current]::before', wide)).toContain('background: currentColor;')
    expect(rule('.brand-bar .main-group-toggle', wide)).toContain('min-height: var(--ck-tap);')
  })

  it('orders the layers: the popovers over the page, the skip link over everything', () => {
    expect(rule('.skip-link', base)).toContain('z-index: var(--ck-z-skip-link);')
    expect([...new Set([...shell.matchAll(/z-index: ([^;]+);/g)].map((match) => match[1]))].sort())
      // -1: the glass under the links of the iOS capsule; 1: the old page over the new one while iOS moves back.
      .toEqual(['-1', '1', 'var(--ck-z-bottom-nav)', 'var(--ck-z-menu-sheet)', 'var(--ck-z-skip-link)', 'var(--ck-z-top-bar)'].sort())
  })
})

describe('the sections of a part and the «＋» sheet (text of the rules)', () => {
  it('draws the sections as the segments of the platform: a raised segment on iOS, a tinted one with a check on Android', () => {
    expect(rule('.section-navigation a[aria-current]', base)).toBe('background: var(--ck-surface); color: var(--ck-ink); box-shadow: var(--ck-shadow-sm);')
    expect(rule(`${android} .section-navigation a[aria-current]`, base)).toContain('background: color-mix(')
    expect(rule(`${android} .section-navigation a[aria-current]::before`, base)).toContain('mask: url(')
    expect(rule(`${android} .section-navigation a`, base)).toContain('min-height: 40px;')
  })

  it('puts «Снять чек» across the sheet in the seal and the other ways in as tonal tiles of two taps', () => {
    expect(rule('.main-add-list', base)).toContain('grid-template-columns: repeat(2, minmax(0, 1fr));')
    expect(rule('.main-add-primary', base)).toContain('grid-column: 1 / -1;')
    expect(rule('.main-add-primary', base)).toContain('background: var(--ck-seal); color: var(--ck-on-seal);')
    expect(rule('.main-add-action', base)).toContain('min-height: calc(2 * var(--ck-tap));')
    expect(rule('.main-add-action', base)).toContain('background: var(--ck-surface-2); color: var(--ck-ink);')
  })
})

describe('the move between pages (text of the rules)', () => {
  it('moves only under no reduced motion: no animation, transition or keyframes outside of that block', () => {
    expect(shell.replace(block(shell, motionQuery), '')).not.toMatch(/animation|transition|@keyframes/)
  })

  it('moves the picture of the window (opaque, the size of the window), never the page box that drifts with the scroll', () => {
    expect(motion).not.toMatch(/view-transition-name: ck-page|\(ck-page\)/)
    expect(rule(':root[data-nav-direction]::view-transition-old(root)', motion)).toContain('animation-duration: 300ms;')
    expect(rule(':root[data-nav-direction]::view-transition-old(root)', motion)).not.toContain('opacity: 0')
  })

  it('keeps the bars still over the moving window: the tab bar, the FAB and the header are pictures of their own, shown at once', () => {
    expect(rule(':root[data-nav-direction] .brand-bar .main-navigation', motion)).toBe('view-transition-name: ck-tabbar;')
    expect(rule(':root[data-nav-direction] .brand-bar .main-add', motion)).toBe('view-transition-name: ck-fab;')
    expect(rule(':root[data-nav-direction] .brand-bar', motion)).toBe('view-transition-name: ck-header;')
    for (const name of ['ck-tabbar', 'ck-fab', 'ck-header']) {
      expect(rule(`:root[data-nav-direction]::view-transition-group(${name})`, motion), name).toBe('animation: none;')
      expect(rule(`:root[data-nav-direction]::view-transition-new(${name})`, motion), name).toBe('animation: none;')
      expect(rule(`:root[data-nav-direction]::view-transition-old(${name})`, motion), name).toBe('animation: none; opacity: 0;')
    }
    // Its own picture blurs nothing behind it: the iOS capsule is the solid surface for the time of the move.
    expect(rule(`${ios}[data-nav-direction] .brand-bar .main-navigation::before`, motion)).toBe('background: var(--ck-surface);')
  })

  it('slides the window on iOS for 350 ms (in from the right, the old one 30 % to the left; back the other way), one over the other', () => {
    expect(rule(`${ios}[data-nav-direction="forward"]::view-transition-new(root)`, motion)).toBe('animation-name: ck-nav-from-right;')
    expect(rule(`${ios}[data-nav-direction="forward"]::view-transition-old(root)`, motion)).toBe('animation-name: ck-nav-to-left;')
    expect(rule(`${ios}[data-nav-direction="back"]::view-transition-old(root)`, motion)).toBe('z-index: 1; animation-name: ck-nav-to-right;')
    expect(rule(`${ios}[data-nav-direction="back"]::view-transition-new(root)`, motion)).toBe('animation-name: ck-nav-from-left;')
    expect(rule(`${ios}[data-nav-direction]::view-transition-new(root)`, motion)).toBe('animation-duration: 350ms; mix-blend-mode: normal;')
    expect(motion).toMatch(/@keyframes ck-nav-to-left \{ to \{ transform: translateX\(-30%\); \} \}/)
  })

  it('moves the window along the X axis of Material 3 on Android for 300 ms: 30 px and the cross-fade of the browser', () => {
    expect(rule(':root[data-nav-direction]::view-transition-new(root)', motion)).toContain('animation-duration: 300ms;')
    expect(rule(`${android}[data-nav-direction="forward"]::view-transition-new(root)`, motion)).toBe('animation-name: ck-axis-in-right;')
    expect(rule(`${android}[data-nav-direction="back"]::view-transition-old(root)`, motion)).toBe('animation-name: ck-axis-out-right;')
    expect(motion).toMatch(/@keyframes ck-axis-in-right \{ from \{ opacity: 0; transform: translateX\(30px\); \} \}/)
    // Android keeps the plus-lighter blending of the browser: two opaque windows fade into one whole picture.
    expect(rules(motion).some((item) => item.selector.startsWith(android) && item.body.includes('mix-blend-mode'))).toBe(false)
  })
})
