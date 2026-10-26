import { readdirSync, readFileSync } from 'node:fs'
import type { ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { confirmAction, createThread, getMessage, isChatMessageShape, isThreadShape, listThreads, sendMessage } from '../../api/chat'
import { chatActionsFixture, chatMessageFixture, chatThreadFixture, chatThreadsFixture, plansThreadFixture } from '../../api/chat-test-support'
import { aiTexts } from '../../lib/ai'
import { buildRoute, parseRoute } from '../../navigation'
import { isHubSection, isMoreSection } from '../../menu/back-target'
import { backTarget } from '../../menu/back-target'
import { insightTexts } from '../insights/insights-state'
import { ChatView } from './ChatPage'
import {
  actionLabel, bubbles, canSend, chatTexts, confirmFailureText, isDone, kindTitles, markActionDone, paragraphs, pendingMessages, threadDate,
  threadHref, threadTitle, verdictTones, verdictWords, withMessage,
} from './chat-state'

const NBSP = String.fromCharCode(0xa0)
const plain = (text: string) => text.replaceAll(NBSP, ' ')
const html = (node: ReactElement) => plain(renderToStaticMarkup(node).replace(/<svg\b.*?<\/svg>/g, ''))
const words = (markup: string) => markup.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()

/** A JSON answer of the local API. */
function answer(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('words and helpers of the chat (chat-state.ts)', () => {
  it('names a thread by its title, else by its kind', () => {
    expect(threadTitle({ kind: 'free', title: 'Сколько ушло на кафе?' })).toBe('Сколько ушло на кафе?')
    expect(threadTitle({ kind: 'spend', title: '  ' })).toBe(kindTitles.spend)
    expect(threadHref(5)).toBe('/chat/5')
  })
  it('gives each verdict its word and tone from the approved mock', () => {
    expect(verdictWords).toEqual({ keep: 'Берите', wait: 'Подождите', drop: 'Отговариваю' })
    expect(verdictTones).toEqual({ keep: 'yes', wait: 'wait', drop: 'no' })
  })
  it('labels an action «Подтвердить: …» until it is done, then «Сделано: …» with the server\'s words', () => {
    const [pending, done] = chatActionsFixture()
    expect(isDone(pending)).toBe(false)
    expect(actionLabel(pending)).toBe('Подтвердить: перенести «Куртку» на ноябрь')
    expect(isDone(done)).toBe(true)
    expect(actionLabel(done)).toBe('Сделано: План «Лампа в спальню» удалён.')
    expect(actionLabel({ ...done, result: null })).toBe('Сделано: убрать «Лампу в спальню»')
    const marked = markActionDone(chatMessageFixture({ actions: chatActionsFixture() }), 0, '2026-10-26T10:00:00Z')
    expect(marked.actions.map((action) => action.done_at)).toEqual(['2026-10-26T10:00:00Z', '2026-10-26T09:31:00Z'])
  })
  it('lays a thread out as bubbles: the question, then the answer; a question the server left empty is not a bubble', () => {
    const line = bubbles([chatMessageFixture(), chatMessageFixture({ id: 40, question: '', status: 'queued', answer: null })])
    expect(line.map((bubble) => [bubble.kind, bubble.key])).toEqual([['person', 'q31'], ['model', 'a31'], ['model', 'a40']])
    expect(pendingMessages([chatMessageFixture(), chatMessageFixture({ id: 40, status: 'running', answer: null })]).map((row) => row.id)).toEqual([40])
    const replaced = withMessage([chatMessageFixture()], chatMessageFixture({ unverified: ['1 ₸'] }))
    expect(replaced).toHaveLength(1)
    expect(replaced[0].unverified).toEqual(['1 ₸'])
    expect(withMessage([chatMessageFixture()], chatMessageFixture({ id: 41 })).map((row) => row.id)).toEqual([31, 41])
  })
  it('splits the model\'s text into paragraphs and checks what the composer may send', () => {
    expect(paragraphs(' Первый.\n\nВторой. \n')).toEqual(['Первый.', 'Второй.'])
    expect(canSend('  ', false)).toBe(false)
    expect(canSend('Сколько?', true)).toBe(false)
    expect(canSend('Сколько?', false)).toBe(true)
  })
  it('explains a refused confirmation, and leaves «уже сделано» to the screen', () => {
    expect(confirmFailureText({ reason: 'action_done' })).toBeUndefined()
    expect(confirmFailureText({ reason: 'not_found' })).toBe(chatTexts.actionGone)
    expect(confirmFailureText({ reason: 'ai_disabled' })).toBe(aiTexts.disabled)
  })
  it('dates a thread by the time today and by the day otherwise', () => {
    const now = new Date(2026, 9, 26, 12, 0)
    expect(threadDate(new Date(2026, 9, 26, 9, 5).toISOString(), now)).toBe('09:05')
    expect(plain(threadDate(new Date(2026, 9, 2, 9, 5).toISOString(), now))).toBe('2 окт')
    expect(threadDate('nope', now)).toBe('')
  })
})

describe('routes and menu of the chat', () => {
  it('opens /chat, /chat/{id} and /chat?q=; the old /ask leads here too', () => {
    expect(parseRoute('/chat')).toEqual({ kind: 'chat' })
    expect(parseRoute('/chat/5')).toEqual({ kind: 'chat', threadId: 5 })
    expect(parseRoute('/chat/0')).toEqual({ kind: 'not-found', path: '/chat/0' })
    expect(parseRoute('/chat?q=%20Сколько%20на%20кафе%3F%20')).toEqual({ kind: 'chat', q: 'Сколько на кафе?' })
    expect(parseRoute('/ask?q=кафе')).toEqual({ kind: 'chat', q: 'кафе' })
    expect(parseRoute('/ask')).toEqual({ kind: 'chat' })
    expect(buildRoute({ kind: 'chat' })).toBe('/chat')
    expect(buildRoute({ kind: 'chat', threadId: 5 })).toBe('/chat/5')
    expect(buildRoute({ kind: 'chat', q: 'кафе & такси' })).toBe('/chat?q=%D0%BA%D0%B0%D1%84%D0%B5+%26+%D1%82%D0%B0%D0%BA%D1%81%D0%B8')
  })
  it('is a section of «Деньги» (2026-10-26), not of «Ещё»; a thread goes back to the list', () => {
    expect(isHubSection('/money', { kind: 'chat' })).toBe(true)
    expect(isMoreSection({ kind: 'chat' })).toBe(false)
    expect(backTarget({ route: { kind: 'chat', threadId: 5 } })).toEqual({ to: '/chat', label: 'Назад к беседам' })
    expect(backTarget({ route: { kind: 'chat' } })).toBeUndefined()
  })
})

describe('guards of the chat API (api/chat.ts)', () => {
  it('requires the fields of the contract and reads the optional ones with a default', async () => {
    expect(isChatMessageShape(chatMessageFixture())).toBe(true)
    expect(isChatMessageShape({ id: 1, question: 'q', status: 'queued', answer: null })).toBe(true)
    expect(isChatMessageShape({ id: 1, question: 'q', status: 'succeeded', answer: null })).toBe(false)  // succeeded needs an answer
    expect(isChatMessageShape({ id: 1, question: 'q', status: 'succeeded', answer: { answer: 'a', verdicts: [{ plan_id: 1, verdict: 'maybe', reason: '' }] } })).toBe(false)
    expect(isThreadShape({ id: 5, kind: 'free', title: 't', updated_at: '2026-10-26T09:20:20Z' })).toBe(true)
    expect(isThreadShape({ id: 5, kind: 'other', title: 't', updated_at: '2026-10-26T09:20:20Z' })).toBe(false)
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    // A message of the contract: `error_code` instead of `error`, no `executor`, no `actions`.
    fetchMock.mockResolvedValueOnce(answer(200, { id: 7, question: 'q', status: 'failed', answer: null, error_code: 'timeout', unverified: [] }))
    const failed = await getMessage(7)
    expect(failed.kind).toBe('ok')
    if (failed.kind === 'ok') {
      expect(failed.data.error).toEqual({ code: 'timeout', message: '' })
      expect(failed.data.actions).toEqual([])
      expect(failed.data.executor.state).toBe('idle')
    }
    // The list may come bare or under `results`; a bare thread of a 201 becomes a detail without messages.
    fetchMock.mockResolvedValueOnce(answer(200, chatThreadsFixture()))
    const bare = await listThreads()
    expect(bare.kind === 'ok' && bare.data.map((row) => row.id)).toEqual([6, 5])
    fetchMock.mockResolvedValueOnce(answer(200, { results: chatThreadsFixture().slice(1) }))
    const wrapped = await listThreads()
    expect(wrapped.kind === 'ok' && wrapped.data.map((row) => row.id)).toEqual([5])
    expect(await createThread({ kind: 'spend', receipt_id: 0 })).toEqual({ kind: 'error', reason: 'invalid_parameter', fields: ['receipt_id'] })
    expect(await createThread({ kind: 'month', month: '2026-13' })).toEqual({ kind: 'error', reason: 'invalid_parameter', fields: ['month'] })
    expect(await sendMessage(0, 'q')).toEqual({ kind: 'error', reason: 'invalid_parameter', fields: ['threadId'] })
    expect(await confirmAction(3, -1)).toEqual({ kind: 'error', reason: 'invalid_parameter', fields: ['index'] })
    vi.unstubAllGlobals()
  })
})

describe('markup of the chat (ChatView)', () => {
  const threads = chatThreadsFixture()

  it('shows the empty state with the composer when there are no threads', () => {
    const markup = html(<ChatView threads={[]} text="" sending={false} notice={null} />)
    expect(markup).toContain(`<h2 id="chat-empty-heading">${chatTexts.empty}</h2>`)
    expect(markup).toContain(chatTexts.noThreads)
    expect(markup).toContain('<textarea id="chat-field" rows="1" maxLength="300"')
    expect(markup).toContain(`disabled="">${chatTexts.send}</button>`)
    expect(markup).not.toContain('chat-open')
  })

  it('lists the threads, newest first, with the start of the last answer, and offers a new thread', () => {
    const markup = html(<ChatView threads={threads} text="Сколько?" sending={false} notice={null} />)
    const text = words(markup)
    expect(text).toContain('Беседы Мои планы Два плана я бы отложил, один убрал.')
    expect(markup).toContain('<a class="ck-row chat-thread" href="/chat/6">')
    expect(markup).toContain('<a class="ck-row chat-thread" href="/chat/5">')
    expect(markup).toContain(`<h2 id="chat-empty-heading">${chatTexts.newThread}</h2>`)
    expect(markup).not.toContain(`disabled="">${chatTexts.send}</button>`)  // something typed
  })

  it('shows an open thread as bubbles: the person at the right, the model at the left, the list beside it marked', () => {
    const markup = html(<ChatView threads={threads} threadId={5} thread={{ kind: 'ok', data: chatThreadFixture() }} text="" sending={false} notice={null} />)
    expect(markup).toContain('<div class="chat-page chat-open">')
    expect(markup).toContain('<a class="ck-row chat-thread chat-thread-current" aria-current="page" href="/chat/5">')
    expect(markup).toContain('<li class="chat-bubble chat-bubble-person"><p>Сколько ушло на кафе в сентябре?</p></li>')
    expect(markup).toContain('<li class="chat-bubble chat-bubble-model" aria-busy="false"><p>В сентябре на кафе ушло 49 819 ₸ — на 5 714 ₸ меньше, чем в августе.</p></li>')
    expect(markup).toContain(`>${chatTexts.deleteThread}</button>`)
    expect(markup).toContain(`<h2 id="chat-thread-heading">${chatThreadFixture().thread.title}</h2>`)
  })

  it('renders the verdicts as a card (the plan by its name, «План №N» without one), the unchecked numbers, and the actions as buttons — done ones disabled', () => {
    const markup = html(<ChatView threads={threads} threadId={6} thread={{ kind: 'ok', data: plansThreadFixture() }} text="" sending={false} notice={null} />)
    expect(markup).toContain(`<h3>${chatTexts.verdicts}</h3>`)
    expect(markup).toContain('<span class="chat-verdict chat-verdict-yes">Берите</span><span class="chat-verdict-name">Поездка в Алматы</span>')
    expect(markup).toContain('<span class="chat-verdict chat-verdict-wait">Подождите</span>')
    expect(markup).toContain('<span class="chat-verdict chat-verdict-no">Отговариваю</span><span class="chat-verdict-name">План №9</span><span class="chat-verdict-why">Лимит «Дом» в октябре уже 112 %.</span>')
    expect(markup).toContain(`<p class="chat-unverified">${insightTexts.unverified} 356 000 ₸.</p>`)
    expect(markup).toContain('<button type="button" class="chat-action">Подтвердить: перенести «Куртку» на ноябрь</button>')
    expect(markup).toContain('<button type="button" class="chat-action chat-action-done" disabled="" aria-disabled="true">Сделано: План «Лампа в спальню» удалён.</button>')
  })

  it('draws a waiting answer as «печатает…» over a static skeleton and locks the composer; a failed one offers «Повторить»', () => {
    const waiting = chatThreadFixture()
    waiting.messages = [chatMessageFixture({ id: 33, status: 'queued', answer: null })]
    const markup = html(<ChatView threads={threads} threadId={5} thread={{ kind: 'ok', data: waiting }} text="и ещё" sending={false} notice={null} />)
    expect(markup).toContain(`<li class="chat-bubble chat-bubble-model" aria-busy="true"><div class="chat-typing" role="status"><span>${chatTexts.typing}</span><div class="ck-skel ck-skel-compact" data-skeleton="compact" aria-hidden="true">`)
    expect(markup).toContain('readOnly=""')
    expect(markup).toContain(`disabled="">${chatTexts.sending}</button>`)
    const failed = chatThreadFixture()
    failed.messages = [chatMessageFixture({ id: 34, status: 'failed', answer: null, error: { code: 'timeout', message: 'x' } })]
    const again = html(<ChatView threads={threads} threadId={5} thread={{ kind: 'ok', data: failed }} text="" sending={false} notice={null} />)
    expect(again).toContain(`<p class="chat-failed" role="alert">${insightTexts.timeout}</p>`)
    expect(again).toContain(`class="ck-button-secondary chat-retry">${chatTexts.retry}</button>`)
    // A wait that gave up on the device: its words stand in place of the skeleton.
    const gaveUp = html(<ChatView threads={threads} threadId={5} thread={{ kind: 'ok', data: waiting }} failures={{ 33: insightTexts.slow }} text="" sending={false} notice={null} />)
    expect(gaveUp).toContain(`<p class="chat-failed" role="alert">${insightTexts.slow}</p>`)
    expect(gaveUp).not.toContain(chatTexts.typing)
  })

  it('shows a refusal under the composer, the question before a deletion, and the loading states', () => {
    const refused = html(<ChatView threads={threads} text="Сколько?" sending={false} notice={aiTexts.disabled} />)
    expect(refused).toContain(`<p class="chat-notice" role="alert">${aiTexts.disabled}</p>`)
    const asking = html(<ChatView threads={threads} threadId={5} thread={{ kind: 'ok', data: chatThreadFixture() }} deleteStep="confirm" text="" sending={false} notice={null} />)
    expect(asking).toContain(`<p id="chat-delete-question">${chatTexts.deleteQuestion}</p>`)
    expect(asking).toContain(`>${chatTexts.cancel}</button>`)
    const loading = html(<ChatView threads={undefined} threadId={5} thread={{ kind: 'loading' }} text="" sending={false} notice={null} />)
    expect(loading).toContain('data-skeleton="compact"')
    expect(loading).toContain('data-skeleton="page"')
    expect(loading).not.toContain('chat-composer')
    const broken = html(<ChatView threads="Нет сети" threadId={5} thread={{ kind: 'error', message: 'Нет сети' }} text="" sending={false} notice={null} />)
    expect(broken.match(/data-request-retry/g)).toHaveLength(2)
  })
})

describe('code of the screen', () => {
  const folder = new URL('./', import.meta.url)
  const sources = readdirSync(folder).filter((name) => /\.tsx?$/.test(name) && !name.endsWith('.test.tsx'))
    .map((name) => readFileSync(new URL(name, folder), 'utf8'))
  const css = readFileSync(new URL('./Chat.css', import.meta.url), 'utf8')

  it('never draws the words of the model as markup', () => {
    for (const source of sources) expect(source).not.toContain('dangerouslySetInnerHTML')
  })
  it('takes colours and sizes of text only from tokens, pins the composer by the token of the bottom, adds no motion', () => {
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i)
    for (const size of css.match(/font-size:[^;]+/g) ?? []) expect(size).toMatch(/^font-size: var\(--ck-text-[a-z0-9]+\)$/)
    expect(css).toContain('.chat-composer { position: sticky; bottom: var(--ck-bottom-occupied); z-index: var(--ck-z-action-bar);')
    expect(css).not.toMatch(/animation|@keyframes|transition|@media/)
  })
})
