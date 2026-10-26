/** Pure geometry of the ring of «Главная» (2026-10-26): spent by root category as arcs of one circle, the gap what is
 * left of the budget. Drawn as stroked circles with a dash each (Ring.tsx): the dash of a segment is its share of the
 * circumference, its offset is minus the dashes before it. No money here: the shares come as plain numbers of cents. */
import { coordinate as c } from './scale.ts'

export interface RingInput { key: string; value: number; tone: number }
export interface RingSegment {
  key: string
  tone: number
  /** 0..1 of the drawn total (the segments and the remainder). */
  share: number
  /** `stroke-dasharray` and `stroke-dashoffset` of the circle, in the units of the radius. */
  dasharray: string
  dashoffset: string
}

/** The length of the circle of the ring. */
export const ringCircumference = (radius: number) => 2 * Math.PI * radius

/**
 * The segments in input order. Non-positive and non-finite values are not drawn; `remainder` (the budget left, below
 * zero or absent — nothing) takes the unfilled part. Without a budget the segments fill the circle; with everything
 * at zero there is nothing to draw and the track alone is shown.
 */
export function ringSegments(items: readonly RingInput[], remainder: number, radius: number): RingSegment[] {
  const drawn = items.filter((item) => Number.isFinite(item.value) && item.value > 0)
  const rest = Number.isFinite(remainder) && remainder > 0 ? remainder : 0
  const total = drawn.reduce((sum, item) => sum + item.value, 0) + rest
  if (!(total > 0)) return []
  const length = ringCircumference(radius)
  let before = 0
  return drawn.map((item) => {
    const share = item.value / total
    const dash = share * length
    const segment: RingSegment = {
      key: item.key, tone: item.tone, share, dasharray: `${c(dash)} ${c(length)}`, dashoffset: c(-before),
    }
    before += dash
    return segment
  })
}
