import { useTheme } from '../../theme'
import type { Theme } from '../../theme'
import { setPrivate, usePrivacy } from '../../theme/privacy'
import { listIconsNames, setListIcons, useListIcons } from '../../lib/list-icons'
import HomeFigureSetting from '../dashboard/HomeFigureSetting'
import { nativeSwitch } from './switch'

const themeNames: [Theme, string][] = [['light', 'Светлая'], ['dark', 'Тёмная']]

/** The theme as two segments: the chosen one is pressed. The same choice as the switch of the sign-in. */
function ThemeChoice({ labelledBy }: { labelledBy: string }) {
  const { theme, setTheme } = useTheme()
  return <div className="ck-segments" role="group" aria-labelledby={labelledBy}>
    {themeNames.map(([value, name]) => <button key={value} type="button" aria-pressed={theme === value}
      onClick={() => setTheme(value)}>{name}</button>)}
  </div>
}

/** What the squares of the spends show, in the same segments: the category or how the spend came in (lib/list-icons). */
function ListIconsChoice({ labelledBy }: { labelledBy: string }) {
  const mode = useListIcons()
  return <div className="ck-segments" role="group" aria-labelledby={labelledBy}>
    {listIconsNames.map(([value, name]) => <button key={value} type="button" aria-pressed={mode === value}
      onClick={() => setListIcons(value)}>{name}</button>)}
  </div>
}

/**
 * «Оформление» (Чекист 2.0): the choices of this device, each acting at once — the theme, the squares of the spends,
 * «Скрывать суммы» (theme/privacy.ts) and «Главное число на Главной» (features/dashboard HomeFigureSetting). The same
 * panel on «Ещё» of a phone and on «Аккаунт»; `id` keeps the ids of the two apart.
 */
export default function AppearanceSection({ id = 'appearance' }: { id?: string }) {
  const hidden = usePrivacy()
  return <section className="ck-auth-panel ck-auth-list ck-auth-appearance" aria-labelledby={`${id}-heading`} data-appearance>
    <h2 id={`${id}-heading`}>Оформление</h2>
    <ul className="ck-auth-rows">
      <li className="ck-auth-row">
        <span id={`${id}-theme-label`} className="ck-auth-row-label">Тема</span>
        <ThemeChoice labelledBy={`${id}-theme-label`} />
      </li>
      <li className="ck-auth-row">
        <span id={`${id}-icons-label`} className="ck-auth-row-label">Значки</span>
        <ListIconsChoice labelledBy={`${id}-icons-label`} />
      </li>
      <li>
        <label className="ck-switch-row" htmlFor={`${id}-privacy`}>
          <span className="ck-auth-row-text">
            <span className="ck-auth-row-label">Скрывать суммы</span>
            <span className="ck-auth-row-meta" id={`${id}-privacy-meta`}>Суммы размыты на всех экранах</span>
          </span>
          <input id={`${id}-privacy`} type="checkbox" role="switch" className="ck-switch" {...nativeSwitch} checked={hidden}
            aria-describedby={`${id}-privacy-meta`} onChange={(event) => setPrivate(event.target.checked)} />
        </label>
      </li>
      <li className="ck-auth-figure"><HomeFigureSetting /></li>
    </ul>
  </section>
}
