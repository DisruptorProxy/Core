import { createRouter } from 'azerothjs';

import HomeScreen from '../features/connection/home-screen.azeroth';
import ServersScreen from '../features/configs/servers-screen.azeroth';
import RoutingScreen from '../features/routing/routing-screen.azeroth';
import SettingsScreen from '../features/settings/settings-screen.azeroth';
import SubscriptionsScreen from '../features/subscriptions/subscriptions-screen.azeroth';

/**
 * One router instance for the app. AzerothJS routing is manual-first - `<Routes>`,
 * `<Link>` and the composables all take the router explicitly - so it lives here
 * as a module singleton rather than being threaded through every component.
 */
export const router = createRouter({
    routes: [
        { path: '/', component: HomeScreen },
        { path: '/servers', component: ServersScreen },
        { path: '/subscriptions', component: SubscriptionsScreen },
        { path: '/routing', component: RoutingScreen },
        { path: '/settings', component: SettingsScreen }
    ]
});
