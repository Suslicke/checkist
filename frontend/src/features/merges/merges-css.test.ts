import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = new URL('../../', import.meta.url)
const read = (path: string) => readFileSync(new URL(path, source), 'utf8')
const plain = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '')
const css = plain(read('features/merges/Merges.css'))
const app = plain(read('App.css'))

/** Flat rules: a media block of these stylesheets holds whole rules. */
const rules = (text: string) => [...text.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .flatMap((match) => match[1].split(',').map((selector) => ({ selector: selector.trim(), body: match[2].trim() })))
const rule = (selector: string, text = css) => rules(text).filter((item) => item.selector === selector).map((item) => item.body).join(' ')
const value = (body: string, property: string) => body.match(new RegExp(`(?:^|[;\\s])${property}\\s*:\\s*([^;]+);`))?.[1].trim()
/** The spacing scale of 2.0 (theme/tokens.css): a padding may name it instead of pixels. */
const spaces: Record<string, number> = { 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 12: 48 }
const px = (text: string | undefined) => {
  const space = text?.match(/^var\(--ck-space-(\d+)\)/)?.[1]
  return space ? spaces[space] ?? NaN : Number(text?.match(/^(\d+(?:\.\d+)?)px/)?.[1] ?? NaN)
}

/** Room for a table on the widest page: the page without its side padding, the panel padding and the two borders. */
const room = () => {
  const page = rule('.page', app)
  const sides = px(value(page, 'padding')?.split(/\s+/)[1])
  const panel = px(value(rule('.ck-merge-panel'), 'padding'))
  return px(value(page, 'max-width')) - 2 * sides - 2 * panel - 4
}

const screens = (readdirSync(new URL('features/merges/', source)) as string[]).filter((name) => name.endsWith('.tsx') && !name.includes('.test.'))
  .map((name) => read(`features/merges/${name}`)).join('\n')

describe('merge stylesheet guards (text of the rules, not rendering)', () => {
  it('fits both tables of a group into the page of a computer', () => {
    expect(room()).toBeGreaterThan(900)
    expect(value(rule('.ck-merge-table'), 'min-width')).toBeUndefined()
    for (const selector of ['.ck-merge-members', '.ck-merge-choosing', '.ck-merge-lines']) {
      const width = px(value(rule(selector), 'min-width'))
      expect(width, selector).toBeGreaterThan(0)
      expect(width, selector).toBeLessThanOrEqual(room())
    }
    // The table of a pending group has two more columns: its rule must come after the general one of the same weight.
    const order = rules(css).map((item) => item.selector)
    expect(order.indexOf('.ck-merge-members')).toBeLessThan(order.indexOf('.ck-merge-choosing'))
  })

  it('keeps free text columns wide enough for whole words', () => {
    for (const selector of ['.ck-merge-table tbody th', '.ck-merge-table .ck-merge-text']) {
      const width = px(value(rule(selector), 'min-width'))
      expect(width, selector).toBeGreaterThanOrEqual(160)
      expect(width, selector).toBeLessThanOrEqual(220)
      expect(value(rule(selector), 'white-space'), selector).toBeUndefined()
    }
  })

  it('never cuts a value, a heading or the button inside a word', () => {
    expect(value(rule('.ck-merge-table .ck-merge-number'), 'white-space')).toBe('nowrap')
    expect(value(rule('.ck-merge-table button'), 'white-space')).toBe('nowrap')
    expect(value(rule('.ck-merge-table thead th'), 'overflow-wrap')).toBe('normal')
    expect(value(rule('.ck-merge-table .ck-merge-whole'), 'overflow-wrap')).toBe('normal')
    // Dates stay whole by the rule of the shell for <time>: no rule of this screen may undo it.
    expect(value(rule(':where(time)', app), 'white-space')).toBe('nowrap')
    expect(rules(css).filter((item) => /white-space\s*:\s*(normal|pre-wrap|pre-line)/.test(item.body)).map((item) => item.selector)).toEqual([])
  })

  it('sticks the name column to the left edge of the scrolling frame over an opaque background', () => {
    const frame = rule('.ck-merge-table-scroll')
    expect(value(frame, 'overflow-x')).toBe('auto')
    expect(value(frame, 'max-width')).toBe('100%')
    for (const selector of ['.ck-merge-table tbody th', '.ck-merge-table .ck-merge-name-head']) {
      const body = rule(selector)
      expect(value(body, 'position'), selector).toBe('sticky')
      expect(value(body, 'left'), selector).toBe('0')
    }
    expect(value(rule('.ck-merge-table tbody th'), 'background')).toMatch(/^var\(--ck-[\w-]+\)$/)
    expect(value(rule('.ck-merge-table thead th'), 'background')).toMatch(/^var\(--ck-[\w-]+\)$/)
    // Collapsed borders belong to the table and would stay behind a stuck cell.
    expect(value(rule('.ck-merge-table'), 'border-collapse')).toBe('separate')
    expect(value(rule('.ck-merge-table'), 'border-spacing')).toBe('0')
  })

  it('gives every scrolling frame a label and the keyboard, and every table a stuck name heading', () => {
    const frames = screens.match(/className="ck-merge-table-scroll"[^>]*>/g) ?? []
    expect(frames).toHaveLength(2)
    for (const frame of frames) {
      expect(frame).toContain('role="region"')
      expect(frame).toMatch(/aria-label="[^"]+"/)
      expect(frame).toContain('tabIndex={0}')
    }
    expect(screens.match(/<table className=/g)).toHaveLength(2)
    expect(screens.match(/<th scope="col" className="ck-merge-name-head">/g)).toHaveLength(2)
  })

  it('takes every colour from the theme tokens and every size of the text from the scale', () => {
    expect(css.match(/#[0-9a-f]{3,8}|(?:rgb|hsl)a?\(/gi)).toBeNull()
    const sizes = [...css.matchAll(/font-size\s*:\s*([^;]+);/g)].map((match) => match[1].trim())
    expect(sizes.length).toBeGreaterThan(5)
    for (const size of sizes) expect(size).toMatch(/^var\(--ck-text-(caption|label|body|field|title|heading)\)$/)
    expect(value(rule('.ck-merge-table'), 'font-size')).toBe('var(--ck-text-label)')
    // Panels of 2.0: the surface in a line frame, no shadow; the groups of the list are rows of their panel.
    expect(rule('.ck-merge-panel')).toContain('border: 1px solid var(--ck-line); border-radius: var(--ck-radius-card); background: var(--ck-surface);')
    expect(rule('.ck-merge-panel')).not.toContain('box-shadow')
    expect(rule('.ck-merge-card')).toContain('border-top: 1px solid var(--ck-line);')
    // Only 2.0 names of the tokens: the aliases of 1.x at the end of tokens.css are going away.
    expect(css.match(/var\(--ck-(?:text-(?:xs|sm|base|lg|xl|hero|2xs)|text-muted|text|bg|border[\w-]*|divider|link[\w-]*|accent[\w-]*|primary[\w-]*|card-shadow|radius|radius-sm|font-figures|[a-z]+-(?:text|bg))\)/g)).toBeNull()
  })
})
