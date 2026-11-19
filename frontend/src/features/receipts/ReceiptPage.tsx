import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { getReceipt, getReceiptDiscounts, getReceiptLines, getReceiptTaxes } from '../../api/receipts'
import type { Discount, Line, Receipt, Tax } from '../../api/receipts'
import { getReceiptImages } from '../../api/recognition'
import type { ReceiptImage } from '../../api/recognition'
import type { Page } from '../../api/types'
import Icon from '../../components/Icon'
import RequestState from '../../components/RequestState'
import { formatObservedAt } from '../../lib/format'
import { currencySymbol } from '../../lib/money'
import { NBSP, numbered } from '../../lib/text'
import { ManualSpendActions } from '../expense/ManualSpendActions'
import { clearExpenseNotice, getExpenseNotice } from '../expense/expense-form'
import { Link } from '../../navigation'
import { useSession } from '../../session'
import type { ReceiptPageProps } from '../../pages/types'
import { ReceiptBlock, ReceiptPagination } from './ReceiptBlock'
import { ReceiptDeleteActions } from './ReceiptDeleteActions'
import { ReceiptHideAction } from './ReceiptHideAction'
import { ReceiptPhoto } from './ReceiptPhoto'
import { StartChat } from '../chat/StartChat'
import { useNarrow } from '../../lib/cards'
import { ReceiptDiscounts, ReceiptHeader, ReceiptImages, ReceiptLines, ReceiptTaxes, SlipRow } from './ReceiptContent'
import { canonical, lineCategories, slipNumber } from './line-facts'
import { takeFreshReceipt } from '../recognition/fresh-receipt'
import type { ReceiptRequestState } from './request'
import { ownerShown, receiptPlace, recognizedText, recognizedValue } from './state'
import { useReceiptRequest } from './useReceiptRequest'
import './Receipts.css'

export type BlockRequest<T> = { state: ReceiptRequestState<T>; retry: () => void }
type DetailPages = { images: number; lines: number; discounts: number; taxes: number }
export type ReceiptViewProps = ReceiptPageProps & {
  header: BlockRequest<Receipt>; images: BlockRequest<Page<ReceiptImage>>; lines: BlockRequest<Page<Line>>
  discounts: BlockRequest<Page<Discount>>; taxes: BlockRequest<Page<Tax>>
  pages: DetailPages; onPage: (block: keyof DetailPages, page: number) => void
  /** «Добавил: имя» in the header: the user is a member of a family. */
  showOwner?: boolean
  /** Shown once after a manual spend was saved on its form. */
  notice?: string
  /** A phone: the photo as a thumbnail in the header. */
  narrow?: boolean
  /** The slip prints out of its slot once: the receipt was just recognised (features/recognition/fresh-receipt.ts). */
  printing?: boolean
}

function PagedBlock<T>({ title, request, empty, page, onPage, children, id, slip = false, bare = false }: {
  title: string; request: BlockRequest<Page<T>>; empty: string; page: number; onPage: (page: number) => void; children: ReactNode; id: string
  /** A section of the paper slip: no panel, no count beside the heading; `bare` — its heading for a screen reader only. */
  slip?: boolean; bare?: boolean
}) {
  const { state, retry } = request
  // The count stands quietly at the right of the heading; the page line only when there is more than one page.
  const aside = !slip && state.kind === 'ok' && state.data.count > 0
    ? <span className="receipt-block-count"><span className="receipt-visually-hidden">Всего: </span>{state.data.count.toLocaleString('ru-RU')}</span> : undefined
  return <ReceiptBlock title={title} id={id} state={state} retry={retry} aside={aside} slip={slip} bare={bare}
    recovery={state.kind === 'error' && state.reason === 'page_out_of_range' && page > 1
      ? <button type="button" className="ck-button-secondary" onClick={() => onPage(1)}>На первую страницу</button> : undefined}>
    {state.kind === 'ok' && (state.data.results.length === 0 ? <RequestState kind="empty" message={empty} compact /> : <>
      {state.data.pages > 1 && <p className="receipt-note" role="status">Страница {state.data.page.toLocaleString('ru-RU')} из {state.data.pages.toLocaleString('ru-RU')}</p>}
      {children}
      <ReceiptPagination page={state.data.page} pages={state.data.pages} onPage={onPage} label={`Страницы: ${title.toLocaleLowerCase('ru-RU')}`} />
    </>)}
  </ReceiptBlock>
}

/** A block whose answer has nothing at all (not merely an empty page). */
const empty = <T,>(request: BlockRequest<Page<T>>) => request.state.kind === 'ok' && request.state.data.count === 0

/** Where the link back leads on a wide screen; a phone has «назад» in its top bar. */
const backLabel = (returnTo?: string) => returnTo?.startsWith('/recognition/jobs/') ? 'К заданию'
  : returnTo === '/' || returnTo?.startsWith('/?') ? 'На главную' : 'К тратам'

/** The head of the paper: the place in capitals, its address and town, the moment as the till printed it, a refund. */
function SlipHead({ receipt }: { receipt: Receipt }) {
  const { store } = receipt
  const where = store ? [store.address, store.city].map((part) => part.trim()).filter(Boolean).join(', ') : ''
  return <div className="receipt-slip-head">
    <p className="receipt-slip-store">{receiptPlace(receipt)}</p>
    {where && <p>{recognizedText(where)}</p>}
    <p><time dateTime={receipt.purchased_at}>{recognizedValue(formatObservedAt(receipt.purchased_at, store?.timezone))}</time></p>
    {receipt.operation === 'refund' && <p className="receipt-slip-refund">Возврат</p>}
  </div>
}

/** The end of the paper: the discounts of the whole receipt, ИТОГО with its currency, how the tax stands in the prices. */
function SlipTotal({ receipt }: { receipt: Receipt }) {
  const discount = canonical(receipt.discount_total)
  return <div className="receipt-slip-total">
    {discount !== null && discount !== '0' && <SlipRow label="Скидки" value={slipNumber(discount.startsWith('-') ? discount : `-${discount}`)} />}
    <SlipRow className="receipt-slip-grand" label="Итого" value={`${slipNumber(receipt.total)}${NBSP}${currencySymbol(receipt.currency)}`} />
    <p className="receipt-slip-tax">{receipt.prices_include_tax ? 'Налог включён в цены' : 'Налог не включён в цены'}</p>
  </div>
}

/**
 * The receipt as its paper (direction.html «чек»): the slot it prints out of, the slip in `--ck-slip` with the lines of
 * the till, its separate discounts and taxes (each a block with its own request, pages and errors), ИТОГО and a torn
 * edge; «Проверено» stamped on a receipt that a person confirmed. The paper stays paper in both themes.
 */
function ReceiptSlip({ receipt, lines, discounts, taxes, pages, onPage, confirmed, printing }: {
  receipt?: Receipt; lines: BlockRequest<Page<Line>>; discounts: BlockRequest<Page<Discount>>; taxes: BlockRequest<Page<Tax>>
  pages: DetailPages; onPage: ReceiptViewProps['onPage']; confirmed: boolean; printing: boolean
}) {
  const visibleLines = lines.state.kind === 'ok' ? lines.state.data.results : []
  return <div className="receipt-slip-wrap" data-printing={printing ? '' : undefined}>
    <div className="receipt-slot" aria-hidden="true" />
    <div className={`receipt-slip ck-tape${confirmed ? ' receipt-slip-stamped' : ''}`}>
      {receipt && <SlipHead receipt={receipt} />}
      <PagedBlock slip bare title="Строки чека" id="receipt-lines" request={lines} empty="В этом чеке нет строк."
        page={pages.lines} onPage={(page) => onPage('lines', page)}>
        {lines.state.kind === 'ok' && <ReceiptLines lines={lines.state.data.results} currency={receipt?.currency} />}
      </PagedBlock>
      {/* A paper without separate discounts or taxes prints no empty part for them. */}
      {!empty(discounts) && <PagedBlock slip title="Скидки" id="receipt-discounts" request={discounts} empty="Отдельные скидки в чеке не указаны."
        page={pages.discounts} onPage={(page) => onPage('discounts', page)}>
        {discounts.state.kind === 'ok' && <ReceiptDiscounts discounts={discounts.state.data.results} lines={visibleLines} currency={receipt?.currency} />}
      </PagedBlock>}
      {!empty(taxes) && <PagedBlock slip title="Налоги" id="receipt-taxes" request={taxes} empty="Налоги в чеке не указаны."
        page={pages.taxes} onPage={(page) => onPage('taxes', page)}>
        {taxes.state.kind === 'ok' && <ReceiptTaxes taxes={taxes.state.data.results} currency={receipt?.currency} />}
      </PagedBlock>}
      {receipt && <SlipTotal receipt={receipt} />}
      {confirmed && <p className="receipt-stamp">Проверено</p>}
    </div>
  </div>
}

export function ReceiptView({ receiptId, returnTo, header, images, lines, discounts, taxes, pages, onPage, notice, showOwner = false, narrow = false,
  printing = false }: ReceiptViewProps) {
  const receipt = header.state.kind === 'ok' ? header.state.data : undefined
  const visibleLines = lines.state.kind === 'ok' ? lines.state.data.results : []
  // A spend entered by hand has no photo, discounts or taxes: only its lines are shown, without the paper.
  const manual = receipt?.source === 'manual'
  const confirmed = images.state.kind === 'ok' && images.state.data.results.some((image) => image.confirmed_at !== null)
  const actions = receipt && (manual ? <ManualSpendActions receiptId={receiptId} narrow={narrow} />
    : <ReceiptDeleteActions receiptId={receiptId} />)
  const hide = receipt && <ReceiptHideAction receiptId={receiptId} hidden={receipt.hidden === true} onChanged={header.retry} />
  const photo = narrow && receipt && !manual ? <ReceiptPhoto receiptId={receiptId} thumb={receipt.preview_thumb_url} image={receipt.preview_image_url}
    download={images.state.kind === 'ok' ? images.state.data.results[0]?.download_url : undefined} /> : undefined
  return <div className="receipts-page receipt-screen">
    {notice && <p className="expense-notice" role="status">{notice}</p>}
    {!narrow && <p className="receipt-back"><Link className="action-link" back to={returnTo ?? '/receipts'}>{backLabel(returnTo)}</Link></p>}
    {/* The facts and the paper share the first column of a wide screen; below 960 px the wrapper has no box. */}
    <div className="receipt-main">
      {/* The head: the place, the total as the large figure, the facts, then the actions and the question to the assistant. */}
      <ReceiptBlock title={numbered(manual ? 'Трата' : 'Чек', receiptId)} className="receipt-hero" state={header.state} retry={header.retry}>
        {receipt && <ReceiptHeader receipt={receipt} showOwner={showOwner} photo={photo} categories={lineCategories(visibleLines)} />}
        {receipt && <div className="receipt-toolbar">{actions}{hide}</div>}
        {/* A thread of «Чат с ИИ» about this spend: the model gets the whole receipt and its place in the limits. */}
        {receipt && <StartChat input={{ kind: 'spend', receipt_id: receiptId }} className="receipt-ask chat-ask-spend">
          <Icon name="insight" size={20} />Спросить ИИ об этой трате</StartChat>}
      </ReceiptBlock>
      {manual ? <PagedBlock title="Позиции траты" id="receipt-lines" request={lines} empty="В этом чеке нет строк."
        page={pages.lines} onPage={(page) => onPage('lines', page)}>
        {lines.state.kind === 'ok' && <ReceiptLines lines={lines.state.data.results} currency={receipt?.currency} manual />}
      </PagedBlock> : <ReceiptSlip receipt={receipt} lines={lines} discounts={discounts} taxes={taxes} pages={pages} onPage={onPage}
        confirmed={confirmed} printing={printing} />}
    </div>
    {!manual && <PagedBlock title="Фото чека" id="receipt-images" request={images} empty="У этого чека нет изображений."
      page={pages.images} onPage={(page) => onPage('images', page)}>
      {images.state.kind === 'ok' && <ReceiptImages images={images.state.data.results} receiptId={receiptId} />}
    </PagedBlock>}
  </div>
}

function ReceiptScreen({ receiptId, returnTo }: ReceiptPageProps) {
  const [pages, setPages] = useState<DetailPages>({ images: 1, lines: 1, discounts: 1, taxes: 1 })
  const loadHeader = useCallback((signal: AbortSignal) => getReceipt(receiptId, { signal }), [receiptId])
  const loadImages = useCallback((signal: AbortSignal) => getReceiptImages({ receipt: receiptId, page: pages.images }, { signal }), [receiptId, pages.images])
  const loadLines = useCallback((signal: AbortSignal) => getReceiptLines(receiptId, { page: pages.lines }, { signal }), [receiptId, pages.lines])
  const loadDiscounts = useCallback((signal: AbortSignal) => getReceiptDiscounts(receiptId, { page: pages.discounts }, { signal }), [receiptId, pages.discounts])
  const loadTaxes = useCallback((signal: AbortSignal) => getReceiptTaxes(receiptId, { page: pages.taxes }, { signal }), [receiptId, pages.taxes])
  const header = useReceiptRequest(loadHeader)
  const images = useReceiptRequest(loadImages)
  const lines = useReceiptRequest(loadLines)
  const discounts = useReceiptRequest(loadDiscounts)
  const taxes = useReceiptRequest(loadTaxes)
  const showOwner = ownerShown(useSession())
  const narrow = useNarrow()
  // Read once into the state; the module copy is cleared so that a later visit shows no stale notice.
  const [notice] = useState(() => getExpenseNotice(receiptId))
  useEffect(clearExpenseNotice, [])
  // «Печать чека» once, for a receipt the person just saw recognised (the mark of features/recognition, taken here).
  const [fresh] = useState(() => takeFreshReceipt(receiptId))
  return <ReceiptView narrow={narrow} showOwner={showOwner} notice={notice} receiptId={receiptId} returnTo={returnTo} header={header} images={images} lines={lines} discounts={discounts} taxes={taxes}
    pages={pages} onPage={(block, page) => setPages((previous) => ({ ...previous, [block]: page }))} printing={fresh && header.state.kind === 'ok' && lines.state.kind === 'ok'} />
}

export default function ReceiptPage(props: ReceiptPageProps) {
  return <ReceiptScreen key={props.receiptId} {...props} />
}
