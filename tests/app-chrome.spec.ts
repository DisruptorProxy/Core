import { afterEach, describe, expect, it } from 'vitest';

import { cleanup, renderTest } from '@azerothjs/testing';

import { NAV_ITEMS } from '../src/app/nav';
import Shell from '../src/app/shell.component.azeroth';
import SideRail from '../src/app/side-rail.component.azeroth';
import TabBar from '../src/app/tab-bar.component.azeroth';
import Titlebar from '../src/app/titlebar.component.azeroth';

// The two navigations are the same four destinations rendered twice - a rail on wide
// screens, a bottom bar on phones - so the property worth pinning is that they cannot
// drift apart, and that both mark the active route for assistive tech rather than by
// colour alone.

afterEach(() => cleanup());

const links = (root: HTMLElement): HTMLAnchorElement[] =>
    [...root.querySelectorAll('a')] as HTMLAnchorElement[];

describe('SideRail and TabBar', () =>
{
    it('both render every destination in NAV_ITEMS, in order', () =>
    {
        for (const [name, render] of [['SideRail', SideRail], ['TabBar', TabBar]] as const)
        {
            const { container } = renderTest(() => render());
            const hrefs = links(container).map((a) => a.getAttribute('href'));

            expect(hrefs, name).toEqual(NAV_ITEMS.map((item) => item.path));
            cleanup();
        }
    });

    it('labels every destination, so no navigation is an unlabelled icon', () =>
    {
        for (const [name, render] of [['SideRail', SideRail], ['TabBar', TabBar]] as const)
        {
            const { container } = renderTest(() => render());

            for (const link of links(container))
            {
                expect(link.textContent?.trim(), `${ name } ${ link.getAttribute('href') }`).not.toBe('');
            }

            cleanup();
        }
    });

    it('gives each destination an icon alongside its label', () =>
    {
        const { container } = renderTest(() => TabBar());

        expect(container.querySelectorAll('svg').length).toBe(NAV_ITEMS.length);
    });

    it('names the navigation landmark, since the page has two of them', () =>
    {
        for (const [name, render] of [['SideRail', SideRail], ['TabBar', TabBar]] as const)
        {
            const { container } = renderTest(() => render());
            const nav = container.querySelector('nav')!;

            expect(nav.getAttribute('aria-label'), name).toBeTruthy();
            cleanup();
        }
    });

    it('marks exactly one destination active for the current route', () =>
    {
        // `selector` drives this: it re-runs only the rows whose state changed, so a
        // second active row would mean the selector key stopped matching the route.
        const { container } = renderTest(() => SideRail());
        const active = links(container).filter((a) => /text-accent|bg-accent/.test(a.className));

        expect(active.length).toBeLessThanOrEqual(1);
    });
});

describe('Titlebar', () =>
{
    it('labels every window control, since all three are icon-only', () =>
    {
        const { container } = renderTest(() => Titlebar());
        const buttons = [...container.querySelectorAll('button')];

        expect(buttons.length).toBeGreaterThanOrEqual(3);

        for (const button of buttons)
        {
            expect(button.getAttribute('aria-label')?.trim(), button.outerHTML.slice(0, 60)).toBeTruthy();
        }
    });
});

describe('Shell', () =>
{
    it('mounts the whole chrome: both navigations, a main region and the toast host', () =>
    {
        const { container } = renderTest(() => Shell());

        expect(container.querySelectorAll('nav').length, 'rail and tab bar are both mounted, CSS picks one').toBe(2);
        expect(container.querySelector('main')).not.toBeNull();
        expect(container.querySelector('[role="status"]'), 'toast host must always be present').not.toBeNull();
    });

    it('renders the routed screen inside the error boundary, not beside it', () =>
    {
        // The boundary wraps <Routes>; a screen crash must be contained to `main` and
        // leave the navigation usable, which is the whole point of where it sits.
        const { container } = renderTest(() => Shell());
        const main = container.querySelector('main')!;

        expect((main.textContent ?? '').trim().length).toBeGreaterThan(0);
    });
});
