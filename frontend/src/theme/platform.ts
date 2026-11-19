import { useSyncExternalStore } from 'react'

/** The grammar of the bars, the sheets, «назад» and the response to a press (docs/design-system/platforms.md). A
 * computer takes the Android one: Material is closer to the web. */
export type Platform = 'ios' | 'android'

/** Set by the inline script of index.html before the first paint; this override wins over the device, for a check. */
export const platformStorageKey = 'checkist.platform'
/** What a server render, a test in Node and a document without the attribute see. */
export const defaultPlatform: Platform = 'android'

/** The value of `<html data-platform>`; anything else is the default. */
export function parsePlatform(value: unknown): Platform {
  return value === 'ios' || value === 'android' ? value : defaultPlatform
}

/** The same decision as the inline script of index.html (kept there because it must run before the first paint):
 * the saved override, otherwise an iPhone, an iPad or an iPad that calls itself a Mac. */
export function detectPlatform(device: { userAgent: string; platform?: string; maxTouchPoints?: number }, forced?: string | null): Platform {
  if (forced === 'ios' || forced === 'android') return forced
  const ios = /iPhone|iPad|iPod/.test(device.userAgent) || (device.platform === 'MacIntel' && (device.maxTouchPoints ?? 0) > 1)
  return ios ? 'ios' : 'android'
}

/** The platform of this page: the attribute the inline script has set. It never changes while the page lives. */
export function platform(): Platform {
  try {
    return parsePlatform(typeof document === 'undefined' ? undefined : document.documentElement.dataset.platform)
  } catch {
    return defaultPlatform
  }
}

const subscribe = () => () => {}
const getServerSnapshot = (): Platform => defaultPlatform

/** The platform for a component: the attribute of `<html>`; a server render sees Android. */
export function usePlatform(): Platform {
  return useSyncExternalStore(subscribe, platform, getServerSnapshot)
}

/** A short tap of the motor on Android (`navigator.vibrate`), for a switch, the threshold of a swipe and a saved form —
 * once per action. iOS has no Vibration API: there the system switch gives the response. Never throws. */
export function haptic(): void {
  if (platform() !== 'android') return
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') navigator.vibrate(10)
  } catch {
    // A browser that refuses (no user activation, a policy) simply stays silent.
  }
}
