import { Fragment } from 'react'
import Money from '../../components/Money'
import type { Phrase } from './home-hero'

/** A sentence of words and sums (home-hero.ts `Phrase`): every sum is a `Money` of the size of the text around it;
 * several phrases are joined with « · ». */
export default function Words({ phrases }: { phrases: Phrase[] }) {
  return <>{phrases.map((phrase, index) => <Fragment key={index}>
    {index > 0 && ' · '}
    <span className="dash-phrase">{phrase.map((part, at) => typeof part === 'string' ? <Fragment key={at}>{part}</Fragment>
      : <Money key={at} value={part.money} currency={part.currency} tone={part.over ? 'over' : undefined} />)}</span>
  </Fragment>)}</>
}
