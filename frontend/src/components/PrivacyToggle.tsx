import Icon from './Icon'
import { togglePrivacy, usePrivacy } from '../theme/privacy'

/**
 * «Скрывать суммы» (Чекист 2.0): a round button with an eye. A toggle keeps one name and says its state by
 * `aria-pressed` («Скрыть суммы», pressed — the sums are hidden); the tooltip of a mouse names what a press does.
 */
export default function PrivacyToggle({ className }: { className?: string }) {
  const hidden = usePrivacy()
  return (
    <button type="button" className={`ck-icon-button ck-privacy-toggle${className ? ` ${className}` : ''}`}
      aria-label="Скрыть суммы" aria-pressed={hidden} title={hidden ? 'Показать суммы' : 'Скрыть суммы'} onClick={togglePrivacy}>
      <Icon name={hidden ? 'eye-off' : 'eye'} size={20} />
    </button>
  )
}
