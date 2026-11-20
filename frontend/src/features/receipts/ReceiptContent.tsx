import type { ReactNode } from 'react'
import type { Discount, Line, Receipt, Tax } from '../../api/receipts'
import type { ReceiptImage } from '../../api/recognition'
import Icon from '../../components/Icon'
import Money from '../../components/Money'
import Private, { PrivateText } from '../../components/Private'
import RecognitionIssues from '../../components/RecognitionIssues'
import { imageLabels } from '../../lib/recognition-labels'
import { formatObservedAt, formatPercent, formatQuantity } from '../../lib/format'
import { baseTwin } from '../../lib/money'
import { methodLabels } from '../../lib/payment-methods'
import { ownerName } from '../../lib/people'
import { glue, numbered } from '../../lib/text'
import { Link } from '../../navigation'
import { canonical, printedNote, slipFacts, slipNumber } from './line-facts'
import { categoryTone } from '../../lib/category-tone'
import { DownloadOriginal } from '../recognition/MediaImage'
import ReceiptMedia from './ReceiptMedia'
import { price, receiptPlace, recognizedText, recognizedValue, unknown } from './state'
import { spendSource, stampWord, withoutSourceMark } from './spends'
import { whenText } from './when'
import type { NamedObject } from '../../api/types'

const lineKinds: Record<Line['kind'], string> = {
  product: 'Товар', service: 'Услуга', deposit: 'Залог', deposit_return: 'Возврат залога',
}

/** A category of the lines: its tone as a dot and its name (the chips of the header, a position of a spend by hand). */
export function CategoryChip({ category, hint = false }: { category: NamedObject; hint?: boolean }) {
  return <span className="receipt-line-chip" data-tone={categoryTone(category.id)}>
    {hint && <span className="receipt-visually-hidden">Категория: </span>}{category.name}</span>
}

const sourceIcons = { photo: 'receipt', manual: 'pencil', statement: 'card' } as const

/**
 * The head of a receipt or a spend (Чекист 2.0, the «trip» of direction.html): the tile in the tone of its first category
 * with the picture of how it came in, the place and the moment in words, the total as the large figure of the page with
 * its twin in the base currency, the facts as chips (when, who, from where, how paid), the categories of its lines, the
 * warnings, then the other facts as rows. `photo` — the thumbnail of the receipt photo on a phone.
 */
export function ReceiptHeader({ receipt, showOwner = false, photo, categories = [] }: {
  receipt: Receipt; showOwner?: boolean; photo?: ReactNode; categories?: NamedObject[]
}) {
  const { store } = receipt
  const manual = receipt.source === 'manual'
  // A spend imported from a bank statement names the statement in its note: the header says it as the source.
  const note = withoutSourceMark(receipt.note)
  // Another currency than the family's base one: its amount in the base currency, as the totals count it.
  const twin = baseTwin(receipt.currency, receipt.base_total, receipt.base_currency)
  const tone = categories[0] ? categoryTone(categories[0].id) : undefined
  const facts = <dl className="receipt-facts">
    {note && <div><dt>Комментарий</dt><dd>{note}</dd></div>}
    {/* A place typed by hand has no address to read: the empty rows of a spend are left out. */}
    {store && (!manual || store.address.trim()) && <div><dt>Адрес</dt><dd>{recognizedText(store.address)}</dd></div>}
    {store && (!manual || store.city.trim()) && <div><dt>Город и страна</dt><dd>{recognizedText(store.city)} · {store.country}</dd></div>}
    {/* A manual spend is always a sale without discounts and taxes: those rows say nothing about it. */}
    {!manual && <div><dt>Операция</dt><dd>{receipt.operation === 'refund' ? 'Возврат' : 'Продажа'}</dd></div>}
    {!manual && <div><dt>Сумма скидок</dt><dd className="receipt-number"><Money value={receipt.discount_total} currency={receipt.currency} /></dd></div>}
    {/* A spend by hand names its currency by the sign of its amount. */}
    {!manual && <div><dt>Валюта</dt><dd>{receipt.currency}</dd></div>}
    {!manual && <div><dt>Налог в ценах</dt><dd>{receipt.prices_include_tax ? 'Включён' : 'Не включён'}</dd></div>}
  </dl>
  return <div className="receipt-head">
    <div className="receipt-head-top">
      <span className="receipt-head-tile" data-tone={tone} aria-hidden="true"><Icon name={sourceIcons[spendSource(receipt)]} size={24} /></span>
      <div className="receipt-head-main">
        <h3 className="receipt-store-name">{receiptPlace(receipt)}</h3>
        {categories.length === 1 && <p className="receipt-head-kind">{categories[0].name}</p>}
      </div>
      {photo}
    </div>
    <p className="receipt-head-total"><span className="receipt-head-label">Итог</span>
      <Money value={receipt.total} currency={receipt.currency} size="display" />
      {twin && <span className="receipt-head-twin"><Private>{twin}</Private> по курсу Нацбанка на день покупки</span>}</p>
    {/* «сегодня, 19:42 · Анна · Фото · Kaspi Gold»: the facts of the moment as quiet chips; each keeps its name for a screen reader. */}
    <dl className="receipt-head-meta">
      {/* The time of a manual spend is the moment of entry, not of the purchase: only the date is shown. */}
      {manual ? <div><dt>Дата покупки</dt><dd><time dateTime={receipt.purchased_on}>{whenText(receipt.purchased_on)}</time></dd></div>
        : <div><dt>Дата и время покупки</dt><dd><time dateTime={receipt.purchased_at}>{whenText(receipt.purchased_on, formatObservedAt(receipt.purchased_at, store?.timezone))}</time></dd></div>}
      {showOwner && <div><dt>Добавил</dt><dd className="receipt-owner">{ownerName(receipt)}</dd></div>}
      <div><dt>Откуда</dt><dd>{stampWord(receipt)}</dd></div>
      {/* A spend from a statement names its bank as the source already: the way of payment is the same words. */}
      {receipt.payment_method && !stampWord(receipt).includes(methodLabels[receipt.payment_method]) && <div><dt>Оплата</dt><dd>{methodLabels[receipt.payment_method]}</dd></div>}
    </dl>
    {categories.length > 1 && <ul className="receipt-head-chips" aria-label="Категории">
      {categories.map((category) => <li key={category.id}><CategoryChip category={category} /></li>)}
    </ul>}
    {receipt.unmatched_products_count > 0 && <p className="receipt-warning">Товары не сопоставлены: {receipt.unmatched_products_count.toLocaleString('ru-RU')}</p>}
    {receipt.review_required && <p className="receipt-warning">Данные требуют проверки. Проверьте несопоставленные товары и замечания к изображениям.</p>}
    {/* A photo receipt keeps its paper facts (the address, the operation, the taxes) folded: the slip below shows them. */}
    {manual ? facts : <details className="receipt-more"><summary>Подробности</summary>{facts}</details>}
  </div>
}

/** The crops of the receipt: the heading with the status under it, the picture, «Скачать оригинал» and the job in one row of
 * quiet links, then the notes of the recognition. */
export function ReceiptImages({ images, receiptId }: { images: ReceiptImage[]; receiptId: number }) {
  return <ul className="receipt-images">{images.map((image) => <li className="receipt-image-card" key={image.id}>
    <div className="receipt-image-head">
      <h3>{numbered('Фото', image.photo_id)} · {glue('вырезка', image.position)}</h3>
      <p className="receipt-image-status">{imageLabels[image.status]}</p>
      {image.confirmed_at !== null && <p className="receipt-note">Подтверждено вручную: <time dateTime={image.confirmed_at}>{formatObservedAt(image.confirmed_at)}</time></p>}
    </div>
    <ReceiptMedia url={image.image_url} display={image.display_url} size={image} alt={`Вырезка ${image.position} с фото №${image.photo_id}, чек №${receiptId}`} />
    <div className="receipt-image-links">
      <DownloadOriginal url={image.download_url} />
      <Link className="action-link" to={`/recognition/jobs/${image.job_id}`}>{numbered('Задание', image.job_id)}</Link>
    </div>
    <RecognitionIssues issues={image.issues} status={image.status} />
  </li>)}</ul>
}

export function LineReference({ lineId, lines }: { lineId: number; lines: Line[] }) {
  const line = lines.find((candidate) => candidate.id === lineId)
  return line ? <a href={`#receipt-line-${line.id}`}>{glue('Строка', line.position)}: {recognizedText(line.name)}</a>
    : <span>{glue('Строка', 'ID', lineId)} (на другой странице строк)</span>
}

export function CurrencyNote({ currency }: { currency?: string }) {
  return !currency ? <p className="receipt-warning">Валюта: {unknown}. Загрузите сведения о чеке, чтобы увидеть валюту сумм.</p> : null
}

/** «В чеке: …» under a line whose price was recalculated from its amount; nothing otherwise. */
function PrintedNote({ line, currency }: { line: Line; currency?: string }) {
  const note = printedNote(line, currency)
  return note ? <span className="receipt-note"><PrivateText>{note}</PrivateText></span> : null
}

function LineRelations({ line, lines }: { line: Line; lines: Line[] }) {
  return <>
    {line.parent_id !== null && <span className="receipt-line-relation">{line.kind === 'deposit' || line.kind === 'deposit_return' ? 'Залог к ' : 'Связь с '}<LineReference lineId={line.parent_id} lines={lines} /></span>}
    {lines.filter((child) => child.parent_id === line.id).map((child) => <span className="receipt-line-relation" key={child.id}>
      {lineKinds[child.kind]}: <LineReference lineId={child.id} lines={lines} />
    </span>)}
  </>
}

/** The notes of a line, in the type of the interface on the paper (what the app knows about the printed words): the
 * kind of a line that is not a product, «В чеке: …», the category, the unmatched mark, the relations. A matched line
 * names its product by its printed name (`LineName`). */
function LineNotes({ line, lines, currency }: { line: Line; lines: Line[]; currency?: string }) {
  return <>
    {line.kind !== 'product' && <span className="receipt-note">{lineKinds[line.kind]}</span>}
    <PrintedNote line={line} currency={currency} />
    {/* A named purchase of a manual spend has both: its category and its product of the catalogue. */}
    {line.category && <span className="receipt-note receipt-line-category">Категория: {line.category.name}</span>}
    {!line.product && !line.category && <span className="receipt-warning">Товар не сопоставлен</span>}
    <LineRelations line={line} lines={lines} />
  </>
}

/** The printed name of a line (or the name of a position of a spend by hand); matched, it is the link to its product of
 * the catalogue (named so for a screen reader). */
function LineName({ line }: { line: Line }) {
  const name = recognizedText(line.name)
  return line.product
    ? <Link className="receipt-printed-name receipt-product-link" to={`/catalog/products/${line.product.id}`}>{name}
      <span className="receipt-visually-hidden">, товар каталога: {recognizedText(line.product.name)}</span></Link>
    : <span className="receipt-printed-name">{name}</span>
}

/** One row of the paper: the words at the left, dotted leaders, the number at the right (it never wraps). The number is
 * an amount: «Скрывать суммы» blurs it in its mono type (`Private`), and the price of «2 шт × 1,29» in the words. */
export function SlipRow({ label, value, className }: { label: ReactNode; value: string; className?: string }) {
  return <div className={className ? `receipt-slip-row ${className}` : 'receipt-slip-row'}>
    <span className="receipt-slip-label">{typeof label === 'string' ? <PrivateText>{label}</PrivateText> : label}</span>
    <span className="receipt-slip-value"><span className="receipt-visually-hidden">: </span>{value === unknown ? value : <Private>{value}</Private>}</span>
  </div>
}

/**
 * The lines of a receipt as the paper printed them (Чекист 2.0, the slip): the printed name, «2 шт × 1,29 ……… 2,58» under
 * it (a single piece stands on the line of its name), the discount and the paid amount when they say something, then the
 * notes of the app. Numbers without the currency: the slip names it at its total. Each line is the target of a link to
 * it (`#receipt-line-N`). `manual` — a spend typed by hand: its positions as rows of a panel with their amounts, no paper.
 */
export function ReceiptLines({ lines, currency, manual = false }: { lines: Line[]; currency?: string; manual?: boolean }) {
  if (manual) return <>
    <CurrencyNote currency={currency} />
    <ul className="receipt-positions">{lines.map((line) => {
      const meta = [
        // The category, unless the position is named by it already.
        line.category && line.category.name.trim() !== line.name.trim() ? line.category.name : null,
        canonical(line.quantity) === '1' ? null : `${recognizedValue(formatQuantity(line.quantity, line.unit))} × ${price(line.unit_price, currency)}`,
        canonical(line.discount_amount) === '0' ? null : `скидка ${slipNumber(line.discount_amount)}`,
      ].filter(Boolean).join(' · ')
      return <li key={line.id} id={`receipt-line-${line.id}`} tabIndex={-1} className="receipt-position">
        <span className="receipt-position-badge" data-tone={line.category ? categoryTone(line.category.id) : undefined} aria-hidden="true" />
        <span className="receipt-position-main">
          <LineName line={line} />
          {meta && <span className="receipt-note"><PrivateText>{meta}</PrivateText></span>}
          <PrintedNote line={line} currency={currency} />
          <LineRelations line={line} lines={lines} />
        </span>
        <span className="receipt-position-amount"><span className="receipt-visually-hidden">Сумма: </span><Money value={line.amount} currency={currency} size="row" /></span>
      </li>
    })}</ul>
  </>
  return <>
    <CurrencyNote currency={currency} />
    <ol className="receipt-slip-lines" aria-label="Строки чека">{lines.map((line) => {
      const [first, ...rest] = slipFacts(line)
      const name = <LineName line={line} />
      return <li key={line.id} id={`receipt-line-${line.id}`} tabIndex={-1} className="receipt-slip-item">
        {first.quiet ? <SlipRow label={name} value={first.value} className="receipt-slip-named" />
          : <>{name}<SlipRow label={first.label} value={first.value} className="receipt-slip-sub" /></>}
        {rest.map((fact) => <SlipRow key={fact.key} label={fact.label} value={fact.value} className="receipt-slip-sub" />)}
        <span className="receipt-slip-notes"><LineNotes line={line} lines={lines} currency={currency} /></span>
      </li>
    })}</ol>
  </>
}

/** The separate discounts of the paper: the name, the amount with its minus, and what it belongs to. */
export function ReceiptDiscounts({ discounts, lines, currency }: { discounts: Discount[]; lines: Line[]; currency?: string }) {
  return <><CurrencyNote currency={currency} /><ul className="receipt-slip-list">{discounts.map((discount) => <li key={discount.id}>
    <SlipRow label={<span className="receipt-slip-name">{recognizedText(discount.name)}</span>} value={slipNumber(discount.amount.startsWith('-') ? discount.amount : `-${discount.amount}`)} />
    <span className="receipt-note">{discount.line_id === null ? 'Скидка на весь чек' : <>Скидка к <LineReference lineId={discount.line_id} lines={lines} /></>}</span>
  </li>)}</ul></>
}

/** The tax totals of the paper: the rate and its country, the code, then without tax, the tax and with it. */
export function ReceiptTaxes({ taxes, currency }: { taxes: Tax[]; currency?: string }) {
  return <><CurrencyNote currency={currency} /><ul className="receipt-slip-list">{taxes.map((tax) => <li key={tax.id}>
    <p className="receipt-slip-name">{tax.tax_rate.kind === 'exempt' ? 'Без НДС' : `НДС ${recognizedValue(formatPercent(tax.tax_rate.rate))}`} · {tax.tax_rate.country}</p>
    <span className="receipt-note">Код на чеке: {recognizedText(tax.tax_code)}</span>
    <SlipRow label="Без налога" value={slipNumber(tax.net)} className="receipt-slip-sub" />
    <SlipRow label="Налог" value={slipNumber(tax.tax)} className="receipt-slip-sub" />
    <SlipRow label="С налогом" value={slipNumber(tax.gross)} className="receipt-slip-sub" />
  </li>)}</ul></>
}
