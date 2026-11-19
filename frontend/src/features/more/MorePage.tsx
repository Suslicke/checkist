import { useSyncExternalStore } from 'react'
import Icon from '../../components/Icon'
import { Link } from '../../navigation'
import type { Route } from '../../navigation'
import { initials, personName } from '../../lib/people'
import { menuItems } from '../../menu/menu-items'
import type { MenuItem } from '../../menu/menu-items'
import { useSession } from '../../session'
import { platform } from '../../theme/platform'
import AppearanceSection from '../auth/AppearanceSection'
import { pushSupport, readDevice } from '../push/push-device'
import '../auth/Auth.css'
import './More.css'

const MORE: Route = { kind: 'more' }

function Row({ entry }: { entry: MenuItem }) {
  return <li>
    <Link className="ck-row more-row" to={entry.to}>
      <span className="ck-row-badge more-badge" aria-hidden="true"><Icon name={entry.icon} size={20} /></span>
      <span className="ck-row-main"><span className="ck-row-title">{entry.label}</span></span>
      <Icon name="forward" size={18} className="ck-icon more-chevron" />
    </Link>
  </li>
}

const never = () => () => {}
/** iPhone or iPad in Safari, not opened from the home screen: notifications need the app on the home screen first
 * (docs/design-system/platforms.md). The page must look like iOS too: a touch Mac in a test browser is no iPad. */
const needsHomeScreen = () => {
  try {
    return platform() === 'ios' && pushSupport(readDevice()) === 'install'
  } catch {
    return false
  }
}

/**
 * «Ещё» of a phone as a screen of its own — the hub of the settings (Чекист 2.0): the person and the family on top
 * (→ «Аккаунт»), «Данные» and «Настройки» as panels of rows, then «Оформление» — the theme, the squares of the spends,
 * «Скрывать суммы» and «Главное число на Главной», acting at once. The money sections are the screen «Деньги» of the bar
 * (2026-10-26). A section opened from here goes back here (`menu/back-target.ts`). A wide screen keeps its header lists,
 * the address still works there.
 */
export default function MorePage() {
  const session = useSession()
  const { groups } = menuItems(session, MORE)
  const account = groups.flatMap((group) => group.items).find((entry) => entry.account)
  const name = session.kind === 'user' ? personName(session.user.username, session.user.display_name) : ''
  const family = session.kind === 'user' ? session.household?.name : undefined
  const install = useSyncExternalStore(never, needsHomeScreen, () => false)
  return <div className="more ck-stack">
    {account && <Link className="ck-panel more-profile" to={account.to} aria-label={`Аккаунт: ${name}`}>
      <span className="more-avatar" aria-hidden="true">{initials(name)}</span>
      <span className="ck-row-main">
        <span className="more-profile-name">{name}</span>
        <span className="ck-row-meta">{family ? `Семья «${family}» · пароль и уведомления` : 'Пароль и уведомления'}</span>
      </span>
      <Icon name="forward" size={18} className="ck-icon more-chevron" />
    </Link>}
    {groups.map((group) => <section key={group.key} className="ck-panel more-section" aria-labelledby={`more-${group.key}`}>
      <h2 id={`more-${group.key}`} className="more-title">{group.title}</h2>
      <ul className="ck-list more-list">{group.items.filter((entry) => !entry.account).map((entry) => <Row key={entry.key} entry={entry} />)}</ul>
      {group.key === 'settings' && install && <p className="more-install" data-more-install>
        Уведомления на iPhone приходят только приложению с экрана «Домой»: в Safari нажмите «Поделиться» → «На экран „Домой“».</p>}
    </section>)}
    <AppearanceSection id="more-appearance" />
  </div>
}
