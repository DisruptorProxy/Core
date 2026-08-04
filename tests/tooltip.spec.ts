import { afterEach, describe, expect, it } from 'vitest';

import { cleanup, fire, renderTest } from '@azerothjs/testing';

import Tooltip from '../src/components/tooltip.component.azeroth';

// The CSS-only tooltip this replaces could not be fixed by any z-index: `.glass` and
// `.glass-bar` carry a backdrop-filter, which creates a stacking context, so the bubble
// competed only inside the panel it lived in and slid under the next card. It was also
// clipped by the server list's `overflow-hidden`. Leaving the subtree is the whole fix,
// so that is what these pin.

const trigger = (): HTMLElement =>
{
    const button = document.createElement('button');

    button.type = 'button';
    button.textContent = 'icon';

    return button;
};

afterEach(() =>
{
    cleanup();
    document.body.querySelectorAll('[aria-hidden="true"]').forEach((n) => n.remove());
});

describe('Tooltip', () =>
{
    it('shows nothing until the pointer arrives', () =>
    {
        const { container } = renderTest(() => Tooltip({ label: 'Edit', children: trigger() }));

        expect(container.textContent).not.toContain('Edit');
    });

    it('renders the bubble OUTSIDE its own subtree, which is what escapes the stacking context', () =>
    {
        const { container } = renderTest(() => Tooltip({ label: 'Edit', children: trigger() }));

        fire(container.querySelector('span')!, 'mouseenter');

        // Inside the wrapper there is still only the trigger; the bubble went to the body.
        const escaped = [...document.body.querySelectorAll('[aria-hidden="true"]')]
            .some((n) => n.textContent === 'Edit' && !container.contains(n));

        expect(escaped, 'the bubble must not stay inside the trigger subtree').toBe(true);
    });

    it('positions the bubble fixed, so an overflow-hidden ancestor cannot clip it', () =>
    {
        const { container } = renderTest(() => Tooltip({ label: 'Edit', children: trigger() }));

        fire(container.querySelector('span')!, 'mouseenter');

        const bubble = [...document.body.querySelectorAll('[aria-hidden="true"]')]
            .find((n) => n.textContent === 'Edit') as HTMLElement | undefined;

        expect(bubble).toBeDefined();
        expect(bubble!.className).toContain('fixed');
    });

    it('hides again when the pointer leaves', () =>
    {
        const { container } = renderTest(() => Tooltip({ label: 'Edit', children: trigger() }));
        const wrap = container.querySelector('span')!;

        fire(wrap, 'mouseenter');
        fire(wrap, 'mouseleave');

        const bubble = [...document.body.querySelectorAll('[aria-hidden="true"]')]
            .find((n) => n.textContent === 'Edit');

        expect(bubble).toBeUndefined();
    });

    it('hides the bubble from assistive tech, since the trigger already carries the name', () =>
    {
        const { container } = renderTest(() => Tooltip({ label: 'Edit', children: trigger() }));

        fire(container.querySelector('span')!, 'mouseenter');

        const bubble = [...document.body.querySelectorAll('span')].find((n) => n.textContent === 'Edit');

        expect(bubble?.getAttribute('aria-hidden')).toBe('true');
    });

    it('keeps rendering its trigger', () =>
    {
        const { container } = renderTest(() => Tooltip({ label: 'Edit', children: trigger() }));

        expect(container.querySelector('button')?.textContent).toBe('icon');
    });
});
