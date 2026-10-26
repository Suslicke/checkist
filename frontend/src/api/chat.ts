import { invalidIds } from './http.ts'
import { getLocalJson, mutate } from './local.ts'
import { isMonthCode } from './budget-schema.ts'
import { isExecutor } from './recognition-schema.ts'
import { amount, array, bool, choice, isId, isISODate, isISODateTime, nullable, object, record, text } from './schema.ts'
import type { Guard } from './schema.ts'
import type { Executor } from './recognition-types.ts'
import type { InsightStatus } from './insights.ts'
import type { Decimal, ISODateTime, LocalApiResult, RequestOptions } from './types.ts'

/** «Чат с ИИ» (`/api/insights/threads/`, 2026-10-26): a thread of questions to the model about a spend, the plans, a
 * month or anything else. A message of the person is an insight request of the thread (`question`); the answer comes
 * from the worker (`queued` → `running` → `succeeded` | `failed`) and is polled by `GET /api/insights/{id}/` like a
 * question of «Разбор месяца». The model may add verdicts about the plans and offer actions; an action changes nothing
 * until the person confirms it (`POST /api/insights/{id}/actions/{index}/confirm/`).
 *
 * The server is written to docs/plans/2026-10-26-planned-and-chat-design.md: the guards here require only what that
 * contract names and read every other field with `Object.hasOwn`, with a default when it is missing. */
export type ThreadKind = 'free' | 'spend' | 'plans' | 'month'
export type ThreadSummary = {
  id: number; kind: ThreadKind; title: string; updated_at: ISODateTime
  /** The start of the latest answer of the model (null — no answer yet). */
  last_answer_preview: string | null
}
export type Thread = ThreadSummary & { receipt_id: number | null; month: string | null }
export type Verdict = 'keep' | 'wait' | 'drop'
/** `name` — the plan as the server names it from the model's input; missing or null — the screen says «План №N». */
export type ChatVerdict = { plan_id: number; verdict: Verdict; reason: string; name: string | null }
export type ActionKind = 'move_plan' | 'delete_plan' | 'change_amount' | 'create_plan'
/** An action the model offers; `done_at` and `result` are set by the server once the person confirmed it. */
export type ChatAction = {
  kind: ActionKind; label: string
  plan_id?: number; due?: string | null; due_exact?: boolean; amount?: Decimal; name?: string; category_id?: number | null
  done_at: ISODateTime | null; result: string | null
}
export type ChatAnswer = { answer: string; verdicts: ChatVerdict[] }
export type ChatMessage = {
  id: number; question: string; status: InsightStatus
  /** Only with `succeeded`. */
  answer: ChatAnswer | null
  actions: ChatAction[]
  /** Numbers of the answer that are not in the summary the model got: shown as not checked. */
  unverified: string[]
  /** Only with `failed`; the client shows its own words by `code`. */
  error: { code: string; message: string } | null
  created_at: ISODateTime | null
  executor: Executor
}
export type ThreadDetail = { thread: Thread; messages: ChatMessage[] }
export type CreateThreadInput = { kind: ThreadKind; receipt_id?: number; month?: string; question?: string }

const THREAD_KINDS: ThreadKind[] = ['free', 'spend', 'plans', 'month']
const ACTION_KINDS: ActionKind[] = ['move_plan', 'delete_plan', 'change_amount', 'create_plan']
const isStatus = choice('queued', 'running', 'succeeded', 'failed')
type Raw = Record<string, unknown>
const isVerdict = (value: unknown): value is Raw => record(value) && isId(value.plan_id) && choice('keep', 'wait', 'drop')(value.verdict) && text(value.reason)
const isVerdicts = array(isVerdict)
/** The worker as a request of «Разбор месяца» carries it; a message of a thread may come without it. */
const IDLE_EXECUTOR: Executor = { available: true, state: 'idle', last_seen_at: null }

/** The value of an optional field when it is there and well-formed; otherwise `fallback`. */
function optional<T>(value: Record<string, unknown>, key: string, check: (value: unknown) => boolean, fallback: T): T {
  return Object.hasOwn(value, key) && check(value[key]) ? value[key] as T : fallback
}

const isRawAction = (value: unknown): value is Raw => record(value) && choice(...ACTION_KINDS)(value.kind) && text(value.label)
const isRawAnswer = (value: unknown): value is Raw => record(value) && text(value.answer)
  && (!Object.hasOwn(value, 'verdicts') || value.verdicts === null || isVerdicts(value.verdicts))
/** A message: the fields of the contract are required, the answer only with `succeeded` and every action well-formed. */
const isRawMessage = (value: unknown): value is Raw => record(value) && isId(value.id) && text(value.question) && isStatus(value.status)
  && Object.hasOwn(value, 'answer') && (value.answer === null ? value.status !== 'succeeded' : isRawAnswer(value.answer))
  && (!Object.hasOwn(value, 'actions') || value.actions === null || array(isRawAction)(value.actions))
const isRawThread = (value: unknown): value is Raw => record(value) && isId(value.id) && choice(...THREAD_KINDS)(value.kind)
  && text(value.title) && isISODateTime(value.updated_at)
const isRawDetail = (value: unknown): value is Raw => record(value) && isRawThread(value.thread) && array(isRawMessage)(value.messages)
/** A created thread: the detail, or the thread itself with its first request beside it (any of the shapes a 201 may take). */
const isRawCreated = (value: unknown): value is Raw => isRawDetail(value) || isRawThread(value)
const isRawThreads = (value: unknown): value is unknown[] | { results: unknown[] } => (Array.isArray(value) && value.every(isRawThread))
  || (record(value) && Array.isArray(value.results) && value.results.every(isRawThread))
const isEmpty = (value: unknown): value is null => value === null

function toVerdict(raw: Raw): ChatVerdict {
  return { plan_id: raw.plan_id as number, verdict: raw.verdict as Verdict, reason: raw.reason as string, name: optional(raw, 'name', text, null) }
}

function toAction(raw: Raw): ChatAction {
  const action: ChatAction = {
    kind: raw.kind as ActionKind, label: raw.label as string,
    done_at: optional(raw, 'done_at', isISODateTime, null), result: optional(raw, 'result', text, null),
  }
  if (Object.hasOwn(raw, 'plan_id') && isId(raw.plan_id)) action.plan_id = raw.plan_id
  if (Object.hasOwn(raw, 'due') && nullable(isISODate)(raw.due)) action.due = raw.due as string | null
  if (Object.hasOwn(raw, 'due_exact') && bool(raw.due_exact)) action.due_exact = raw.due_exact as boolean
  if (Object.hasOwn(raw, 'amount') && amount(raw.amount)) action.amount = raw.amount as Decimal
  if (Object.hasOwn(raw, 'name') && text(raw.name)) action.name = raw.name as string
  if (Object.hasOwn(raw, 'category_id') && nullable(isId)(raw.category_id)) action.category_id = raw.category_id as number | null
  return action
}

function toMessage(raw: Raw): ChatMessage {
  const answer = raw.answer as Raw | null
  // A failure comes as `error: {code, message}` (the shape of «Разбор месяца») or as `error_code` of the contract.
  const error = optional<{ code: string; message: string } | null>(raw, 'error', object<{ code: string; message: string }>({ code: text, message: text }), null)
    ?? (Object.hasOwn(raw, 'error_code') && text(raw.error_code) && raw.error_code ? { code: raw.error_code as string, message: '' } : null)
  return {
    id: raw.id as number, question: raw.question as string, status: raw.status as InsightStatus,
    answer: answer === null ? null : { answer: answer.answer as string, verdicts: (optional<Raw[] | null>(answer, 'verdicts', isVerdicts, null) ?? []).map(toVerdict) },
    actions: (optional<Raw[] | null>(raw, 'actions', array(isRawAction), null) ?? []).map(toAction),
    unverified: optional(raw, 'unverified', array(text), []),
    error: raw.status === 'failed' ? error ?? { code: '', message: '' } : null,
    created_at: optional(raw, 'created_at', isISODateTime, null),
    executor: optional(raw, 'executor', isExecutor, IDLE_EXECUTOR),
  }
}

function toThread(raw: Raw): Thread {
  return {
    id: raw.id as number, kind: raw.kind as ThreadKind, title: raw.title as string, updated_at: raw.updated_at as ISODateTime,
    last_answer_preview: optional(raw, 'last_answer_preview', text, null),
    receipt_id: optional(raw, 'receipt_id', isId, null), month: optional(raw, 'month', isMonthCode, null),
  }
}

function toDetail(raw: Raw): ThreadDetail {
  if (isRawDetail(raw)) return { thread: toThread(raw.thread as Raw), messages: (raw.messages as Raw[]).map(toMessage) }
  // A bare thread of a 201: its first request may stand beside it as `request` or `message`.
  const first = ['request', 'message'].map((key) => raw[key]).find(isRawMessage)
  return { thread: toThread(raw), messages: first ? [toMessage(first)] : [] }
}

async function mapped<R, T>(promise: Promise<LocalApiResult<R>>, map: (raw: R) => T): Promise<LocalApiResult<T>> {
  const result = await promise
  return result.kind === 'ok' ? { kind: 'ok', data: map(result.data) } : result
}
const send = <T>(path: string, body: unknown, guard: Guard<T>, options: RequestOptions, method: 'POST' | 'DELETE' = 'POST') =>
  mutate(path, body === undefined ? '' : JSON.stringify(body), guard, options, false, undefined, { method })

/** The person's threads, newest first; nobody else sees them. */
export function listThreads(options: RequestOptions = {}): Promise<LocalApiResult<ThreadSummary[]>> {
  return mapped(getLocalJson('insights/threads/', {}, isRawThreads, options),
    (data) => (Array.isArray(data) ? data : data.results).map((row) => toThread(row as Raw)))
}
/** A new thread; with a `question`, or with `kind: 'plans'`, its first request is queued at once (`use_ai`, the limits
 * of «Спросить» → `429 parse_limit`). `receipt_id` goes with `spend`, `month` with `month`. */
export async function createThread(input: CreateThreadInput, options: RequestOptions = {}): Promise<LocalApiResult<ThreadDetail>> {
  if (input.receipt_id !== undefined && !isId(input.receipt_id)) return { kind: 'error', reason: 'invalid_parameter', fields: ['receipt_id'] }
  if (input.month !== undefined && !isMonthCode(input.month)) return { kind: 'error', reason: 'invalid_parameter', fields: ['month'] }
  const body: CreateThreadInput = { kind: input.kind }
  if (input.receipt_id !== undefined) body.receipt_id = input.receipt_id
  if (input.month !== undefined) body.month = input.month
  if (input.question?.trim()) body.question = input.question.trim()
  return mapped(send('insights/threads/', body, isRawCreated, options), toDetail)
}
/** The thread and its messages in order; polled by the screen while a message waits for the worker. */
export async function getThread(id: number, options: RequestOptions = {}): Promise<LocalApiResult<ThreadDetail>> {
  return invalidIds({ id }, options.signal) ?? mapped(getLocalJson(`insights/threads/${id}/`, {}, isRawDetail, options), toDetail)
}
export async function sendMessage(threadId: number, question: string, options: RequestOptions = {}): Promise<LocalApiResult<ChatMessage>> {
  return invalidIds({ threadId }, options.signal) ?? mapped(send(`insights/threads/${threadId}/messages/`, { question: question.trim() }, isRawMessage, options), toMessage)
}
export async function deleteThread(id: number, options: RequestOptions = {}): Promise<LocalApiResult<null>> {
  return invalidIds({ id }, options.signal) ?? send(`insights/threads/${id}/`, undefined, isEmpty, options, 'DELETE')
}
/** One message by the id of its request (the same `GET /api/insights/{id}/` as a question of «Разбор месяца»). */
export async function getMessage(id: number, options: RequestOptions = {}): Promise<LocalApiResult<ChatMessage>> {
  return invalidIds({ id }, options.signal) ?? mapped(getLocalJson(`insights/${id}/`, {}, isRawMessage, options), toMessage)
}
/** Applies the action `index` of the message; the answer is the message with `done_at` and `result` set.
 * Already applied — `409 action_done`: the screen shows it as done. */
export async function confirmAction(requestId: number, index: number, options: RequestOptions = {}): Promise<LocalApiResult<ChatMessage>> {
  if (!Number.isSafeInteger(index) || index < 0) return { kind: 'error', reason: 'invalid_parameter', fields: ['index'] }
  return invalidIds({ requestId }, options.signal) ?? mapped(send(`insights/${requestId}/actions/${index}/confirm/`, {}, isRawMessage, options), toMessage)
}

export { isRawMessage as isChatMessageShape, isRawThread as isThreadShape }
