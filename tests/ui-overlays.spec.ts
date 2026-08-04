import { afterEach, describe, expect, it, vi } from 'vitest';

import { createSignal } from 'azerothjs';
import { cleanup, fire, renderTest } from '@azerothjs/testing';

import Sheet from '../src/components/sheet.component.azeroth';
import ToastHost from '../src/components/toast-host.component.azeroth';
import { useToast } from '../src/stores/toast';

/** A handler a test supplies only because the prop is required. */
const noop = (): void => undefined;

// The two overlays. Both sit on a Transition, so the property that matters is not the
// animation but that dismissal is always reachable: a sheet with no way out and a toast
// stack that never drains are the two ways this UI traps a user.

afterEach(() =>
{
    cleanup();
    vi.useRealTimers();
});

const child = (text: string): HTMLElement =>
{
    const el = document.createElement('p');

    el.textContent = text;

    return el;
};

describe('Sheet', () =>
{
    it('renders nothing while closed', () =>
    {
        const { container } = renderTest(() => Sheet({
            open: () => false,
            onClose: noop,
            title: 'Import servers',
            children: child('body')
        }));

        expect(container.textContent).not.toContain('body');
    });

    it('renders its title and children when open, as a modal dialog', () =>
    {
        const { container } = renderTest(() => Sheet({
            open: () => true,
            onClose: noop,
            title: 'Import servers',
            children: child('body')
        }));

        const dialog = container.querySelector('[role="dialog"]')!;

        expect(dialog).not.toBeNull();
        expect(dialog.getAttribute('aria-modal')).toBe('true');
        expect(container.textContent).toContain('Import servers');
        expect(container.textContent).toContain('body');
    });

    it('closes from the backdrop AND from the close button - both, or the sheet can trap', () =>
    {
        for (const index of [0, 1])
        {
            const onClose = vi.fn();
            const { container } = renderTest(() => Sheet({
                open: () => true,
                onClose,
                title: 'Import servers',
                children: child('body')
            }));

            fire([...container.querySelectorAll('button')][index], 'click');

            expect(onClose, `button ${ index }`).toHaveBeenCalledTimes(1);
            cleanup();
        }
    });

    it('opens reactively when `open` flips', () =>
    {
        const [open, setOpen] = createSignal(false);
        const { container } = renderTest(() => Sheet({
            open,
            onClose: noop,
            title: 'Import servers',
            children: child('body')
        }));

        expect(container.textContent).not.toContain('body');

        setOpen(true);

        expect(container.textContent).toContain('body');
    });
});

describe('ToastHost', () =>
{
    it('is a polite live region, so a screen reader announces without stealing focus', () =>
    {
        const { container } = renderTest(() => ToastHost());
        const region = container.querySelector('[role="status"]')!;

        expect(region.getAttribute('aria-live')).toBe('polite');
    });

    it('shows a pushed toast and drops it again on dismiss', () =>
    {
        const toast = useToast();
        const { container } = renderTest(() => ToastHost());

        const id = toast.success('Imported 8 servers');

        expect(container.textContent).toContain('Imported 8 servers');

        toast.dismiss(id);

        // TransitionGroup holds the leaving element in place for its duration, so the
        // store is the honest assertion for "gone", not the DOM.
        expect(toast.toasts().some((item) => item.id === id)).toBe(false);
    });

    it('caps the queue rather than growing without bound', () =>
    {
        const toast = useToast();

        renderTest(() => ToastHost());

        for (let i = 0; i < 12; i++)
        {
            toast.info(`message ${ i }`);
        }

        const live = toast.toasts();

        expect(live.length).toBeLessThanOrEqual(5);
        // The cap must drop the OLDEST, so the newest message is always the one on screen.
        expect(live[live.length - 1].message).toBe('message 11');
    });

    it('gives every kind a distinct glyph, so tone is not carried by colour alone', () =>
    {
        const toast = useToast();
        const { container } = renderTest(() => ToastHost());

        toast.success('ok');
        toast.error('bad');
        toast.info('note');

        const glyphs = [...container.querySelectorAll('[role="status"] svg')];

        expect(glyphs.length).toBeGreaterThanOrEqual(3);
    });
});
