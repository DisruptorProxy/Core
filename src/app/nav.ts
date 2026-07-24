import { Power, Route, Server, Settings2 } from 'lucide';
import type { IconNode } from 'lucide';

import type { Strings } from '../lib/i18n/types';

interface NavItem
{
    path: string;
    glyph: IconNode;
    /** Reads its own label out of the active dictionary, so nav is locale-driven. */
    label: (strings: Strings) => string;
}

/**
 * Four destinations, in the order a session actually flows: connect, pick a
 * server, decide what gets proxied, configure. Servers and their subscription
 * sources now live on one screen, so there is no separate Subscriptions tab.
 */
export const NAV_ITEMS: NavItem[] =
[
    { path: '/', glyph: Power, label: (s) => s.nav.home },
    { path: '/servers', glyph: Server, label: (s) => s.nav.servers },
    { path: '/routing', glyph: Route, label: (s) => s.nav.routing },
    { path: '/settings', glyph: Settings2, label: (s) => s.nav.settings }
];
