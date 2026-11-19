import { useSyncExternalStore } from 'react'
import { getOfflineStatus, offlineMessage, subscribeOfflineStatus } from './status'
import type { OfflineStatus } from './status'
import { offlineIcon } from './icon'
import './Offline.css'


/** The words of the banner; a separate view for the markup test. A calm strip of the page (Чекист 2.0): the state in
 * words with its picture, not a colour of alarm — nothing failed, the app works from the phone. */
export function OfflineBannerView({ status }: { status: OfflineStatus }) {
  const message = offlineMessage(status)
  if (!message) return null
  return <div className="offline-banner" role="status">
    <svg className="offline-banner-icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
      {offlineIcon.map((d) => <path key={d} d={d} />)}</svg>
    <p><strong>{message.title}.</strong> {message.detail}</p>
  </div>
}

/** A small strip at the top while there is no network or the API answered from the phone. */
export default function OfflineBanner() {
  const status = useSyncExternalStore(subscribeOfflineStatus, getOfflineStatus, getOfflineStatus)
  return <OfflineBannerView status={status} />
}
