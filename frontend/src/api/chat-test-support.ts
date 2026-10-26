import type { ChatAction, ChatMessage, Thread, ThreadDetail, ThreadSummary } from './chat.ts'

const executor = { available: true, state: 'idle' as const, last_seen_at: null }

/** An answered message of a free thread: «Сколько ушло на кафе в сентябре?» → «В сентябре на кафе ушло 49 819 ₸.». */
export function chatMessageFixture(patch: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 31, question: 'Сколько ушло на кафе в сентябре?', status: 'succeeded',
    answer: { answer: 'В сентябре на кафе ушло 49 819 ₸ — на 5 714 ₸ меньше, чем в августе.', verdicts: [] },
    actions: [], unverified: [], error: null, created_at: '2026-10-26T09:20:00Z', executor, ...patch,
  }
}

/** The two actions of the plans thread: moving the jacket (not confirmed) and dropping the lamp (done). */
export function chatActionsFixture(): ChatAction[] {
  return [
    { kind: 'move_plan', label: 'перенести «Куртку» на ноябрь', plan_id: 4, due: '2026-11-01', due_exact: false, done_at: null, result: null },
    { kind: 'delete_plan', label: 'убрать «Лампу в спальню»', plan_id: 9, done_at: '2026-10-26T09:31:00Z', result: 'План «Лампа в спальню» удалён.' },
  ]
}

/** The free thread of `chatMessageFixture`, as `GET /api/insights/threads/{id}/` returns it. */
export function chatThreadFixture(patch: Partial<Thread> = {}): ThreadDetail {
  const thread: Thread = { id: 5, kind: 'free', title: 'Сколько ушло на кафе в сентябре?', updated_at: '2026-10-26T09:20:20Z',
    last_answer_preview: 'В сентябре на кафе ушло 49 819 ₸', receipt_id: null, month: null, ...patch }
  return { thread, messages: [chatMessageFixture()] }
}

/** The plans thread: the question the server asked itself, the verdicts of three plans and two actions, one done. */
export function plansThreadFixture(): ThreadDetail {
  const thread: Thread = { id: 6, kind: 'plans', title: 'Мои планы', updated_at: '2026-10-26T09:31:00Z',
    last_answer_preview: 'Два плана я бы отложил, один убрал.', receipt_id: null, month: null }
  const message = chatMessageFixture({
    id: 32, question: 'Посмотрите мои планы: что брать, что отложить, от чего отговорите',
    answer: {
      answer: 'Ноябрь получается тяжёлым: 320 000 ₸ планов плюс обязательные платежи 356 000 ₸. Два плана я бы отложил, один убрал.',
      verdicts: [
        { plan_id: 2, verdict: 'keep', reason: 'Срок 1 февраля, 57 000 ₸ уже на депозите «Зима».' },
        { plan_id: 4, verdict: 'wait', reason: 'Без срока и ничего не отложено — к марту хватит без займа из бюджета ноября.' },
        { plan_id: 9, verdict: 'drop', reason: 'Лимит «Дом» в октябре уже 112 %.' },
      ],
    },
    actions: chatActionsFixture(), unverified: ['356 000 ₸'],
  })
  return { thread, messages: [message] }
}

/** The list of `GET /api/insights/threads/`: the plans thread, then the free one. */
export function chatThreadsFixture(): ThreadSummary[] {
  return [plansThreadFixture().thread, chatThreadFixture().thread].map(({ id, kind, title, updated_at, last_answer_preview }) => ({ id, kind, title, updated_at, last_answer_preview }))
}
