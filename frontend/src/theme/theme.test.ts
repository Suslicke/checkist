import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { LoginPage } from '../features/auth'
import { ThemeToggle } from './ThemeToggle'
import { createThemeStore, defaultTheme, lightSchemeQuery, nextTheme, parseTheme, themeColors, themeLabel, themeStorageKey, useTheme } from './theme'
import type { Theme, ThemeEnvironment } from './theme'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

function environment(saved: string | null = null, system?: Theme) {
  const state = { saved, system, applied: [] as Theme[], external: undefined as (() => void) | undefined, stopped: 0 }
  const env: ThemeEnvironment = {
    read: () => state.saved,
    system: () => state.system ?? 'dark',
    write: (theme) => { state.saved = theme },
    apply: (theme) => { state.applied.push(theme) },
    listen: (listener) => {
      state.external = listener
      return () => { state.external = undefined; state.stopped += 1 }
    },
  }
  return { state, env }
}

describe('saved theme value', () => {
  it('reads only the two known values as a choice; anything else is the theme of the system', () => {
    for (const system of ['dark', 'light'] as Theme[]) {
      expect(parseTheme('light', system)).toBe('light')
      expect(parseTheme('dark', system)).toBe('dark')
      for (const value of [null, undefined, '', 'Light', ' light', 'system', 'auto', '1', 0, true, {}, ['light']]) {
        expect(parseTheme(value, system)).toBe(system)
      }
    }
    // Without a system preference: the dark theme.
    expect(parseTheme(null)).toBe('dark')
    expect(defaultTheme).toBe('dark')
    expect(themeStorageKey).toBe('checkist.theme')
    expect(lightSchemeQuery).toBe('(prefers-color-scheme: light)')
  })

  it('switches between the two themes and names the current one', () => {
    expect(nextTheme('dark')).toBe('light')
    expect(nextTheme('light')).toBe('dark')
    expect(themeLabel('dark')).toBe('Тема: тёмная')
    expect(themeLabel('light')).toBe('Тема: светлая')
  })
})

describe('theme store', () => {
  it('follows the system on the first visit and with a garbage value; a saved choice wins', () => {
    expect(createThemeStore(environment().env).getSnapshot()).toBe('dark')
    expect(createThemeStore(environment(null, 'light').env).getSnapshot()).toBe('light')
    expect(createThemeStore(environment('blue', 'light').env).getSnapshot()).toBe('light')
    expect(createThemeStore(environment('blue').env).getSnapshot()).toBe('dark')
    expect(createThemeStore(environment('light').env).getSnapshot()).toBe('light')
    expect(createThemeStore(environment('dark', 'light').env).getSnapshot()).toBe('dark')
    expect(createThemeStore(environment('light', 'dark').env).getSnapshot()).toBe('light')
    expect(createThemeStore(environment('light').env).getServerSnapshot()).toBe('dark')
    // An environment without the system preference (an old browser, a test): the dark theme.
    expect(createThemeStore({ read: () => null, write: () => {}, apply: () => {} }).getSnapshot()).toBe('dark')
  })

  it('follows a change of the system theme while the person has not chosen, and not after the choice', () => {
    const { state, env } = environment(null, 'dark')
    const store = createThemeStore(env)
    const seen: Theme[] = []
    const unsubscribe = store.subscribe(() => seen.push(store.getSnapshot()))
    state.system = 'light'
    state.external?.()
    expect(seen).toEqual(['light'])
    store.setTheme('dark')
    expect(state.saved).toBe('dark')
    state.system = 'light'
    state.external?.()
    expect(store.getSnapshot()).toBe('dark')
    unsubscribe()
  })

  it('still follows the system when the storage refuses to be read, and a failing system query reads dark', () => {
    const refuse = () => { throw new DOMException('denied', 'SecurityError') }
    expect(createThemeStore({ read: refuse, write: () => {}, apply: () => {}, system: () => 'light' }).getSnapshot()).toBe('light')
    expect(createThemeStore({ read: () => null, write: () => {}, apply: () => {}, system: refuse }).getSnapshot()).toBe('dark')
  })

  it('does not touch the environment until it is asked', () => {
    let calls = 0
    const count = () => { calls += 1; return null }
    createThemeStore({ read: count, write: count, apply: count, listen: () => { calls += 1; return () => {} } })
    expect(calls).toBe(0)
  })

  it('saves, applies and announces a switch', () => {
    const { state, env } = environment()
    const store = createThemeStore(env)
    let notified = 0
    const unsubscribe = store.subscribe(() => { notified += 1 })
    expect(state.applied).toEqual(['dark'])

    store.toggle()
    expect(store.getSnapshot()).toBe('light')
    expect(state.saved).toBe('light')
    expect(state.applied).toEqual(['dark', 'light'])
    expect(notified).toBe(1)

    store.toggle()
    expect(store.getSnapshot()).toBe('dark')
    expect(state.saved).toBe('dark')
    expect(notified).toBe(2)

    store.setTheme('dark')
    expect(notified).toBe(2)
    unsubscribe()
    store.toggle()
    expect(notified).toBe(2)
  })

  it('follows a change made in another tab while somebody is subscribed', () => {
    const { state, env } = environment()
    const store = createThemeStore(env)
    const seen: Theme[] = []
    const first = store.subscribe(() => seen.push(store.getSnapshot()))
    const second = store.subscribe(() => {})

    state.saved = 'light'
    state.external?.()
    expect(seen).toEqual(['light'])
    state.saved = 'nonsense'
    state.external?.()
    expect(seen).toEqual(['light', 'dark'])

    first()
    expect(state.stopped).toBe(0)
    expect(state.external).toBeDefined()
    second()
    expect(state.stopped).toBe(1)
  })

  it('survives a failing localStorage: reads dark, still switches for the open page', () => {
    const applied: Theme[] = []
    const refuse = () => { throw new DOMException('denied', 'SecurityError') }
    const store = createThemeStore({ read: refuse, write: refuse, apply: (theme) => { applied.push(theme) }, listen: refuse, system: refuse })
    expect(store.getSnapshot()).toBe('dark')
    let notified = 0
    expect(() => store.subscribe(() => { notified += 1 })).not.toThrow()
    expect(() => store.toggle()).not.toThrow()
    expect(store.getSnapshot()).toBe('light')
    expect(applied).toEqual(['dark', 'light'])
    expect(notified).toBe(1)
  })

  it('survives a document that cannot show the theme', () => {
    const store = createThemeStore({ read: () => 'light', write: () => {}, apply: () => { throw new ReferenceError('document is not defined') } })
    expect(() => store.subscribe(() => {})).not.toThrow()
    expect(() => store.toggle()).not.toThrow()
    expect(store.getSnapshot()).toBe('dark')
  })
})

describe('without a browser', () => {
  it('has no window and no document in this test run', () => {
    expect(typeof window).toBe('undefined')
    expect(typeof document).toBe('undefined')
  })

  it('renders the hook and the switch as the dark theme', () => {
    const Probe = () => useTheme().theme
    expect(renderToStaticMarkup(createElement(Probe))).toBe('dark')

    const page = renderToStaticMarkup(createElement(ThemeToggle))
    expect(page).toContain('<button type="button" class="ck-theme-toggle"')
    expect(page).toContain('Тема: тёмная')
    expect(page).not.toContain('aria-pressed')
    expect(page).toContain('aria-hidden="true"')

    const header = renderToStaticMarkup(createElement(ThemeToggle, { placement: 'header' }))
    expect(header).toContain('class="ck-theme-toggle ck-theme-toggle-header"')
    expect(header).toContain('Тема: тёмная')
  })

  it('switches the browser store without a browser: the choice lives in memory', () => {
    const Probe = () => {
      const { theme, toggle } = useTheme()
      if (theme === 'dark') expect(() => toggle()).not.toThrow()
      return theme
    }
    // The server snapshot stays dark whatever the store holds.
    expect(renderToStaticMarkup(createElement(Probe))).toBe('dark')
    expect(renderToStaticMarkup(createElement(ThemeToggle))).toContain('Тема: тёмная')
  })

  it('renders the sign-in screen with the page theme switch', () => {
    const html = renderToStaticMarkup(createElement(LoginPage, { expired: false }))
    expect(html).toContain('class="ck-login"')
    expect(html.match(/class="ck-theme-toggle"/g)).toHaveLength(1)
  })
})

describe('theme contract in the files', () => {
  const tokens = read('./tokens.css')
  const html = read('../../index.html')
  const block = (selector: string) => {
    const start = tokens.indexOf(`\n${selector} {`)
    expect(start, selector).toBeGreaterThan(-1)
    return tokens.slice(start, tokens.indexOf('\n}', start))
  }
  const names = (css: string) => [...css.matchAll(/^\s*(--ck-[a-z0-9-]+):/gm)].map((match) => match[1])
  const dark = block(':root')
  const light = block(':root[data-theme="light"]')

  it('keeps dark values in :root and overrides only colours for the light theme', () => {
    expect(dark).toContain('color-scheme: dark;')
    expect(light).toContain('color-scheme: light;')
    const darkNames = names(dark)
    const lightNames = names(light)
    expect(new Set(darkNames).size).toBe(darkNames.length)
    expect(new Set(lightNames).size).toBe(lightNames.length)
    expect(lightNames.filter((name) => !darkNames.includes(name))).toEqual([])
    // Чекист 2.0: every colour comes again for the light theme; fonts, sizes, spacing, radii, the tap, motion, layout,
    // layers and the tokens derived from the theme colours (the network track) are written once.
    expect(darkNames.filter((name) => !lightNames.includes(name))).toEqual([
      '--ck-network-track',
      '--ck-font-display', '--ck-font-ui', '--ck-font-slip',
      '--ck-text-caption', '--ck-text-label', '--ck-text-body', '--ck-text-field', '--ck-text-title', '--ck-text-heading',
      '--ck-text-money-display', '--ck-text-title-large', '--ck-text-money-hero',
      ...[1, 2, 3, 4, 5, 6, 8, 12].map((step) => `--ck-space-${step}`),
      '--ck-radius-field', '--ck-radius-button', '--ck-radius-fab', '--ck-radius-card', '--ck-radius-sheet', '--ck-radius-snackbar', '--ck-radius-pill',
      '--ck-tap', '--ck-tabbar-ios', '--ck-navbar-android', '--ck-topbar-ios', '--ck-topbar-android', '--ck-fab-android',
      '--ck-dur-press', '--ck-dur-state', '--ck-dur-count', '--ck-dur-sheet', '--ck-ease-out', '--ck-ease-spring',
      '--ck-tape-tooth', '--ck-fade-size',
      '--ck-bottom-nav-height', '--ck-top-bar-height', '--ck-safe-bottom', '--ck-bottom-occupied', '--ck-action-bar-room',
      '--ck-z-action-bar', '--ck-z-top-bar', '--ck-z-bottom-nav', '--ck-z-toast', '--ck-z-menu-sheet', '--ck-z-sheet', '--ck-z-network-bar', '--ck-z-skip-link',
    ])
  })

  it('defines every token of the contract of Чекист 2.0 (docs/plans/2026-11-20-design-2.md §1) with the values of tokens.json', () => {
    const colours = [
      'paper', 'surface', 'surface-2', 'nav-android', 'line', 'line-strong', 'track', 'bezel', 'ink', 'ink-2',
      'seal', 'seal-press', 'on-seal', 'seal-soft', 'seal-ink', 'gold', 'gold-ink', 'gold-soft',
      'income', 'income-soft', 'over', 'over-bar', 'over-soft', 'error', 'error-soft', 'focus', 'inv-action',
      'material', 'material-line', 'scrim', 'skeleton', 'slip', 'slip-ink', 'slip-ink-2', 'stamp',
      ...Array.from({ length: 6 }, (_, index) => [`cat-${index + 1}`, `cat-${index + 1}-tint`]).flat(),
      ...Array.from({ length: 8 }, (_, index) => `series-${index + 1}`), 'series-other', 'series-special', 'plot-grid', 'plot-axis',
      'shadow-float', 'shadow-sm',
    ]
    for (const name of colours) {
      expect(names(dark), name).toContain(`--ck-${name}`)
      expect(names(light), name).toContain(`--ck-${name}`)
    }
    // Values of docs/design-system/tokens.json.
    const value = (block: string, name: string) => new RegExp(`--ck-${name}: ([^;]+);`).exec(block)?.[1]
    const pairs: Record<string, [string, string]> = {
      paper: ['#121012', '#f4f2f2'], surface: ['#1b181a', '#fdfcfc'], 'surface-2': ['#272225', '#ece8e8'], 'nav-android': ['#221e20', '#efe9e9'],
      line: ['#302a2d', '#e2dcdc'], track: ['#2c2629', '#e6e0e0'], ink: ['#f3eeef', '#1b1517'], 'ink-2': ['#a79da0', '#645b5e'],
      seal: ['#d42a31', '#c0161d'], 'seal-press': ['#b51f26', '#9f1016'], 'on-seal': ['#ffffff', '#ffffff'], 'seal-soft': ['#3a1a1d', '#f7e4e4'],
      'seal-ink': ['#ff8a8f', '#9e1218'], gold: ['#f0c24b', '#e9b949'], 'gold-ink': ['#f0c24b', '#7a5500'], income: ['#5bcb92', '#1c7549'],
      over: ['#f59e5b', '#aa4e0e'], 'over-bar': ['#e07b39', '#d9701e'], error: ['#ff7aa8', '#a3154a'], focus: ['#f0c24b', '#2f5bd3'],
      'inv-action': ['#a3141b', '#f0c24b'], slip: ['#e7e2df', '#fffefc'], 'slip-ink': ['#1e1a1b', '#1e1a1b'], 'slip-ink-2': ['#625a5d', '#625a5d'],
      stamp: ['#c0161d', '#c0161d'], 'cat-1': ['#f07aa0', '#c2416b'], 'cat-2': ['#f2b759', '#b7791f'], 'cat-3': ['#5fcb8f', '#2f8f5b'],
      'cat-4': ['#7da2f0', '#3566c8'], 'cat-5': ['#b193f0', '#7a4fc4'], 'cat-6': ['#5cc8c8', '#1f8a8a'],
    }
    for (const [name, [darkValue, lightValue]] of Object.entries(pairs)) {
      expect(value(dark, name), name).toBe(darkValue)
      expect(value(light, name), name).toBe(lightValue)
    }
    expect(dark).toContain('--ck-font-display: "Geologica", "Onest", system-ui, sans-serif;')
    expect(dark).toContain('--ck-font-ui: "Onest", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;')
    expect(dark).toContain('--ck-font-slip: "JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace;')
    const sizes = Object.fromEntries([...dark.matchAll(/--ck-(radius-[a-z]+|space-\d+|tap|tabbar-ios|navbar-android|topbar-ios|topbar-android|fab-android): (\d+)px;/g)].map((match) => [match[1], Number(match[2])]))
    expect(sizes).toEqual({
      'space-1': 4, 'space-2': 8, 'space-3': 12, 'space-4': 16, 'space-5': 20, 'space-6': 24, 'space-8': 32, 'space-12': 48,
      'radius-field': 12, 'radius-button': 14, 'radius-fab': 16, 'radius-card': 22, 'radius-sheet': 28, 'radius-snackbar': 4, 'radius-pill': 999,
      tap: 48, 'tabbar-ios': 62, 'navbar-android': 64, 'topbar-ios': 44, 'topbar-android': 64, 'fab-android': 56,
    })
    expect(tokens).toMatch(/:root\[data-platform="ios"\] \{\s*--ck-tap: 44px;\s*\}/)
    const motion = Object.fromEntries([...dark.matchAll(/--ck-dur-([a-z]+): (\d+)ms;/g)].map((match) => [match[1], Number(match[2])]))
    expect(motion).toEqual({ press: 90, state: 180, count: 420, sheet: 360 })
    // Names kept by Charts.css must not be defined here: it points them at these tokens.
    expect(tokens).not.toMatch(/^\s*--ck-chart-/m)
  })

  it('has no names of 1.x left: tokens.css defines none and no stylesheet or component reads one', () => {
    // The move to 2.0 is over (2026-11-20): the LEGACY aliases are deleted with their last reader.
    const old = ['bg', 'text', 'text-muted', 'surface-raised', 'brand', 'brand-hover', 'brand-active', 'on-brand', 'primary', 'primary-hover',
      'primary-active', 'on-primary', 'accent', 'on-accent', 'accent-text', 'accent-bg', 'link', 'link-hover', 'border', 'border-field', 'divider',
      'error-text', 'error-bg', 'error-border', 'success-text', 'success-bg', 'success-border', 'warning-text', 'warning-bg', 'warning-border',
      'header-bg', 'header-text', 'header-accent', 'header-border', 'chip-selected-bg', 'chip-selected-text', 'card-shadow', 'panel-shadow',
      'popover-shadow', 'fab-shadow', 'nav-bg', 'radius', 'radius-sm', 'font-body', 'font-figures', 'text-xs', 'text-sm', 'text-base', 'text-lg',
      'text-xl', 'text-hero', 'text-2xs', 'toast-bg', 'toast-text', 'toast-action']
    expect(tokens).not.toContain('LEGACY')
    for (const name of old) expect(tokens, name).not.toMatch(new RegExp(`--ck-${name}\\s*:`))
    const sources = Object.entries(import.meta.glob(['../**/*.{css,ts,tsx}', '!../**/*.test.*', '!../**/*preview*/**'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>)
    expect(sources.length).toBeGreaterThan(100)
    for (const [path, text] of sources) for (const name of old) expect(text, `${path} reads --ck-${name}`).not.toMatch(new RegExp(`var\\(--ck-${name}[,)]`))
  })

  it('agrees with theme.ts and index.html about the key and the page colours', () => {
    expect(dark).toContain(`--ck-paper: ${themeColors.dark};`)
    expect(light).toContain(`--ck-paper: ${themeColors.light};`)
    // One meta per system theme; the inline script and theme.ts give both the colour of the theme the page shows.
    expect(html).toContain(`<meta name="theme-color" media="(prefers-color-scheme: light)" content="${themeColors.light}" />`)
    expect(html).toContain(`<meta name="theme-color" media="(prefers-color-scheme: dark)" content="${themeColors.dark}" />`)
    expect(html).toContain(`light ? '${themeColors.light}' : '${themeColors.dark}'`)
    expect(read('./theme.ts')).toContain(`document.querySelectorAll('meta[name="theme-color"]')`)
    expect(html).toContain(`localStorage.getItem('${themeStorageKey}')`)
    // A saved choice wins; without one the system preference decides.
    expect(html).toContain(`saved === 'light' || (saved !== 'dark' && window.matchMedia('${lightSchemeQuery}').matches)`)
    expect(html).toContain(`'${themeColors.light}'`)
    expect(html).toContain('<title>Чекист</title>')
    expect(html).toContain('<link rel="icon" type="image/svg+xml" href="/favicon.svg" />')
    expect(html).toContain('<link rel="apple-touch-icon" href="/apple-touch-icon.png" />')
    const inline = html.slice(html.indexOf('<script>'), html.indexOf('</script>'))
    expect(inline).toContain('try {')
    expect(html.indexOf('<meta name="theme-color"')).toBeLessThan(html.indexOf('<script>'))
    expect(html.indexOf('<script>')).toBeLessThan(html.indexOf('<script type="module"'))
  })

  it('paints the installed app and the tab icon in the colours of 2.0: the seal under the gold band', () => {
    // The splash and the bar of an installed app take the dark page colour; the icon background is the seal (#C0161D).
    const manifest = JSON.parse(read('../../public/manifest.json')) as { theme_color: string; background_color: string }
    expect(manifest.theme_color.toLowerCase()).toBe(themeColors.dark)
    expect(manifest.background_color.toLowerCase()).toBe(themeColors.dark)
    expect(read('../../public/favicon.svg')).toContain('fill="#C0161D"')
    expect(read('../../brand/app-icon.svg')).toContain('<rect width="512" height="512" fill="#C0161D"/>')
    for (const file of ['../../public/favicon.svg', '../../brand/app-icon.svg']) expect(read(file)).not.toMatch(/#(B01212|2A1B16|FFFAF0)/i)
  })

  it('loads Geologica, Onest and JetBrains Mono from Google Fonts with display=swap and no font file of its own', () => {
    // No Content-Security-Policy of the project forbids Google Fonts (deploy/Caddyfile, deploy/docker/Caddyfile).
    expect(html).toContain('<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />')
    expect(html).toContain('<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geologica:wght@400..800&amp;family=Onest:wght@400..800&amp;family=JetBrains+Mono:wght@400..600&amp;display=swap" />')
    expect(html).not.toContain('Manrope')
    // The status bar of an installed app on iPhone is painted by the page (the top bar keeps the safe area).
    expect(html).toContain('<meta name="apple-mobile-web-app-status-bar-style" content="default" />')
    expect(tokens).not.toContain('@font-face')
    expect(tokens).not.toMatch(/url\(/)
    expect(tokens).not.toContain('Oswald')
  })

  it('loads every font in one request; figures are the display font with tabular digits', () => {
    expect(html.match(/fonts\.googleapis\.com\/css2/g)).toHaveLength(1)
    expect(tokens).toMatch(/\.ck-figures \{ font-family: var\(--ck-font-display\);[^}]*font-variant-numeric: tabular-nums;/)
  })

  it('defines the type scale of 2.0 in rem: 12 / 13 / 15 / 16 / 17 / 22 / 32 / 34 / 44 px at a root of 16 px', () => {
    const scale = Object.fromEntries([...dark.matchAll(/--ck-text-([a-z-]+): ([\d.]+)rem;/g)].map((match) => [match[1], Number(match[2]) * 16]))
    expect(scale).toEqual({ caption: 12, label: 13, body: 15, field: 16, title: 17, heading: 22, 'money-display': 32, 'title-large': 34, 'money-hero': 44 })
  })

  it('orders the layers: action bar, top bar, bottom navigation, menu, sheet, skip link', () => {
    const layer = (name: string) => Number(new RegExp(`--ck-z-${name}: (\\d+);`).exec(dark)?.[1])
    const order = ['action-bar', 'top-bar', 'bottom-nav', 'menu-sheet', 'sheet', 'skip-link'].map(layer)
    expect(order.every((value, index) => index === 0 || value > order[index - 1])).toBe(true)
  })

  it('makes each category tint 15 % of its tone over the surface, in both themes', () => {
    const hex = (text: string) => [1, 3, 5].map((at) => Number.parseInt(text.slice(at, at + 2), 16))
    for (const block of [dark, light]) {
      const surface = hex(/--ck-surface: (#[0-9a-f]{6});/.exec(block)?.[1] ?? '')
      for (let tone = 1; tone <= 6; tone += 1) {
        const colour = hex(new RegExp(`--ck-cat-${tone}: (#[0-9a-f]{6});`).exec(block)?.[1] ?? '')
        const tint = hex(new RegExp(`--ck-cat-${tone}-tint: (#[0-9a-f]{6});`).exec(block)?.[1] ?? '')
        tint.forEach((channel, index) => expect(Math.abs(channel - (colour[index] * 0.15 + surface[index] * 0.85)), `cat-${tone}`).toBeLessThanOrEqual(1))
      }
    }
  })


  it('styles the switch with tokens only', () => {
    const css = read('./ThemeToggle.css')
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i)
    expect(css).toContain('min-height: var(--ck-tap)')
    expect(css).not.toContain('transition')
    expect([...css.matchAll(/\.(ck-[a-z-]+)/g)].every((match) => match[1].startsWith('ck-theme-'))).toBe(true)
  })
})
