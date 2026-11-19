import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import ConfirmDialog from './ConfirmDialog'
import { confirmParts } from './confirm-dialog'
import type { ConfirmDialogProps } from './ConfirmDialog'

const strip = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '')
const css = strip(readFileSync(new URL('./ConfirmDialog.css', import.meta.url), 'utf8'))
const tokens = readFileSync(new URL('../theme/tokens.css', import.meta.url), 'utf8')
const source = readFileSync(new URL('./ConfirmDialog.tsx', import.meta.url), 'utf8')

const props: ConfirmDialogProps = {
  open: true, title: 'Удалить чек и фото?', message: 'Фото и задания распознавания удалятся вместе с чеком.',
  confirmLabel: 'Удалить чек и фото', danger: true, onConfirm: () => {}, onCancel: () => {},
}
const render = (extra: Partial<ConfirmDialogProps> = {}) => renderToStaticMarkup(<ConfirmDialog {...props} {...extra} />)
const buttons = (html: string) => [...html.matchAll(/<button type="button" class="([^"]+)"[^>]*>([^<]*)<\/button>/g)].map((match) => `${match[1]}: ${match[2]}`)

describe('markup of the confirmation (Node server render, not browser behaviour)', () => {
  it('renders nothing while closed', () => {
    expect(render({ open: false })).toBe('')
  })

  it('is a modal alert dialog named by its question and described by its explanation', () => {
    const html = render()
    expect(html).toMatch(/^<dialog class="ck-confirm" data-platform="android" role="alertdialog" aria-modal="true" aria-labelledby="([^"]+)" aria-describedby="([^"]+)">/)
    const [, title, message] = /aria-labelledby="([^"]+)" aria-describedby="([^"]+)"/.exec(html) ?? []
    expect(html).toContain(`<h2 class="ck-confirm-title" id="${title}">Удалить чек и фото?</h2>`)
    expect(html).toContain(`<p class="ck-confirm-message" id="${message}">Фото и задания распознавания удалятся вместе с чеком.</p>`)
    // No explanation: nothing describes the dialog.
    expect(render({ message: undefined })).not.toContain('aria-describedby')
  })

  it('draws the dialog of Material 3 on Android and a computer: the words, then «Отмена» and the action at the right', () => {
    const html = render()
    expect(html).toContain('<div class="ck-confirm-panel"><div class="ck-confirm-group ck-confirm-group-message">')
    expect(buttons(html)).toEqual(['ck-confirm-cancel: Отмена', 'ck-confirm-action ck-confirm-danger: Удалить чек и фото'])
    expect(confirmParts('android').groups).toEqual([['message'], ['cancel', 'confirm']])
  })

  it('draws the action sheet on iOS: the explanation with the action in one group, «Отмена» apart under it', () => {
    const html = render({ platform: 'ios' })
    expect(html).toContain('data-platform="ios"')
    expect(html).toMatch(/<div class="ck-confirm-group ck-confirm-group-message-confirm"><div class="ck-confirm-text">.*<\/div><button[^>]*class="ck-confirm-action ck-confirm-danger"[^>]*>Удалить чек и фото<\/button><\/div><div class="ck-confirm-group ck-confirm-group-cancel"><button[^>]*>Отмена<\/button><\/div>/)
    expect(confirmParts('ios').groups).toEqual([['message', 'confirm'], ['cancel']])
  })

  it('names the action by its verb and keeps a quiet action without danger; the cancel word may change', () => {
    const quiet = render({ danger: false, confirmLabel: 'Выйти из семьи', cancelLabel: 'Остаться' })
    expect(buttons(quiet)).toEqual(['ck-confirm-cancel: Остаться', 'ck-confirm-action: Выйти из семьи'])
  })

  it('starts on «Отмена», cancels by Esc and the system «назад», by the scrim, and gives the focus back', () => {
    expect(source).toContain('cancelButton.current?.focus()')
    expect(source).toContain('node.showModal()')
    expect(source).toContain('onCancel={onNativeCancel}')
    expect(source).toContain('event.preventDefault()')
    expect(source).toContain('if (event.target === event.currentTarget) cancel.current()')
    expect(source).toContain('if (opener?.isConnected) opener.focus()')
    expect(source).toContain('createPortal(view, document.body)')
  })
})

describe('ConfirmDialog.css (text of the rules, not rendering)', () => {
  it('writes no colour and reads only tokens that the theme defines', () => {
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|\b(?:rgb|hsl)a?\(/i)
    const defined = new Set([...tokens.matchAll(/^\s*(--ck-[a-z0-9-]+):/gm)].map((match) => match[1]))
    const used = [...new Set([...css.matchAll(/var\((--[a-z0-9-]+)/g)].map((match) => match[1]))]
    expect(used.filter((name) => !defined.has(name))).toEqual([])
  })

  it('sizes every text by a 2.0 token and moves only under no reduced motion', () => {
    for (const [, size] of css.matchAll(/font-size:\s*([^;]+);/g)) expect(size).toMatch(/^var\(--ck-text-(caption|label|body|field|title|heading)\)$/)
    const motion = '@media (prefers-reduced-motion: no-preference) {'
    expect(css.split(motion)).toHaveLength(2)
    expect(css.slice(0, css.indexOf(motion))).not.toMatch(/animation|transition|@keyframes/)
  })

  it('paints a destruction in the error colour, never the seal, and falls back to the surface without glass', () => {
    expect(css).toContain('.ck-confirm-danger { color: var(--ck-error); }')
    expect(css).not.toContain('--ck-seal)')
    expect(css).toContain('@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px)))')
    expect(css).toContain('@media (prefers-reduced-transparency: reduce)')
  })
})
