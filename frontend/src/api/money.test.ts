import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getMoney, isMoney } from './money'
import { moneyFixture } from './money-test-support'
import { forgetAnswers, remembersPath } from './answer-cache'

const fetchMock = vi.fn<typeof fetch>()
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
beforeEach(() => { forgetAnswers(); fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock) })
afterEach(() => { forgetAnswers(); vi.unstubAllGlobals() })

describe('«Деньги» on the wire (GET /api/money/)', () => {
  it('accepts the example of the mockup and additive fields', () => {
    expect(isMoney(moneyFixture())).toBe(true)
    expect(isMoney({ ...moneyFixture(), extra: 1 })).toBe(true)
  })
  it('requires the month, the three sums, the flow and the payments; the rest may be missing', () => {
    const { plans, goals, months, review, ...lean } = moneyFixture()
    void plans; void goals; void months; void review
    expect(isMoney(lean)).toBe(true)
    expect(isMoney({ ...moneyFixture(), payments: { left: '1.00', paid: 0, total: 0 } })).toBe(true)
    for (const key of ['month', 'currency', 'income', 'spent', 'set_aside', 'flow', 'payments'] as const) {
      const { [key]: gone, ...rest } = moneyFixture()
      void gone
      expect(isMoney(rest), key).toBe(false)
    }
  })
  it.each([
    ['month', '2026-13'], ['currency', null], ['income', 1050000], ['spent', '127500'], ['flow', { spent: '1.00' }], ['payments', { left: '1.00', paid: -1, total: 1, next: null }],
    ['plans', { left: '1.00' }], ['goals', { count: 1, share: 'x', saved: '1.00', currency: 'KZT' }], ['months', [{ month: '2026-10' }]], ['review', { month: '2026-09', change_previous: 12, tips: 1 }],
  ])('rejects %s = %j', (key, value) => {
    expect(isMoney({ ...moneyFixture(), [key]: value })).toBe(false)
  })
  it('reads the share of the goals as a decimal too, a free sum of null, and fills what a leaner server leaves out', async () => {
    const { plans, goals, months, review, ...lean } = moneyFixture()
    void plans; void months; void review
    fetchMock.mockResolvedValueOnce(json({ ...lean, flow: { ...lean.flow, free: null }, goals: { ...goals, share: '62.00', top: undefined }, payments: { left: '1.00', paid: 0, total: 0 } }))
    const result = await getMoney('2026-10')
    expect(result).toMatchObject({ kind: 'ok', data: { plans: null, months: [], review: null, payments: { next: null }, goals: { share: '62.00', top: [] }, flow: { free: null } } })
    expect(fetchMock.mock.calls[0][0]).toBe('/api/money/?month=2026-10')
  })
  it('refuses a wrong month locally and names a body of another shape', async () => {
    expect(await getMoney('2026-1')).toEqual({ kind: 'error', reason: 'invalid_parameter', fields: ['month'] })
    expect(fetchMock).not.toHaveBeenCalled()
    fetchMock.mockResolvedValueOnce(json({ month: '2026-10' }))
    expect(await getMoney()).toEqual({ kind: 'error', reason: 'invalid_response', status: 200 })
    expect(fetchMock.mock.calls[0][0]).toBe('/api/money/')
  })
  it('is shown from the memory of answers, as «Главная» is', () => {
    expect(remembersPath('money/')).toBe(true)
    expect(remembersPath('money/2026-10/')).toBe(false)
  })
})
