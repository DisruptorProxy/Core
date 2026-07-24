import { createRouter } from 'azerothjs';

import HomePage from '../pages/home.page.azeroth';
import RoutingPage from '../pages/routing.page.azeroth';
import ServersPage from '../pages/servers.page.azeroth';
import SettingsPage from '../pages/settings.page.azeroth';

/**
 * One router instance for the app. AzerothJS routing is manual-first - `<Routes>`,
 * `<Link>` and the composables all take the router explicitly - so it lives here
 * as a module singleton rather than being threaded through every component.
 */
export const router = createRouter({
    routes: [
        { path: '/', component: HomePage },
        { path: '/servers', component: ServersPage },
        { path: '/routing', component: RoutingPage },
        { path: '/settings', component: SettingsPage }
    ]
});
