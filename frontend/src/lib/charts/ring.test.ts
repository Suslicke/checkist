import { describe, expect, it } from 'vitest'
import { ringCircumference, ringSegments } from './ring'
import { EMPTY_HEIGHT, pulse } from './pulse'

describe('the ring of «Главная» (pure geometry)', () => {
  const radius = 59
  const length = ringCircumference(radius)

  it('gives each category its share of the circle and leaves the remainder of the budget unfilled', () => {
    const segments = ringSegments([{ key: 'a', value: 50, tone: 1 }, { key: 'b', value: 25, tone: 3 }], 25, radius)
    expect(segments.map((segment) => [segment.key, segment.tone, segment.share])).toEqual([['a', 1, 0.5], ['b', 3, 0.25]])
    expect(segments[0].dasharray).toBe(`${(length / 2).toFixed(2).replace(/\.?0+$/, '')} ${length.toFixed(2).replace(/\.?0+$/, '')}`)
    expect(segments[0].dashoffset).toBe('0')
    // The second starts where the first ends: minus the dash of the first.
    expect(Number(segments[1].dashoffset)).toBeCloseTo(-length / 2, 1)
    expect(Number(segments[1].dasharray.split(' ')[0])).toBeCloseTo(length / 4, 1)
  })

  it('fills the whole circle without a budget, and draws nothing of a month without spends', () => {
    const full = ringSegments([{ key: 'a', value: 3, tone: 1 }, { key: 'b', value: 1, tone: 2 }], 0, radius)
    expect(full.map((segment) => segment.share)).toEqual([0.75, 0.25])
    // An overspent budget (a remainder below zero) is no gap either.
    expect(ringSegments([{ key: 'a', value: 3, tone: 1 }], -10, radius)[0].share).toBe(1)
    expect(ringSegments([{ key: 'a', value: 0, tone: 1 }, { key: 'b', value: Number.NaN, tone: 2 }], 0, radius)).toEqual([])
    // Only a remainder (a budget, nothing spent): nothing drawn, the track shows the budget whole.
    expect(ringSegments([], 100, radius)).toEqual([])
  })

  it('skips a refund (a value below zero) and keeps the order of the input', () => {
    const segments = ringSegments([{ key: 'r', value: -5, tone: 4 }, { key: 'a', value: 5, tone: 1 }], 0, radius)
    expect(segments.map((segment) => segment.key)).toEqual(['a'])
  })
})

describe('the pulse of the month (pure)', () => {
  const days = [
    { day: '2026-10-01', spent: 1800 }, { day: '2026-10-02', spent: 0 }, { day: '2026-10-03', spent: 6000 },
    { day: '2026-10-04', spent: 3000 }, { day: '2026-10-05', spent: 0 }, { day: '2026-10-06', spent: 0 },
  ]

  it('marks the days with spends, today and the future, with heights of the biggest day', () => {
    const { bars, average } = pulse(days, '2026-10-04', 2700)
    expect(bars.map((bar) => bar.state)).toEqual(['on', 'off', 'on', 'today', 'future', 'future'])
    expect(bars.map((bar) => bar.height)).toEqual([30, EMPTY_HEIGHT, 100, 50, 0, 0])
    expect(average).toBe(45)
  })

  it('treats every day of a past month as past, and a tiny day stays above the empty foot', () => {
    const { bars } = pulse([{ day: '2026-09-01', spent: 1 }, { day: '2026-09-02', spent: 100000 }], undefined, 0)
    expect(bars.map((bar) => bar.state)).toEqual(['on', 'on'])
    expect(bars[0].height).toBe(EMPTY_HEIGHT + 1)
  })

  it('has no average line without spends or without an average, never above the top', () => {
    expect(pulse([{ day: '2026-10-01', spent: 0 }], '2026-10-01', 500).average).toBeNull()
    expect(pulse(days, '2026-10-04', 0).average).toBeNull()
    expect(pulse(days, '2026-10-04', 999999).average).toBe(100)
    expect(pulse([], undefined, 1)).toEqual({ bars: [], average: null })
  })
})
