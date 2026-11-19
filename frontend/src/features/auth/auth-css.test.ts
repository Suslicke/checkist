import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = new URL('../../', import.meta.url)
const read = (path: string) => readFileSync(new URL(path, source), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const app = read('App.css')
const auth = read('features/auth/Auth.css')
const tokens = readFileSync(new URL('theme/tokens.css', source), 'utf8')
/** The names of Чекист 1.x lived on as aliases at the end of tokens.css during the move to 2.0; the block is gone now. */
const legacy = tokens.includes('LEGACY') ? tokens.slice(tokens.indexOf('LEGACY')) : ''

/** Flat rules: a media block of these stylesheets holds whole rules. */
const rules = (text: string) => [...text.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .flatMap((match) => match[1].split(',').map((selector) => ({ selector: selector.trim(), body: match[2].trim() })))
const rule = (selector: string, text = auth) => rules(text).filter((item) => item.selector === selector).map((item) => item.body).join(' ')
const declares = (body: string, property: string) => new RegExp(`(^|[;\\s])${property}\\s*:`).test(body)
const paints = (body: string) => declares(body, 'color') || declares(body, 'border-color') || declares(body, 'background')
const media = (query: string) => {
  const start = auth.indexOf(`@media ${query} {`)
  if (start < 0) return ''
  const next = auth.indexOf('@media', start + 1)
  return auth.slice(start, next < 0 ? undefined : next)
}
/** The file without its media blocks: the rules that hold at every width and pointer. */
const base = (() => {
  let text = auth
  for (let start = text.indexOf('@media'); start >= 0; start = text.indexOf('@media')) {
    let end = text.indexOf('{', start) + 1
    for (let depth = 1; depth > 0 && end < text.length; end += 1) depth += text[end] === '{' ? 1 : text[end] === '}' ? -1 : 0
    text = text.slice(0, start) + text.slice(end)
  }
  return text
})()

/** Specificity as [classes + attributes + pseudo-classes, elements]; whatever stands inside :where() weighs nothing. */
const weight = (selector: string): [number, number] => {
  let text = selector
  for (let start = text.indexOf(':where('); start >= 0; start = text.indexOf(':where(')) {
    let end = start + 7
    for (let depth = 1; depth > 0 && end < text.length; end += 1) depth += text[end] === '(' ? 1 : text[end] === ')' ? -1 : 0
    text = text.slice(0, start) + text.slice(end)
  }
  text = text.replace(/::[\w-]+/g, '').replace(/:not\(|\)/g, ' ')
  const classes = (text.match(/\.[\w-]+|\[[^\]]*\]|:[\w-]+/g) ?? []).length
  const elements = (text.replace(/\.[\w-]+|\[[^\]]*\]|:[\w-]+/g, ' ').match(/[a-z][\w-]*/gi) ?? []).length
  return [classes, elements]
}
const heavier = (left: string, right: string) => {
  const [a, b] = [weight(left), weight(right)]
  return a[0] > b[0] || (a[0] === b[0] && a[1] > b[1])
}

describe('auth stylesheet guards of Чекист 2.0 (text of the rules, not rendering)', () => {
  it('holds no colour of its own', () => {
    expect(auth).not.toMatch(/#[0-9a-f]{3,8}\b/i)
    expect(auth).not.toMatch(/\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/i)
  })

  it('reads only 2.0 tokens that the theme defines, none of the 1.x aliases, and defines none', () => {
    const used = new Set([...auth.matchAll(/var\((--[\w-]+)/g)].map((match) => match[1]))
    expect(used.size).toBeGreaterThan(15)
    for (const name of used) {
      expect(tokens, name).toContain(`${name}:`)
      expect(legacy, name).not.toMatch(new RegExp(`${name}\\s*:`))
    }
    expect(auth).not.toMatch(/--[\w-]+\s*:/)
    expect(auth).not.toContain('data-theme')
  })

  it('names every class with the prefix of the sign-in or of the forms, besides the shared bricks it places', () => {
    const classes = new Set([...auth.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((match) => match[1]))
    expect([...classes].filter((name) => !/^ck-(auth|login)(-|$)/.test(name)).sort())
      .toEqual(['ck-row', 'ck-row-meta', 'ck-row-title', 'ck-segments', 'ck-switch-row'])
  })

  it('never writes text in the seal: the seal is a fill of the main action, the words are seal-ink', () => {
    for (const item of rules(auth)) expect(item.body, item.selector).not.toMatch(/(^|[;\s])color: var\(--ck-seal\)/)
  })

  it('draws a panel of 2.0: the surface, a line frame, the radius of a card and no shadow', () => {
    const panel = rule('.ck-auth-panel', base)
    expect(panel).toContain('border: 1px solid var(--ck-line); border-radius: var(--ck-radius-card); background: var(--ck-surface);')
    expect(panel).not.toContain('shadow')
    expect(rule('.ck-login-panel', base)).toContain('border: 1px solid var(--ck-line); border-radius: var(--ck-radius-card); background: var(--ck-surface);')
    expect(auth).not.toMatch(/box-shadow: (?!inset)/)
    expect(rule('.ck-auth-done', base)).toContain('color: var(--ck-income);')
    expect(rule('.ck-auth-hint', base)).toContain('color: var(--ck-ink-2);')
  })

  it('shows a refusal by a thicker frame and a bar as well as by colour', () => {
    expect(rule('.ck-auth-field input[aria-invalid="true"]', base)).toBe('border-color: var(--ck-error); box-shadow: inset 0 0 0 1px var(--ck-error);')
    expect(rule('.ck-auth-error', base)).toContain('border-left: 3px solid var(--ck-error); color: var(--ck-error);')
  })

  it('keeps the tonal and the danger buttons in their colours while hovered and pressed, the press after the hover', () => {
    expect(rule('.ck-auth-secondary')).toContain('border: 1px solid transparent; border-radius: var(--ck-radius-button); background: var(--ck-surface-2); color: var(--ck-ink);')
    expect(rule('.ck-auth-secondary:active')).toBe('border-color: transparent; background: color-mix(in srgb, var(--ck-ink) 10%, var(--ck-surface-2)); color: var(--ck-ink);')
    expect(rule('.ck-auth-secondary:hover', media('(hover: hover)'))).toContain('background: color-mix(in srgb, var(--ck-ink) 6%, var(--ck-surface-2)); color: var(--ck-ink);')
    // A danger is quiet: the error colour as an outline and a word, never a fill.
    expect(rule('.ck-auth-danger')).toContain('border: 1px solid var(--ck-error); border-radius: var(--ck-radius-button); background: transparent; color: var(--ck-error);')
    expect(rule('.ck-auth-danger:active')).toBe('border-color: var(--ck-error); background: var(--ck-error-soft); color: var(--ck-error);')
    // The hover block stands before the press, so a pressed button under the mouse shows the press.
    expect(auth.indexOf('@media (hover: hover)')).toBeLessThan(auth.indexOf('.ck-auth-secondary:active'))
  })

  it('keeps a button with a request in flight grey under the pointer and the press', () => {
    const disabled = 'border-color: var(--ck-surface-2); background: var(--ck-surface-2); color: var(--ck-ink-2); cursor: default;'
    const selectors = ['.ck-auth button[aria-disabled="true"]', '.ck-auth button[aria-disabled="true"]:hover', '.ck-auth button[aria-disabled="true"]:active']
    for (const selector of selectors) {
      expect(rule(selector, base), selector).toBe(disabled)
      for (const kind of ['secondary', 'danger', 'link']) for (const state of ['', ':hover', ':active']) {
        expect(heavier(selector, `.ck-auth-${kind}${state}`), `${selector} > ${kind}${state}`).toBe(true)
      }
    }
  })

  it('outweighs every shared button rule of the shell wherever it paints a button', () => {
    // App.css goes after this file in the build: an equal weight there would win. Its hover sits inside
    // `@media (hover: hover)` near the end of the file, so it is the last of the shared rules now.
    const shell = rules(app).filter((item) => /^button(?![\w-])/.test(item.selector) && paints(item.body)).map((item) => item.selector)
    expect(shell).toEqual(['button', 'button:where(:active:not(:disabled))', 'button:disabled', 'button:where(:hover:not(:disabled))'])
    // `button:disabled` is meant to win where a form locks a button by `disabled` (the token form of MCP).
    const live = shell.filter((selector) => selector !== 'button:disabled')
    expect(live.map(weight)).toEqual([[0, 1], [0, 1], [0, 1]])
    const mine = rules(auth).filter((item) => /link|secondary|danger|signout|slip-button|button/.test(item.selector) && paints(item.body)).map((item) => item.selector)
    expect(mine.length).toBeGreaterThan(10)
    for (const selector of mine) for (const other of live) expect(heavier(selector, other), `${selector} > ${other}`).toBe(true)
  })

  it('lets the shared rules fill the main action with the seal: the class sets the size only', () => {
    const primary = rule('.ck-auth-primary')
    expect(paints(primary)).toBe(false)
    expect(primary).toContain('width: 100%;')
    expect(Number(primary.match(/min-height: (\d+)px/)?.[1])).toBeGreaterThanOrEqual(52)
    expect(rules(auth).filter((item) => item.selector.startsWith('.ck-auth-primary:'))).toEqual([])
    // Every size of the text comes from the scale of the theme.
    for (const size of auth.match(/font-size: [^;]+/g) ?? []) expect(size).toMatch(/var\(--ck-text-/)
  })

  it('keeps the focus ring of the shell: it never takes a ring off, nor draws one on the heading', () => {
    expect(rules(auth).filter((item) => /(^|[\s>+~])h1(?![\w-])[^,]*:focus/.test(item.selector))).toEqual([])
    expect(auth).not.toMatch(/outline:\s*(none|0)\b/)
  })

  it('puts the emblem on the paper of the page: no dark board, no picture in the stylesheet', () => {
    expect(auth).not.toContain('--ck-logo-bg')
    expect(auth).not.toMatch(/url\(/)
    expect(rule('.ck-login', base)).toContain('background: var(--ck-paper); color: var(--ck-ink);')
    expect(rule('.ck-login-logo', base)).toContain('width: 88px; height: 88px;')
    expect(rule('.ck-login-name', base)).toContain('font-family: var(--ck-font-display); font-size: var(--ck-text-title-large);')
  })

  it('keeps the sign-in in one column in the middle of the window at every width, without a fixed width', () => {
    expect(rule('.ck-login-layout', base)).toContain('grid-template-columns: minmax(0, 1fr);')
    expect(rule('.ck-login-layout', base)).toContain('max-width: 400px;')
    expect(rule('.ck-login', base)).toContain('overflow-wrap: anywhere;')
    expect(rule('.ck-login', base)).toContain('env(safe-area-inset-top)')
    for (const item of rules(base)) expect(item.body, item.selector).not.toMatch(/(^|[;\s])(min-)?width: (?!min\()\d{3,}px/)
    expect([...auth.matchAll(/@media \(([^)]*)\)/g)].map((match) => match[1])).toEqual(['hover: hover', 'forced-colors: active'])
  })

  it('draws the form of the sign-in inside its panel, without a panel of its own', () => {
    expect(rule('.ck-login .ck-auth-panel')).toBe('gap: var(--ck-space-4); padding: 0; border: 0; border-radius: 0; background: none;')
    expect(heavier('.ck-login .ck-auth-panel', '.ck-auth-panel')).toBe(true)
  })

  it('shows a one-time token on the paper slip in the slip font, in both themes', () => {
    expect(rule('.ck-auth-slip', base)).toContain('background: var(--ck-slip); color: var(--ck-slip-ink);')
    expect(rule('.ck-auth-slip .ck-auth-mcp-copy-row input', base)).toContain('font-family: var(--ck-font-slip);')
  })

  it('has no motion and keeps a forced-colors block', () => {
    expect(auth).not.toMatch(/\b(animation|transition|@keyframes)\b/)
    const forced = media('(forced-colors: active)')
    expect(forced).toContain('border: 1px solid CanvasText;')
  })
})
