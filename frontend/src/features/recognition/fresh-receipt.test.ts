import { afterEach, describe, expect, it, vi } from 'vitest'
import { freshReceiptKey, markFreshReceipt, takeFreshReceipt } from './fresh-receipt'

function memoryStorage() {
  const items = new Map<string, string>()
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => { items.set(key, value) },
    removeItem: (key: string) => { items.delete(key) },
  }
}

describe('the mark of a receipt the recognition just saved (the slip prints once)', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('names one receipt and is taken once, by its page only', () => {
    vi.stubGlobal('sessionStorage', memoryStorage())
    markFreshReceipt(306)
    expect(sessionStorage.getItem(freshReceiptKey)).toBe('306')
    // Another receipt does not play the print and does not take the mark.
    expect(takeFreshReceipt(307)).toBe(false)
    expect(takeFreshReceipt(306)).toBe(true)
    expect(takeFreshReceipt(306)).toBe(false)
  })

  it('stays silent without a storage', () => {
    vi.stubGlobal('sessionStorage', { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') }, removeItem: () => {} })
    expect(() => markFreshReceipt(1)).not.toThrow()
    expect(takeFreshReceipt(1)).toBe(false)
  })
})
