import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

/** A fresh module for each case: the choice of the page lives in it. */
async function load() {
  vi.resetModules()
  return import('./privacy')
}

function storage(initial: Record<string, string> = {}) {
  const saved = new Map(Object.entries(initial))
  return {
    saved,
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => { saved.set(key, value) },
    removeItem: (key: string) => { saved.delete(key) },
  }
}

function documentWith() {
  const attributes = new Map<string, string>()
  const root = {
    attributes,
    setAttribute: (name: string, value: string) => { attributes.set(name, value) },
    removeAttribute: (name: string) => { attributes.delete(name) },
  }
  return { documentElement: root }
}

function windowWith() {
  const listeners = new Set<(event: { key: string | null }) => void>()
  return {
    listeners,
    addEventListener: (_type: string, listener: (event: { key: string | null }) => void) => { listeners.add(listener) },
    removeEventListener: (_type: string, listener: (event: { key: string | null }) => void) => { listeners.delete(listener) },
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('«Скрывать суммы» (theme/privacy.ts)', () => {
  it('keeps the choice under checkist.privacy and shows the sums by default', async () => {
    const privacy = await load()
    expect(privacy.privacyStorageKey).toBe('checkist.privacy')
    expect(privacy.privacyAttribute).toBe('data-privacy')
    vi.stubGlobal('localStorage', storage())
    expect(privacy.isPrivate()).toBe(false)
    vi.stubGlobal('localStorage', storage({ 'checkist.privacy': '1' }))
    expect(privacy.isPrivate()).toBe(true)
    // Anything but '1' is no choice.
    vi.stubGlobal('localStorage', storage({ 'checkist.privacy': 'true' }))
    expect(privacy.isPrivate()).toBe(false)
  })

  it('saves, applies the attribute to <html> and announces a switch', async () => {
    const privacy = await load()
    const saved = storage()
    const page = documentWith()
    vi.stubGlobal('localStorage', saved)
    vi.stubGlobal('document', page)
    let notified = 0
    const stop = privacy.subscribePrivacy(() => { notified += 1 })

    privacy.togglePrivacy()
    expect(privacy.isPrivate()).toBe(true)
    expect(saved.saved.get('checkist.privacy')).toBe('1')
    expect(page.documentElement.attributes.has('data-privacy')).toBe(true)
    expect(notified).toBe(1)

    privacy.setPrivate(true)
    expect(notified).toBe(1)

    privacy.togglePrivacy()
    expect(privacy.isPrivate()).toBe(false)
    expect(saved.saved.has('checkist.privacy')).toBe(false)
    expect(page.documentElement.attributes.has('data-privacy')).toBe(false)
    expect(notified).toBe(2)
    stop()
  })

  it('follows a change made in another tab while somebody listens', async () => {
    const privacy = await load()
    const saved = storage()
    const page = documentWith()
    const tab = windowWith()
    vi.stubGlobal('localStorage', saved)
    vi.stubGlobal('document', page)
    vi.stubGlobal('window', tab)
    const seen: boolean[] = []
    const stop = privacy.subscribePrivacy(() => seen.push(privacy.isPrivate()))
    expect(tab.listeners.size).toBe(1)

    saved.saved.set('checkist.privacy', '1')
    for (const listener of tab.listeners) listener({ key: 'checkist.privacy' })
    expect(seen).toEqual([true])
    expect(page.documentElement.attributes.has('data-privacy')).toBe(true)
    // Another key changes nothing.
    for (const listener of tab.listeners) listener({ key: 'checkist.theme' })
    expect(seen).toEqual([true])

    stop()
    expect(tab.listeners.size).toBe(0)
  })

  it('survives a blocked storage and a missing document: the choice lives in the open page', async () => {
    const privacy = await load()
    const refuse = () => { throw new DOMException('denied', 'SecurityError') }
    vi.stubGlobal('localStorage', { getItem: refuse, setItem: refuse, removeItem: refuse })
    expect(privacy.isPrivate()).toBe(false)
    expect(() => privacy.togglePrivacy()).not.toThrow()
    expect(privacy.isPrivate()).toBe(true)
    expect(() => privacy.applyPrivacyToDocument(true)).not.toThrow()
  })

  it('renders the sums shown on a server, whatever the page chose', async () => {
    const privacy = await load()
    privacy.setPrivate(true)
    const Probe = () => String(privacy.usePrivacy())
    expect(renderToStaticMarkup(createElement(Probe))).toBe('false')
  })
})

describe('the eye of «Скрывать суммы» (components/PrivacyToggle.tsx)', () => {
  it('is a round icon button with one name, its state in aria-pressed', async () => {
    vi.resetModules()
    const { default: PrivacyToggle } = await import('../components/PrivacyToggle')
    const html = renderToStaticMarkup(createElement(PrivacyToggle))
    expect(html).toMatch(/^<button type="button" class="ck-icon-button ck-privacy-toggle" aria-label="Скрыть суммы" aria-pressed="false" title="Скрыть суммы">/)
    expect(html).toContain('<svg class="ck-icon"')
    expect(html).toContain('aria-hidden="true"')
  })
})

describe('the stylesheet of «Скрывать суммы» (text of the rules)', () => {
  it('blurs every sum and every picture of the page: a photo of a receipt prints its sums too', async () => {
    const { readFileSync } = await import('node:fs')
    const app = readFileSync(new URL('../App.css', import.meta.url), 'utf8')
    expect(app).toContain(':root[data-privacy] .ck-money, :root[data-privacy] .ck-private { filter: blur(0.35em);')
    expect(app).toContain(':root[data-privacy] main img { filter: blur(14px); }')
  })
})
