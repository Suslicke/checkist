import { useEffect, useState } from 'react'
import type { Decimal } from '../../api/types'
import { cents } from './dashboard-state'
import { decimalOf } from './home-hero'

/** «Счёт числа» of the design system: 420 ms (`--ck-dur-count`), ease-out. */
export const ROLL_MS = 420

/** Motion is allowed: the person did not ask the system to reduce it (and there is a window to ask). */
function motionAllowed(): boolean {
  try {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: no-preference)').matches
  } catch {
    return false
  }
}

/** The amount between `from` and `to` at `progress` (0–1, eased): whole cents, never a Number on the screen. */
export function rollAt(from: Decimal, to: Decimal, progress: number): Decimal {
  const start = cents(from)
  const end = cents(to)
  const eased = 1 - (1 - Math.min(1, Math.max(0, progress))) ** 3
  return decimalOf(start + BigInt(Math.round(Number(end - start) * eased)))
}

type Roll = { from: Decimal; to: Decimal; at: Decimal }

/**
 * The main number of «Главная» counts from the old value to the new one when the chosen figure (or its value) changes —
 * only under `prefers-reduced-motion: no-preference`, and never across months (`scope`): another month slides in whole.
 * The first render shows the value as it is; the width of the number never moves anything else (it stands alone).
 */
export function useRolled(value: Decimal | null, scope: string): Decimal | null {
  const [seen, setSeen] = useState({ value, scope })
  const [roll, setRoll] = useState<Roll | null>(null)
  if (seen.value !== value || seen.scope !== scope) {
    // A change of the props: stored during the render (the pattern of React for «a value of the previous render»).
    setSeen({ value, scope })
    const from = roll?.at ?? seen.value
    setRoll(seen.scope === scope && from !== null && value !== null && from !== value && motionAllowed() ? { from, to: value, at: from } : null)
  }
  const rolling = roll !== null
  const from = roll?.from
  const to = roll?.to
  useEffect(() => {
    if (!rolling || from === undefined || to === undefined) return
    let frame = 0
    const start = performance.now()
    const step = (now: number) => {
      const progress = (now - start) / ROLL_MS
      if (progress >= 1) { setRoll(null); return }
      setRoll({ from, to, at: rollAt(from, to, progress) })
      frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [rolling, from, to])
  return roll ? roll.at : value
}
