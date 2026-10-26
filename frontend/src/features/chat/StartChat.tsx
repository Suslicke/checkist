import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createThread } from '../../api/chat'
import type { CreateThreadInput } from '../../api/chat'
import { navigate } from '../../navigation'
import { requestFailureMessage } from '../insights/insights-state'
import { chatTexts, threadHref } from './chat-state'
import './Chat.css'

/** A button that starts a thread of «Чат с ИИ» about something — a spend («Спросить ИИ об этой трате»), a month
 * («Обсудить» on «Разбор месяца»), the plans («Спросить ИИ») — and opens it. A refusal of the server (the AI of the
 * family is off, the limit of questions) is shown under the button; nothing is asked of the model until the thread
 * has its first question (a thread of a spend or a month starts empty, a thread of the plans asks at once). */
export function StartChat({ input, className, children, busyText = chatTexts.starting }: {
  input: CreateThreadInput; className?: string; children: ReactNode; busyText?: string
}) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string>()
  const controller = useRef<AbortController | undefined>(undefined)
  useEffect(() => () => controller.current?.abort(), [])

  const start = () => {
    controller.current?.abort()
    const current = new AbortController()
    controller.current = current
    setBusy(true)
    setMessage(undefined)
    void createThread(input, { signal: current.signal }).then((result) => {
      if (current.signal.aborted || result.kind === 'aborted') return
      setBusy(false)
      if (result.kind === 'error') { setMessage(requestFailureMessage(result)); return }
      navigate(threadHref(result.data.thread.id))
    })
  }
  return <>
    <button type="button" className={className} disabled={busy} onClick={start} data-chat-start={input.kind}>{busy ? busyText : children}</button>
    {message && <p className="chat-start-failed" role="alert">{message}</p>}
  </>
}
