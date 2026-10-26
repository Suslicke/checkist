import type { ReactNode } from 'react'
import { ringSegments } from './ring.ts'
import type { RingInput } from './ring.ts'

/** The box of the ring on «Главная», in CSS pixels, and the width of its stroke. */
export const RING_SIZE = 132
export const RING_STROKE = 14

/**
 * The ring of «Главная» (2026-10-26): an SVG of stroked circles — the track, then one circle per segment with a dash of
 * its share, turned to start at twelve o'clock. The words in the middle come as `children` (an absolutely placed box).
 * The file is RingChart.tsx: beside ring.ts a `Ring.tsx` would be the same name on a case-insensitive disk.
 * Colours are the category tokens by class (`ck-ring-tone-N`, Charts.css); the track is `--ck-track`.
 */
export default function Ring({ items, remainder, label, children }: { items: readonly RingInput[]; remainder: number; label: string; children?: ReactNode }) {
  const radius = (RING_SIZE - RING_STROKE) / 2
  const centre = RING_SIZE / 2
  const segments = ringSegments(items, remainder, radius)
  return <div className="ck-ring" style={{ width: RING_SIZE, height: RING_SIZE }}>
    <svg className="ck-ring-svg" viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`} width={RING_SIZE} height={RING_SIZE} role="img" aria-label={label}>
      <circle className="ck-ring-track" cx={centre} cy={centre} r={radius} strokeWidth={RING_STROKE} />
      {segments.map((segment) => <circle key={segment.key} className={`ck-ring-segment ck-ring-tone-${segment.tone}`} cx={centre} cy={centre} r={radius}
        strokeWidth={RING_STROKE} strokeDasharray={segment.dasharray} strokeDashoffset={segment.dashoffset} />)}
    </svg>
    {children && <div className="ck-ring-centre">{children}</div>}
  </div>
}
