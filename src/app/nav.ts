import { Power, Rss, Route, Server, Settings2 } from 'lucide';
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
 * Five destinations, in the order a session actually flows: connect, pick a
 * server, manage where servers come from, decide what gets proxied, configure.
 * Subscriptions gets a top-level tab because at this scale it is a workspace,
 * not a settings page.
 */
export const NAV_ITEMS: NavItem[] =
[
    { path: '/', glyph: Power, label: (s) => s.nav.home },
    { path: '/servers', glyph: Server, label: (s) => s.nav.servers },
    { path: '/subscriptions', glyph: Rss, label: (s) => s.nav.subscriptions },
    { path: '/routing', glyph: Route, label: (s) => s.nav.routing },
    { path: '/settings', glyph: Settings2, label: (s) => s.nav.settings }
];
