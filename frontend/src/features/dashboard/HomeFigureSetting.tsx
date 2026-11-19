import { useId } from 'react'
import { HOME_FIGURES, useHomeFigure } from './home-figure'
import type { HomeFigure } from './home-figure'

export type HomeFigureSettingProps = {
  /** An option that cannot be shown now, with the reason in words («Бюджет месяца не задан»): drawn disabled, the
   * reason in place of its note. «Главная» knows the month; a settings screen leaves it out — every option is open. */
  unavailable?: Partial<Record<HomeFigure, string>>
  /** Called after the person picked an option (the sheet of «Главная» closes itself). */
  onPick?: (figure: HomeFigure) => void
  /** The legend of the group; a sheet that already names it hides it from the eye and keeps it for a screen reader. */
  legend?: string
  hideLegend?: boolean
}

/**
 * «Главное число на Главной» (Чекист 2.0): four options as one radio group, each with a line of what it counts. The
 * choice is the device's (`checkist.homeFigure`, home-figure.ts) and «Главная» follows it at once. The styles are in
 * Dashboard.css (`.home-figure-*`), which `styles.ts` loads for every screen.
 */
export default function HomeFigureSetting({ unavailable = {}, onPick, legend = 'Главное число на Главной', hideLegend = false }: HomeFigureSettingProps) {
  const [figure, setFigure] = useHomeFigure()
  const name = useId()
  return <fieldset className="home-figure-setting">
    <legend className={hideLegend ? 'ck-visually-hidden' : 'ck-title home-figure-legend'}>{legend}</legend>
    <div className="home-figure-options">
      {HOME_FIGURES.map((option) => {
        const reason = unavailable[option.value]
        const noteId = `${name}-${option.value}-note`
        return <label key={option.value} className={`home-figure-option${reason ? ' is-disabled' : ''}`}>
          <input type="radio" className="home-figure-radio" name={name} value={option.value} checked={figure === option.value}
            disabled={Boolean(reason)} aria-describedby={noteId}
            onChange={() => { setFigure(option.value); onPick?.(option.value) }} />
          <span className="home-figure-text">
            <span className="home-figure-label">{option.label}</span>
            <span className="home-figure-note" id={noteId}>{reason ?? option.note}</span>
          </span>
        </label>
      })}
    </div>
  </fieldset>
}
