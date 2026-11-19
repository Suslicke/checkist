import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defaultPlatform, detectPlatform, haptic, parsePlatform, platform, platformStorageKey, usePlatform } from './platform'

const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8')
const inline = html.slice(html.indexOf('<script>'), html.indexOf('</script>'))

afterEach(() => { vi.unstubAllGlobals() })

const page = (value?: string) => vi.stubGlobal('document', { documentElement: { dataset: value === undefined ? {} : { platform: value } } })

describe('the platform of the page (pure and with stubbed globals, no browser)', () => {
  it('reads only the two known values of the attribute', () => {
    expect(parsePlatform('ios')).toBe('ios')
    expect(parsePlatform('android')).toBe('android')
    for (const value of [undefined, null, '', 'iOS', 'desktop', 1, {}]) expect(parsePlatform(value)).toBe('android')
    expect(defaultPlatform).toBe('android')
  })

  it('tells an iPhone, an iPad and an iPad that calls itself a Mac from everything else; the override wins', () => {
    const iphone = { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1' }
    const pixel = { userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/131.0 Mobile Safari/537.36' }
    const mac = { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', platform: 'MacIntel', maxTouchPoints: 0 }
    const ipad = { ...mac, maxTouchPoints: 5 }
    expect(detectPlatform(iphone)).toBe('ios')
    expect(detectPlatform(ipad)).toBe('ios')
    expect(detectPlatform(pixel)).toBe('android')
    expect(detectPlatform(mac)).toBe('android')
    expect(detectPlatform(pixel, 'ios')).toBe('ios')
    expect(detectPlatform(iphone, 'android')).toBe('android')
    expect(detectPlatform(iphone, 'windows')).toBe('ios')
  })

  it('reads the attribute the inline script set, and Android without a document or with a failing one', () => {
    expect(platform()).toBe('android')
    page('ios')
    expect(platform()).toBe('ios')
    page('android')
    expect(platform()).toBe('android')
    page()
    expect(platform()).toBe('android')
    vi.stubGlobal('document', { get documentElement() { throw new Error('gone') } })
    expect(platform()).toBe('android')
  })

  it('gives a server render Android', () => {
    const Probe = () => usePlatform()
    page('ios')
    expect(renderToStaticMarkup(createElement(Probe))).toBe('android')
  })
})

describe('haptic response (stubbed globals, no browser)', () => {
  it('taps 10 ms on Android only and never throws', () => {
    const vibrate = vi.fn(() => true)
    vi.stubGlobal('navigator', { vibrate })
    page('android')
    haptic()
    expect(vibrate).toHaveBeenCalledWith(10)
    page('ios')
    haptic()
    expect(vibrate).toHaveBeenCalledTimes(1)
    page('android')
    vi.stubGlobal('navigator', { vibrate: () => { throw new Error('policy') } })
    expect(() => haptic()).not.toThrow()
    vi.stubGlobal('navigator', {})
    expect(() => haptic()).not.toThrow()
  })
})

describe('the inline script of index.html (text of the file)', () => {
  it('sets the platform before the first paint by the same rule, the override first', () => {
    expect(inline).toContain(`read('${platformStorageKey}')`)
    expect(inline).toContain("/iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)")
    expect(inline).toContain("forced === 'ios' || forced === 'android' ? forced : ios ? 'ios' : 'android'")
    expect(inline).toContain("root.setAttribute('data-platform', platform)")
    expect(inline).toContain("if (platform === 'ios' && 'switch' in HTMLInputElement.prototype) root.setAttribute('data-switch', 'native')")
  })

  it('blurs the sums from the first paint when the person asked for privacy', () => {
    expect(inline).toContain("if (read('checkist.privacy') === '1') root.setAttribute('data-privacy', '')")
  })

  it('guards every read of the storage', () => {
    const reader = inline.slice(inline.indexOf('var read = function'), inline.indexOf('// Theme'))
    expect(reader).toContain('try {')
    expect(reader).toContain('return null')
  })
})
