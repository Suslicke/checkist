import type { AnchorHTMLAttributes, MouseEvent } from 'react'
import { goBack, navigate } from './browser'
import { buildRoute } from './routes'
import type { NavigationTarget } from './controller'
import { shouldInterceptLink } from './link-policy'

export interface LinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  to: NavigationTarget
  replace?: boolean
  /** A «назад» control: it steps back to the screen the person came from; `to` is where it leads when there is
   * none (the page was entered directly) and stays the address of the link. */
  back?: boolean
  /** A link of the menu: the page it opens is a root and gets no «назад». */
  root?: boolean
}

export default function Link({ to, replace, back, root, onClick, ...props }: LinkProps) {
  const href = typeof to === 'string' ? to : buildRoute(to)
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event)
    if (shouldInterceptLink(event, href, window.location.href, props.target, event.currentTarget.hasAttribute('download'))) {
      event.preventDefault()
      if (back) goBack(to)
      else navigate(to, { replace, root })
    }
  }
  return <a {...props} href={href} onClick={handleClick} />
}
