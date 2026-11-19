import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = new URL('../', import.meta.url)
const raw = (path: string) => readFileSync(new URL(path, source), 'utf8')
const read = (path: string) => raw(path).replace(/\/\*[\s\S]*?\*\//g, '')
const app = read('App.css')
/** The shell of Чекист 2.0 (header, bars, «назад»): its own stylesheet, guarded in full by menu/menu-css.test.ts. */
const shell = read('shell.css')
const tokens = raw('theme/tokens.css')

/** Flat rules: a media block of these stylesheets holds whole rules. */
const rules = (text: string) => [...text.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .flatMap((match) => match[1].split(',').map((selector) => ({ selector: selector.trim(), body: match[2].trim() })))
const rule = (selector: string, text: string) => rules(text).filter((item) => item.selector === selector).map((item) => item.body).join(' ')

/** Classes, attributes and pseudo-classes of a selector; whatever stands inside :where() weighs nothing. */
const weight = (selector: string) => {
  let text = selector
  for (let start = text.indexOf(':where('); start >= 0; start = text.indexOf(':where(')) {
    let end = start + 7
    for (let depth = 1; depth > 0 && end < text.length; end += 1) depth += text[end] === '(' ? 1 : text[end] === ')' ? -1 : 0
    text = text.slice(0, start) + text.slice(end)
  }
  return (text.replace(/::[\w-]+/g, '').replace(/:not\(|\)/g, ' ').match(/\.[\w-]+|\[[^\]]*\]|:[\w-]+/g) ?? []).length
}

const files = (readdirSync(source, { recursive: true }) as string[]).map((path) => path.replaceAll('\\', '/'))
/** A colour written as a value; color-mix() over tokens is not one. */
const colour = /#[0-9a-f]{3,8}\b|\b(?:rgb|hsl|hwb|lab|lch|oklab|oklch)a?\(/i

describe('colours live in the theme tokens only (text of the files, not rendering)', () => {
  it('writes no colour in a stylesheet other than tokens.css', () => {
    // Static snapshots in preview/ keep the former green design and are not a part of the client.
    const sheets = files.filter((path) => path.endsWith('.css') && path !== 'theme/tokens.css' && !/(^|[/-])preview\//.test(path))
    expect(sheets).toContain('App.css')
    const own = sheets.filter((path) => colour.test(read(path)))
    // features/auth/Auth.css came from main in the former palette; its move to the tokens is a task of its own.
    expect(own.filter((path) => path !== 'features/auth/Auth.css')).toEqual([])
  })

  it('reads only tokens that the theme defines', () => {
    const defined = new Set([...tokens.matchAll(/^\s*(--ck-[a-z0-9-]+):/gm)].map((match) => match[1]))
    const used = [...app.matchAll(/var\((--[a-z0-9-]+)/g)].map((match) => match[1])
    expect(used.length).toBeGreaterThan(0)
    expect([...new Set(used.filter((name) => !defined.has(name)))]).toEqual([])
  })
})

describe('account link of the header (text of the rules, not rendering)', () => {
  it('sets no colour and no state of its own: the header links (shell.css) draw it', () => {
    const own = rules(shell).filter((item) => /\.account-link(?![\w-])/.test(item.selector))
    expect(own.map((item) => item.selector)).toEqual(['.account-link'])
    expect(rule('.account-link', shell)).toBe('max-width: 100%; font-weight: 600; overflow-wrap: anywhere;')
    expect(rules(app).some((item) => item.selector.includes('account-link'))).toBe(false)
  })

  it('yields to the current page of the header links, which weighs more than its class', () => {
    expect(rule('.main-navigation a[aria-current]', shell)).toContain('background: var(--ck-seal-soft); color: var(--ck-seal-ink); font-weight: 700;')
    expect(weight('.main-navigation a[aria-current]')).toBeGreaterThan(weight('.account-link'))
  })
})

describe('emblem of the header (text of the rules and headers of the files, not rendering)', () => {
  const bytes = (path: string) => readFileSync(new URL(path, source))

  it('lies straight on the header: no backing, no frame, only the size', () => {
    const own = rules(shell).filter((item) => /\.brand-mark(?![\w-])/.test(item.selector))
    expect(own.map((item) => item.body)).toEqual(['flex: none; width: 40px; height: 40px;', 'width: 32px; height: 32px;'])
    // Чекист 2.0: the header lies on the surface of each theme (shell.css), the emblem straight on it.
    expect(rule('.brand-bar', shell)).toContain('background: var(--ck-surface);')
  })

  it.each([['emblem-96.webp', 96], ['emblem-192.webp', 192]])('%s is a square WebP with an alpha channel', (name, side) => {
    const file = bytes(`assets/brand/${name}`)
    expect(file.toString('latin1', 0, 4) + file.toString('latin1', 8, 16)).toBe('RIFFWEBPVP8X')
    expect(file[20] & 0x10, 'alpha flag of the extended header').toBe(0x10)
    expect([file.readUIntLE(24, 3) + 1, file.readUIntLE(27, 3) + 1]).toEqual([side, side])
  })

  it('keeps the touch icon opaque: iOS paints transparency black', () => {
    const file = bytes('../public/apple-touch-icon.png')
    expect(file.toString('latin1', 12, 16)).toBe('IHDR')
    expect([file.readUInt32BE(16), file.readUInt32BE(20)]).toEqual([180, 180])
    expect(file[25], 'colour type 2 is RGB without alpha').toBe(2)
    expect(file.includes(Buffer.from('tRNS', 'latin1'))).toBe(false)
  })
})

describe('state rules of the shell (text of the rules, not rendering)', () => {
  const state = /:(hover|active|focus|focus-visible|focus-within|disabled|checked|visited)(?![\w-])|\[aria-(disabled|invalid|pressed|expanded|busy)/

  it('keeps every general state rule as weak as its base rule', () => {
    // App.css follows the screen stylesheets in the build: a general state rule that weighs as much as a class of a
    // screen wins over it. A new one goes through :where() and into this list; the disabled button must win over the fill
    // that a class of a screen sets. The parts of the shell (top bar, menu, «＋», skip link, sections of a part) move to
    // shell.css (Чекист 2.0, F2) and keep their own guards: this list is the language of App.css (F1).
    const shell = /skip-link|brand|main-|section-navigation|ck-chat-link|ck-round|ck-close|ck-back|intro|account-link/
    const found = rules(app).filter((item) => state.test(item.selector) && !shell.test(item.selector)).map((item) => `${item.selector} = ${weight(item.selector)}`)
    expect(found).toEqual([
      'button:focus-visible = 1', 'a:focus-visible = 1', 'input:focus-visible = 1', 'select:focus-visible = 1', 'textarea:focus-visible = 1',
      '[tabindex]:focus-visible = 2',
      // The heading of the page takes the ring off itself: focused by script only (focus-ring-css.test.ts).
      'h1[tabindex="-1"]:focus-visible = 2',
      // The press of the main action (seal-press) and of `.ck-btn`; the disabled button outweighs a class of a screen.
      'button:where(:active:not(:disabled)) = 0', '.ck-btn:where(:active) = 1', 'button:disabled = 1',
      // iOS dims a pressed control to 55 % (platforms.md): as weak as the element or the class.
      ':where(:root[data-platform="ios"]) button:where(:active:not(:disabled)) = 0', ':where(:root[data-platform="ios"]) .ck-btn:where(:active) = 1',
      ':where(:root[data-platform="ios"]) .action-link:where(:active) = 1',
      // A field of 2.0: invalid and disabled as weak as the element.
      'input:where([aria-invalid="true"]) = 0', 'select:where([aria-invalid="true"]) = 0', 'textarea:where([aria-invalid="true"]) = 0',
      'input:where(:disabled) = 0', 'select:where(:disabled) = 0', 'textarea:where(:disabled) = 0',
      // The press of the tonal link, the primary link, the tonal, ghost and danger buttons: as weak as their class.
      '.action-link:where(:active) = 1', '.action-link.ck-btn-primary:where(:active) = 2',
      '.ck-button-secondary:where(:active:not(:disabled)) = 1', '.ck-button-ghost:where(:active:not(:disabled)) = 1',
      '.ck-button-danger:where(:active:not(:disabled)) = 1', '.expense-danger:where(:active:not(:disabled)) = 1',
      // The round icon button: pressed (aria-pressed) is a choice of the component, filled with ink.
      '.ck-icon-button:where(:active:not(:disabled)) = 1', '.ck-icon-button[aria-pressed="true"] = 2',
      // Segments and the drawn switch: states of the components themselves (the selected segment, the checked switch).
      '.ck-segments > [aria-pressed="true"] = 2', ':where(:root:not([data-platform="ios"])) .ck-segments > [aria-pressed="true"]::after = 2',
      ':where(:root[data-platform="ios"]) .ck-segments > [aria-pressed="true"] = 2',
      ':where(:root:not([data-switch="native"])) .ck-switch:checked = 2', ':where(:root:not([data-switch="native"])) .ck-switch:checked::after = 2',
      ':where(:root:not([data-switch="native"])) .ck-switch:checked::before = 2',
      ':where(:root[data-platform="ios"]:not([data-switch="native"])) .ck-switch:checked = 2',
      ':where(:root[data-platform="ios"]:not([data-switch="native"])) .ck-switch:checked::after = 2',
      ':where(:root[data-platform="ios"]:not([data-switch="native"])) .ck-switch:checked::before = 2',
      '.rec-issues summary:focus-visible = 2',
      // Hover only where a pointer hovers (@media (hover: hover)), never while pressed: as weak as the element or class.
      'button:where(:hover:not(:disabled)) = 0', '.ck-btn:where(:hover:not(:active)) = 1',
      '.action-link:where(:hover:not(:active)) = 1', '.action-link.ck-btn-primary:where(:hover:not(:active)) = 2',
      '.ck-button-secondary:where(:hover:not(:active):not(:disabled)) = 1', '.ck-button-ghost:where(:hover:not(:active):not(:disabled)) = 1',
      '.ck-button-danger:where(:hover:not(:active):not(:disabled)) = 1', '.expense-danger:where(:hover:not(:active):not(:disabled)) = 1',
      '.ck-icon-button:where(:hover:not(:active):not(:disabled):not([aria-pressed="true"])) = 1',
      '.ck-segments > button:where(:hover:not(:disabled):not([aria-pressed="true"])) = 1',
      '.ck-segments > a:where(:hover:not([aria-current="page"]):not([aria-current="true"])) = 1',
      // The squeeze of a press (@media (prefers-reduced-motion: no-preference)).
      'button:where(:active:not(:disabled)) = 0', '.ck-btn:where(:active) = 1', '.action-link:where(:active) = 1',
      // Forced colours: a frame of the system colours.
      '.ck-switch:checked = 2', '.ck-icon-button[aria-pressed="true"] = 2',
    ])
  })

  it('sets only the outline in the general focus rule: 2 px of the focus colour, 2 px away (Чекист 2.0)', () => {
    expect(rule('button:focus-visible', app)).toBe('outline: 2px solid var(--ck-focus); outline-offset: 2px;')
  })
})

describe('width of the page and values that never break (text of the rules, not rendering)', () => {
  const px = (text: string, pattern: RegExp) => Number(pattern.exec(text)?.[1] ?? NaN)
  /** Rules outside of any media block. */
  const wide = app.slice(0, app.indexOf('@media'))

  it('keeps a date whole through a rule that weighs nothing', () => {
    // App.css follows the screen stylesheets in the build: only :where() lets a screen override the rule.
    expect(rule(':where(time)', app)).toBe('white-space: nowrap;')
    expect(weight(':where(time)')).toBe(0)
    expect(rules(app).filter((item) => /(^|[\s>+~(])time(?![\w-])/.test(item.selector)).map((item) => item.selector)).toEqual([':where(time)'])
  })

  it('gives the desktop page about 1200 px and keeps the header on the same vertical', () => {
    const page = rule('.page', wide)
    const width = px(page, /max-width: (\d+)px;/)
    const padding = px(page, /padding: 0 (\d+)px;/)
    expect(width).toBeGreaterThanOrEqual(1160)
    expect(width).toBeLessThanOrEqual(1240)
    expect(page).toContain('margin: auto;')
    // The header spans the window (shell.css): its side padding is the gap beside .page plus .page's own padding.
    const bar = /padding: max\(var\(--ck-space-3\), env\(safe-area-inset-top, 0px\)\) max\((\d+)px, calc\(50% - (\d+)px\)\) var\(--ck-space-3\);/.exec(rule('.brand-bar', shell.slice(0, shell.indexOf('@media'))))
    expect(bar?.slice(1).map(Number)).toEqual([padding, width / 2 - padding])
  })

  it('still wraps free text instead of scrolling the page, and leaves the phone as it was', () => {
    expect(rule('.page', wide)).toContain('overflow-wrap: anywhere;')
    const phone = /@media \(max-width: 540px\) \{([\s\S]*?)\n\}/.exec(app)?.[1] ?? ''
    // The 16 px margins of the artifact design.
    expect(rule('.page', phone)).toBe('padding: 0 16px;')
    // The header strip of a tiny or low window (shell.css): the menu is one row scrolled sideways.
    const shellPhone = /@media \(max-width: 540px\) \{([\s\S]*?)\n\}/.exec(shell)?.[1] ?? ''
    expect(rule('.brand-bar', shellPhone)).toContain('padding: max(var(--ck-space-2), env(safe-area-inset-top, 0px))')
    expect(rule('.brand-bar .main-navigation', shellPhone)).toContain('flex-wrap: nowrap;')
    expect(rule('.brand-bar .main-navigation', shellPhone)).toContain('overflow-x: auto;')
  })
})

describe('name of the product in the page and the theme file', () => {
  it('is written in Russian', () => {
    const html = raw('../index.html')
    expect(html).not.toContain('Checkist')
    expect(html).toMatch(/<meta name="description" content="Чекист — [^"]+" \/>/)
    expect(html).toContain('<title>Чекист</title>')
  })

  it('promises the look of a dangerous action that the buttons have: an error outline, never the seal', () => {
    const comment = tokens.slice(0, tokens.indexOf('СПРАВОЧНИК ТОКЕНОВ'))
    expect(comment).toMatch(/опасное\s+действие\s+—\s+не\s+seal,\s+а\s+--ck-error\s+контуром\s+\(\.ck-button-danger\)/)
    expect(rule('.ck-button-danger', app)).toBe('border-color: var(--ck-error); background: transparent; color: var(--ck-error);')
  })
})
