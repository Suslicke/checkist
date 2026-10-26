import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'
import { confirmAction, createThread, deleteThread, getMessage, getThread, listThreads, sendMessage } from '../../api/chat'
import type { ChatAction, ChatMessage, ThreadDetail, ThreadSummary } from '../../api/chat'
import RequestState from '../../components/RequestState'
import Skeleton from '../../components/Skeleton'
import { usePageTitle } from '../../components/page-header'
import { numbered } from '../../lib/text'
import { Link, navigate } from '../../navigation'
import { dashboardErrorMessage } from '../dashboard/dashboard-state'
import { follow } from '../insights/follow'
import { insightErrorMessage, modelText, requestFailureMessage } from '../insights/insights-state'
import {
  actionKey, actionLabel, bubbles, canSend, chatTexts, confirmFailureText, isDone, isPending, markActionDone, paragraphs, pendingMessages, QUESTION_MAX,
  threadDate, threadHref, threadTitle, verdictTones, verdictWords, withMessage,
} from './chat-state'
import './Chat.css'

/** What a thread shows besides its messages: nothing, a question before the deletion, or the deletion under way. */
export type DeleteStep = 'idle' | 'confirm' | 'busy'

/** The model's words of one message: paragraphs, the verdicts of the plans, the numbers it could not check, the actions
 * it offers as buttons. Plain text only, never markup. */
function ModelBubble({ message, failure, busyAction, actionErrors, onConfirm, onRetry }: {
  message: ChatMessage; failure?: string; busyAction?: string; actionErrors: Record<string, string>
  onConfirm: (message: ChatMessage, index: number) => void; onRetry: (message: ChatMessage) => void
}) {
  const pending = isPending(message) && !failure
  const failed = failure ?? (message.status === 'failed' ? insightErrorMessage(message.error?.code ?? '') : undefined)
  const answer = message.answer
  return <li className="chat-bubble chat-bubble-model" aria-busy={pending}>
    {pending && <div className="chat-typing" role="status"><span>{chatTexts.typing}</span><Skeleton compact /></div>}
    {failed && <>
      <p className="chat-failed" role="alert">{failed}</p>
      <button type="button" className="ck-button-secondary chat-retry" onClick={() => onRetry(message)}>{chatTexts.retry}</button>
    </>}
    {answer && paragraphs(answer.answer).map((paragraph, index) => <p key={index}>{modelText(paragraph)}</p>)}
    {answer && answer.verdicts.length > 0 && <div className="chat-verdicts">
      <h3>{chatTexts.verdicts}</h3>
      <ul className="chat-verdict-list">{answer.verdicts.map((item) => <li key={item.plan_id} className="chat-verdict-item">
        <span className={`chat-verdict chat-verdict-${verdictTones[item.verdict]}`}>{verdictWords[item.verdict]}</span>
        <span className="chat-verdict-name">{item.name ?? numbered('План', item.plan_id)}</span>
        <span className="chat-verdict-why">{modelText(item.reason)}</span>
      </li>)}</ul>
    </div>}
    {answer && message.unverified.length > 0 && <p className="chat-unverified">{chatTexts.unverified} {message.unverified.join(', ')}.</p>}
    {answer && message.actions.length > 0 && <ul className="chat-actions">{message.actions.map((action: ChatAction, index) => {
      const key = actionKey(message, index)
      const done = isDone(action)
      return <li key={key}>
        <button type="button" className={`chat-action${done ? ' chat-action-done' : ''}`} disabled={done || busyAction === key} aria-disabled={done || undefined}
          onClick={() => onConfirm(message, index)}>{busyAction === key ? chatTexts.sending : actionLabel(action)}</button>
        {actionErrors[key] && <p className="chat-action-error" role="alert">{actionErrors[key]}</p>}
      </li>
    })}</ul>}
  </li>
}

/** The field and «Отправить»: Enter sends, Shift+Enter breaks the line; pinned above the bottom of the window. */
export function Composer({ text, busy, notice, autoFocus = false, onText, onSubmit }: {
  text: string; busy: boolean; notice: string | null; autoFocus?: boolean; onText: (text: string) => void; onSubmit: () => void
}) {
  const submit = (event: FormEvent) => { event.preventDefault(); if (canSend(text, busy)) onSubmit() }
  const keyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
    event.preventDefault()
    if (canSend(text, busy)) onSubmit()
  }
  return <form className="chat-composer" onSubmit={submit} noValidate aria-busy={busy}>
    <label htmlFor="chat-field" className="chat-sr">{chatTexts.field}</label>
    <textarea id="chat-field" rows={1} maxLength={QUESTION_MAX} placeholder={chatTexts.placeholder} enterKeyHint="send" autoComplete="off"
      autoFocus={autoFocus} value={text} readOnly={busy} onChange={(event) => onText(event.target.value)} onKeyDown={keyDown} />
    <button type="submit" disabled={!canSend(text, busy)}>{busy ? chatTexts.sending : chatTexts.send}</button>
    {notice && <p className="chat-notice" role="alert">{notice}</p>}
    <p className="chat-note">{chatTexts.hint}</p>
  </form>
}

export type ChatViewProps = {
  /** `undefined` — still loading; a string — the loading failed with these words. */
  threads: ThreadSummary[] | string | undefined
  threadId?: number
  /** The open thread: loading, loaded, or failed with its words. */
  thread?: { kind: 'loading' } | { kind: 'ok'; data: ThreadDetail } | { kind: 'error'; message: string }
  text: string
  /** A message is on its way, or a thread is being started: the composer waits. */
  sending: boolean
  /** A refusal of the last send, under the composer. */
  notice: string | null
  /** Words of a failed wait, by the id of the message. */
  failures?: Record<number, string>
  busyAction?: string
  actionErrors?: Record<string, string>
  deleteStep?: DeleteStep
  onText?: (text: string) => void
  onSubmit?: () => void
  onConfirm?: (message: ChatMessage, index: number) => void
  onRetry?: (message: ChatMessage) => void
  onDelete?: (step: DeleteStep) => void
  onRetryThreads?: () => void
  onRetryThread?: () => void
}

/** `/chat` and `/chat/{id}` without loading: the markup tests render it directly. The list of threads is always in
 * the DOM; beside an open thread it is hidden below 960 px (Chat.css) and a 280 px rail at the left above (desktop.css). */
export function ChatView({
  threads, threadId, thread, text, sending, notice, failures = {}, busyAction, actionErrors = {}, deleteStep = 'idle',
  onText = () => {}, onSubmit = () => {}, onConfirm = () => {}, onRetry = () => {}, onDelete = () => {}, onRetryThreads = () => {}, onRetryThread = () => {},
}: ChatViewProps) {
  const open = threadId !== undefined
  const list = typeof threads === 'string' ? <RequestState kind="error" message={threads} onRetry={onRetryThreads} compact />
    : threads === undefined ? <RequestState kind="loading" message="Загружаем беседы…" compact />
    : threads.length === 0 ? <p className="chat-note">{chatTexts.noThreads}</p>
    : <ul className="ck-list chat-threads">{threads.map((item) => {
      const current = item.id === threadId
      return <li key={item.id}>
        <Link className={`ck-row chat-thread${current ? ' chat-thread-current' : ''}`} to={threadHref(item.id)} aria-current={current ? 'page' : undefined}>
          <span className="ck-row-main">
            <span className="ck-row-title">{threadTitle(item)}</span>
            <span className="ck-row-meta">{item.last_answer_preview ? modelText(item.last_answer_preview) : chatTexts.noAnswer}</span>
          </span>
          <time className="chat-thread-date" dateTime={item.updated_at}>{threadDate(item.updated_at)}</time>
        </Link>
      </li>
    })}</ul>
  const detail = thread?.kind === 'ok' ? thread.data : undefined
  const waiting = detail !== undefined && pendingMessages(detail.messages).some((message) => !failures[message.id])
  return <div className={`chat-page${open ? ' chat-open' : ''}`}>
    <section className="ck-panel chat-side" aria-labelledby="chat-threads-heading">
      <div className="ck-panel-head"><h2 id="chat-threads-heading">{chatTexts.heading}</h2>{open && <Link to="/chat">{chatTexts.newThread}</Link>}</div>
      {list}
    </section>
    <div className="chat-main">
      {!open && <section className="ck-panel chat-empty" aria-labelledby="chat-empty-heading">
        <h2 id="chat-empty-heading">{Array.isArray(threads) && threads.length > 0 ? chatTexts.newThread : chatTexts.empty}</h2>
        <p className="chat-note">{chatTexts.emptyNote}</p>
      </section>}
      {open && thread?.kind === 'loading' && <RequestState kind="loading" message="Загружаем беседу…" />}
      {open && thread?.kind === 'error' && <RequestState kind="error" message={thread.message} onRetry={onRetryThread} />}
      {detail && <section className="ck-panel chat-thread-panel" aria-labelledby="chat-thread-heading" aria-busy={waiting}>
        <div className="ck-panel-head chat-thread-head">
          <h2 id="chat-thread-heading">{threadTitle(detail.thread)}</h2>
          {deleteStep === 'idle' && <button type="button" className="ck-button-danger chat-delete" onClick={() => onDelete('confirm')}>{chatTexts.deleteThread}</button>}
        </div>
        {deleteStep !== 'idle' && <div className="chat-confirm" role="group" aria-labelledby="chat-delete-question">
          <p id="chat-delete-question">{chatTexts.deleteQuestion}</p>
          <div className="chat-confirm-actions">
            <button type="button" className="ck-button-danger" disabled={deleteStep === 'busy'} onClick={() => onDelete('busy')}>{deleteStep === 'busy' ? chatTexts.deleting : chatTexts.deleteThread}</button>
            <button type="button" className="ck-button-secondary" disabled={deleteStep === 'busy'} onClick={() => onDelete('idle')}>{chatTexts.cancel}</button>
          </div>
        </div>}
        <ol className="chat-messages" aria-live="polite">{bubbles(detail.messages).map((bubble) => bubble.kind === 'person'
          ? <li key={bubble.key} className="chat-bubble chat-bubble-person"><p>{bubble.text}</p></li>
          : <ModelBubble key={bubble.key} message={bubble.message} failure={failures[bubble.message.id]} busyAction={busyAction} actionErrors={actionErrors}
            onConfirm={onConfirm} onRetry={onRetry} />)}</ol>
        {detail.messages.length > 0 && <p className="chat-note">{chatTexts.note}</p>}
      </section>}
      {(!open || detail) && <Composer text={text} busy={sending || waiting} notice={notice} autoFocus={!open} onText={onText} onSubmit={onSubmit} />}
    </div>
  </div>
}

type ThreadLoad = NonNullable<ChatViewProps['thread']>

/** `/chat`, `/chat/{id}`, `/chat?q=`: the threads of the person and one open thread. A question starts a thread
 * (`q` — at once, and the address becomes the thread's) or goes to the open one; the answer is polled like a question
 * of «Разбор месяца» (`follow`). An action of the model is applied only by its button. The shell mounts the screen
 * anew for each thread (its key is the thread), so the state of a thread starts fresh with it. */
export default function ChatPage({ threadId, q }: { threadId?: number; q?: string }) {
  const [threads, setThreads] = useState<ThreadSummary[] | string>()
  const [thread, setThread] = useState<ThreadLoad | undefined>(() => threadId === undefined ? undefined : { kind: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [text, setText] = useState(q ?? '')
  const [sending, setSending] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [failures, setFailures] = useState<Record<number, string>>({})
  const [busyAction, setBusyAction] = useState<string>()
  const [actionErrors, setActionErrors] = useState<Record<string, string>>({})
  const [deleteStep, setDeleteStep] = useState<DeleteStep>('idle')
  const stops = useRef(new Map<number, () => void>())
  const alive = useRef(false)
  const asked = useRef(false)
  const detail = thread?.kind === 'ok' ? thread.data : undefined
  usePageTitle(detail ? threadTitle(detail.thread) : undefined)

  const reloadThreads = useCallback(() => {
    void listThreads().then((result) => {
      if (!alive.current || result.kind === 'aborted') return
      setThreads(result.kind === 'ok' ? result.data : dashboardErrorMessage(result))
    })
  }, [])

  const stopAll = () => { for (const stop of stops.current.values()) stop(); stops.current.clear() }
  const place = useCallback((message: ChatMessage) => {
    setThread((before) => before?.kind === 'ok' ? { kind: 'ok', data: { ...before.data, messages: withMessage(before.data.messages, message) } } : before)
  }, [])
  /** Polls a waiting message until the worker answers; the words of a failed wait stay with the message. */
  const watch = useCallback((message: ChatMessage) => {
    stops.current.get(message.id)?.()
    setFailures((before) => { const next = { ...before }; delete next[message.id]; return next })
    stops.current.set(message.id, follow(message, (id, signal) => getMessage(id, { signal }),
      (row) => { stops.current.delete(message.id); place(row); reloadThreads() },
      (words) => { stops.current.delete(message.id); setFailures((before) => ({ ...before, [message.id]: words })) }))
  }, [place, reloadThreads])

  useEffect(() => {
    alive.current = true
    reloadThreads()
    return () => { alive.current = false }
  }, [reloadThreads])

  useEffect(() => {
    if (threadId === undefined) return
    const controller = new AbortController()
    void getThread(threadId, { signal: controller.signal }).then((result) => {
      if (controller.signal.aborted || result.kind === 'aborted') return
      if (result.kind === 'error') { setThread({ kind: 'error', message: dashboardErrorMessage(result) }); return }
      setThread({ kind: 'ok', data: result.data })
      for (const message of pendingMessages(result.data.messages)) watch(message)
    })
    return () => { controller.abort(); stopAll() }
  }, [threadId, attempt, watch])

  /** A new thread with the question; its address replaces this one, so a reload never asks twice. */
  const start = useCallback((question: string) => {
    setSending(true)
    setNotice(null)
    void createThread({ kind: 'free', question }).then((result) => {
      if (!alive.current || result.kind === 'aborted') return
      setSending(false)
      if (result.kind === 'error') { setNotice(requestFailureMessage(result)); return }
      setText('')
      navigate(threadHref(result.data.thread.id), { replace: true })
    })
  }, [])

  useEffect(() => {
    if (!q?.trim() || asked.current || threadId !== undefined) return
    asked.current = true
    start(q.trim())
  }, [q, threadId, start])

  const send = useCallback((question: string) => {
    if (threadId === undefined) { start(question); return }
    setSending(true)
    setNotice(null)
    void sendMessage(threadId, question).then((result) => {
      if (!alive.current || result.kind === 'aborted') return
      setSending(false)
      if (result.kind === 'error') { setNotice(requestFailureMessage(result)); return }
      setText('')
      place(result.data)
      watch(result.data)
      reloadThreads()
    })
  }, [threadId, start, place, watch, reloadThreads])

  const confirm = useCallback((message: ChatMessage, index: number) => {
    const key = actionKey(message, index)
    setBusyAction(key)
    setActionErrors((before) => { const next = { ...before }; delete next[key]; return next })
    void confirmAction(message.id, index).then((result) => {
      if (!alive.current || result.kind === 'aborted') return
      setBusyAction(undefined)
      if (result.kind === 'ok') { place(result.data); return }
      const words = confirmFailureText(result)
      if (words === undefined) { place(markActionDone(message, index, new Date().toISOString())); return }
      setActionErrors((before) => ({ ...before, [key]: words }))
    })
  }, [place])

  const remove = useCallback((step: DeleteStep) => {
    setDeleteStep(step)
    if (step !== 'busy' || threadId === undefined) return
    void deleteThread(threadId).then((result) => {
      if (!alive.current || result.kind === 'aborted') return
      if (result.kind === 'error' && result.reason !== 'not_found') { setDeleteStep('confirm'); setNotice(dashboardErrorMessage(result)); return }
      navigate('/chat')
    })
  }, [threadId])

  return <ChatView threads={threads} threadId={threadId} thread={thread} text={text} sending={sending} notice={notice} failures={failures}
    busyAction={busyAction} actionErrors={actionErrors} deleteStep={deleteStep}
    onText={setText} onSubmit={() => send(text.trim())} onConfirm={confirm} onRetry={(message) => send(message.question)} onDelete={remove}
    onRetryThreads={reloadThreads} onRetryThread={() => { setThread({ kind: 'loading' }); setAttempt((value) => value + 1) }} />
}
