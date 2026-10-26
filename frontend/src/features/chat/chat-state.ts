/** «Чат с ИИ»: the words of the screen and what a thread shows. No network, no React. */
import type { ChatAction, ChatMessage, ThreadKind, ThreadSummary, Verdict } from '../../api/chat'
import type { LocalApiFailure } from '../../api/types'
import { insightTexts, isActive, requestFailureMessage } from '../insights/insights-state'

export { QUESTION_MAX } from '../insights/insights-state'

export const chatTexts = {
  heading: 'Беседы',
  empty: 'Спросите о любой трате, плане или месяце',
  emptyNote: 'Отвечаю по цифрам семьи за 12 месяцев, открытым планам и регулярным платежам. Беседы видите только вы.',
  newThread: 'Новая беседа',
  noThreads: 'Бесед пока нет.',
  typing: 'печатает…',
  placeholder: 'Напишите вопрос…',
  field: 'Сообщение',
  send: 'Отправить',
  sending: 'Отправляю…',
  starting: 'Открываю беседу…',
  retry: 'Повторить',
  deleteThread: 'Удалить беседу',
  deleteQuestion: 'Удалить эту беседу? Отменить удаление нельзя.',
  deleting: 'Удаляем…',
  cancel: 'Отмена',
  verdicts: 'Взгляд со стороны',
  hint: 'Enter — отправить, Shift+Enter — новая строка.',
  note: 'Ответил ИИ по цифрам семьи — он может ошибаться. Действия выполняются только после вашего подтверждения.',
  actionDone: 'Это действие уже выполнено.',
  actionGone: 'План уже изменился или удалён — действие не выполнено.',
  unverified: insightTexts.unverified,
} as const

/** The name of a thread without a title, by its kind. */
export const kindTitles: Record<ThreadKind, string> = { free: 'Вопрос', spend: 'О трате', plans: 'О планах', month: 'О месяце' }
export function threadTitle(thread: Pick<ThreadSummary, 'kind' | 'title'>): string {
  return thread.title.trim() || kindTitles[thread.kind]
}

/** The pill of a verdict about a plan, as on the approved mock: «Берите» / «Подождите» / «Отговариваю». */
export const verdictWords: Record<Verdict, string> = { keep: 'Берите', wait: 'Подождите', drop: 'Отговариваю' }
export const verdictTones: Record<Verdict, 'yes' | 'wait' | 'no'> = { keep: 'yes', wait: 'wait', drop: 'no' }

/** One action of a message on the screen: `${message id}:${index}`. */
export const actionKey = (message: Pick<ChatMessage, 'id'>, index: number) => `${message.id}:${index}`

export const isDone = (action: Pick<ChatAction, 'done_at'>) => action.done_at !== null
/** «Подтвердить: перенести «Куртку» на ноябрь», after the confirmation «Сделано: …» (the server's words, else the label). */
export function actionLabel(action: Pick<ChatAction, 'label' | 'done_at' | 'result'>): string {
  return isDone(action) ? `Сделано: ${action.result?.trim() || action.label}` : `Подтвердить: ${action.label}`
}

export const isPending = (message: Pick<ChatMessage, 'status'>) => isActive(message)
export const pendingMessages = (messages: ChatMessage[]) => messages.filter(isPending)

/** The line of a thread as bubbles: the person's question at the right, the model's answer at the left. */
export type Bubble = { kind: 'person'; key: string; messageId: number; text: string } | { kind: 'model'; key: string; message: ChatMessage }
export function bubbles(messages: ChatMessage[]): Bubble[] {
  return messages.flatMap((message): Bubble[] => [
    ...(message.question.trim() ? [{ kind: 'person' as const, key: `q${message.id}`, messageId: message.id, text: message.question }] : []),
    { kind: 'model', key: `a${message.id}`, message },
  ])
}

/** The messages with `updated` in place of the one with its id, or appended when it is new. */
export function withMessage(messages: ChatMessage[], updated: ChatMessage): ChatMessage[] {
  return messages.some((message) => message.id === updated.id)
    ? messages.map((message) => message.id === updated.id ? updated : message)
    : [...messages, updated]
}

/** The message with its action `index` marked as done on the device (`409 action_done`: the server did it before). */
export function markActionDone(message: ChatMessage, index: number, at: string): ChatMessage {
  return { ...message, actions: message.actions.map((action, at_) => at_ === index && !isDone(action) ? { ...action, done_at: at } : action) }
}

/** The model's words as paragraphs: blank lines split them, the markup never reaches the screen. */
export function paragraphs(text: string): string[] {
  return text.split(/\n+/).map((line) => line.trim()).filter(Boolean)
}

/** The words of a refused confirmation; `undefined` for `action_done` — the screen shows the action as done instead. */
export function confirmFailureText(failure: Pick<LocalApiFailure, 'reason' | 'resetsAt'>): string | undefined {
  if (failure.reason === 'action_done') return undefined
  if (failure.reason === 'not_found' || failure.reason === 'invalid_parameter') return chatTexts.actionGone
  return requestFailureMessage(failure)
}

/** A thread opens at `/chat/{id}`. */
export const threadHref = (id: number) => `/chat/${id}`

const dayAndMonth = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' })
const timeOfDay = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' })
/** When a thread was last touched: today — the time, otherwise the day. */
export function threadDate(iso: string, now: Date = new Date()): string {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return ''
  const sameDay = at.getFullYear() === now.getFullYear() && at.getMonth() === now.getMonth() && at.getDate() === now.getDate()
  return (sameDay ? timeOfDay : dayAndMonth).format(at).replace(/\.$/, '')
}

/** The composer sends a non-empty text, and only while nothing of the thread waits for the worker. */
export function canSend(text: string, busy: boolean): boolean {
  return !busy && text.trim().length > 0
}
