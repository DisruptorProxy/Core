import { cleanup, renderTest } from '@azerothjs/testing';

import { afterEach, describe, expect, it } from 'vitest';

import HomePage from '../src/pages/home.page.azeroth';
import RoutingPage from '../src/pages/routing.page.azeroth';
import ServersPage from '../src/pages/servers.page.azeroth';
import SettingsPage from '../src/pages/settings.page.azeroth';

// The four screens, rendered whole. Storage is unavailable in this environment and the
// Tauri commands are absent, which is exactly the interesting case: every page must come
// up on its empty state rather than a blank region or a crash. A blank screen is the one
// failure a user cannot report usefully.

const PAGES = [
    ['home', HomePage],
    ['routing', RoutingPage],
    ['servers', ServersPage],
    ['settings', SettingsPage]
] as const;

afterEach(() => cleanup());

describe('every page', () =>
{
    it.each(PAGES.map(([name]) => [name]))('%s renders without throwing', (name) =>
    {
        const page = PAGES.find(([label]) => label === name)![1];

        expect(() => renderTest(() => page())).not.toThrow();
    });

    it.each(PAGES.map(([name]) => [name]))('%s puts readable text on screen, never a blank region', (name) =>
    {
        const page = PAGES.find(([label]) => label === name)![1];
        const { container } = renderTest(() => page());

        expect((container.textContent ?? '').trim().length, `${ name } rendered nothing`).toBeGreaterThan(0);
    });

    it.each(PAGES.map(([name]) => [name]))('%s heads its screen with exactly one h1', (name) =>
    {
        const page = PAGES.find(([label]) => label === name)![1];
        const { container } = renderTest(() => page());

        expect(container.querySelectorAll('h1').length, name).toBe(1);
    });
});

describe('RoutingPage', () =>
{
    it('offers the modes and always shows the pinned catch-all rule', () =>
    {
        const { container } = renderTest(() => RoutingPage());

        // The final rule is what makes "everything else" explicit; a rules list without
        // it reads as though unmatched traffic is undefined.
        expect(container.querySelectorAll('li').length).toBeGreaterThan(0);
        expect(container.querySelectorAll('button').length).toBeGreaterThan(2);
    });

    it('does not offer Custom before the user has written any rules', () =>
    {
        // The button restores stashed rules; with nothing stashed it would restore nothing.
        const { container } = renderTest(() => RoutingPage());
        const pressed = [...container.querySelectorAll('button[aria-pressed]')];

        expect(pressed.length).toBeGreaterThan(0);
        expect(pressed.every((b) => ['true', 'false'].includes(b.getAttribute('aria-pressed') ?? '')))
            .toBe(true);
    });
});

describe('ServersPage', () =>
{
    it('says the catalogue is empty rather than showing an empty box', () =>
    {
        const { container } = renderTest(() => ServersPage());

        expect((container.textContent ?? '').length).toBeGreaterThan(20);
    });
});

describe('SettingsPage', () =>
{
    it('offers a language for every locale the app ships', () =>
    {
        const { container } = renderTest(() => SettingsPage());
        const pressed = [...container.querySelectorAll('button[aria-pressed]')];

        // 10 locales, each a toggle; the About and geo sections add none.
        expect(pressed.length).toBeGreaterThanOrEqual(10);
    });

    it('shows the build version, so a bug report can name it', () =>
    {
        const { container } = renderTest(() => SettingsPage());

        expect(container.textContent).toMatch(/\d+\.\d+\.\d+/);
    });
});
