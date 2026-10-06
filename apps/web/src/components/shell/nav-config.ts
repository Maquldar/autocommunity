import {
  Bell,
  CalendarDays,
  Handshake,
  Map as MapIcon,
  MessageCircle,
  Newspaper,
  Settings,
  Siren,
  UserRound,
  UsersRound,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import type messages from '../../../messages/en.json';

export type NavLabelKey = keyof (typeof messages)['nav'];

export type NavItem = {
  key: string;
  href: string;
  icon: LucideIcon;
  /** Key in the `nav` messages namespace. */
  labelKey: NavLabelKey;
  /**
   * Only enabled items render. Flip to `true` in the same change that ships the page:
   * a link to a page that doesn't exist yet is a bug.
   */
  enabled: boolean;
  /** `tab` items appear in the mobile bottom bar and at the top of the desktop sidebar. */
  placement: 'tab' | 'secondary';
  /** SOS is drawn as the raised red centre button. */
  emphasis?: 'sos';
};

export const NAV_ITEMS: readonly NavItem[] = [
  { key: 'map', href: '/map', icon: MapIcon, labelKey: 'map', enabled: true, placement: 'tab' },
  { key: 'communities', href: '/communities', icon: UsersRound, labelKey: 'communities', enabled: true, placement: 'tab' },
  { key: 'sos', href: '/sos', icon: Siren, labelKey: 'sos', enabled: true, placement: 'tab', emphasis: 'sos' },
  { key: 'chats', href: '/chats', icon: MessageCircle, labelKey: 'chats', enabled: true, placement: 'tab' },
  { key: 'profile', href: '/profile', icon: UserRound, labelKey: 'profile', enabled: true, placement: 'tab' },
  { key: 'feed', href: '/feed', icon: Newspaper, labelKey: 'feed', enabled: true, placement: 'secondary' },
  { key: 'services', href: '/services', icon: Wrench, labelKey: 'services', enabled: true, placement: 'secondary' },
  { key: 'events', href: '/events', icon: CalendarDays, labelKey: 'events', enabled: true, placement: 'secondary' },
  { key: 'friends', href: '/friends', icon: Handshake, labelKey: 'friends', enabled: true, placement: 'secondary' },
  { key: 'notifications', href: '/notifications', icon: Bell, labelKey: 'notifications', enabled: true, placement: 'secondary' },
  { key: 'settings', href: '/settings', icon: Settings, labelKey: 'settings', enabled: true, placement: 'secondary' },
];

export function getNavItems(placement?: NavItem['placement'], items: readonly NavItem[] = NAV_ITEMS): NavItem[] {
  return items.filter((item) => item.enabled && (placement === undefined || item.placement === placement));
}

/** Active for the exact path and anything nested under it (/communities/123 → communities). */
export function isNavItemActive(item: Pick<NavItem, 'href'>, pathname: string): boolean {
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}
