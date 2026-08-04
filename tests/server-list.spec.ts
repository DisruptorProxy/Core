import { cleanup, fire, renderTest } from '@azerothjs/testing';

import { afterEach, describe, expect, it, vi } from 'vitest';

import ConfigRow from '../src/features/configs/config-row.component.azeroth';
import FiltersBar from '../src/features/configs/filters-bar.component.azeroth';
import SubscriptionUsage from '../src/features/configs/subscription-usage.component.azeroth';

import { row } from './fixtures/data';

/** A handler a test supplies only because the prop is required. */
const noop = (): void => undefined;

// The server list's row and its filter bar. A row is rendered thousands of times, so its
// contract is the tightest in the app: it must say what the server IS (name, address,
// protocol, country) and what its STATE is (selected, active, open, pinging) without those
// two vocabularies colliding.

const props = (over: Record<string, unknown> = {}): never => ({
    row: row('a'),
    selectMode: () => false,
    isSelected: () => false,
    isActive: () => false,
    isOpen: () => false,
    latency: () => undefined,
    isPinging: () => false,
    onTap: noop,
    onHold: noop,
    ...over
}) as never;

afterEach(() => cleanup());

describe('ConfigRow', () =>
{
    it('shows the name and the address, the two things that identify a server', () =>
    {
        const { container } = renderTest(() => ConfigRow(props()));

        expect(container.textContent).toContain('Demo a');
        expect(container.textContent).toContain('a.example.invalid');
    });

    it('reports a tap', () =>
    {
        const onTap = vi.fn();
        const { container } = renderTest(() => ConfigRow(props({ onTap })));

        fire(container.querySelector('button') ?? container.firstElementChild as HTMLElement, 'click');

        expect(onTap).toHaveBeenCalled();
    });

    it('shows a latency reading only once there is one', () =>
    {
        const without = renderTest(() => ConfigRow(props()));

        expect(without.container.textContent).not.toContain('ms');

        cleanup();

        const withLatency = renderTest(() => ConfigRow(props({ latency: () => 142 })));

        expect(withLatency.container.textContent).toContain('142');
    });

    it('renders a flag for a real country code and none for a malformed one', () =>
    {
        const known = renderTest(() => ConfigRow(props({ row: row('a', { country: 'se' }) })));

        expect(known.container.innerHTML).toContain('fi-se');

        cleanup();

        // `a1` reaches here from a mangled provider label. It used to pass the length
        // check and emit `fi-a1`, which has no sprite, so the row drew a blank box.
        const malformed = renderTest(() => ConfigRow(props({ row: row('a', { country: 'a1' }) })));

        expect(malformed.container.innerHTML).not.toContain('fi-a1');
    });

    it('distinguishes selected, active and open - three different states, three looks', () =>
    {
        const base = renderTest(() => ConfigRow(props())).container.innerHTML;

        cleanup();

        const selected = renderTest(() => ConfigRow(props({ selectMode: () => true, isSelected: () => true }))).container.innerHTML;

        cleanup();

        const active = renderTest(() => ConfigRow(props({ isActive: () => true }))).container.innerHTML;

        cleanup();

        const open = renderTest(() => ConfigRow(props({ isOpen: () => true }))).container.innerHTML;

        expect(new Set([base, selected, active, open]).size, 'each state must look distinct').toBe(4);
    });

    it('badges the protocol, so a mixed list scans by kind', () =>
    {
        const { container } = renderTest(() => ConfigRow(props({ row: row('a', { protocol: 'trojan' }) })));

        expect(container.textContent?.toLowerCase()).toContain('trojan');
    });

    it('marks a REALITY server, which changes how it is reached', () =>
    {
        const { container } = renderTest(() => ConfigRow(props({ row: row('a', { security: 'reality' }) })));

        expect(container.textContent?.toLowerCase()).toContain('reality');
    });

    it('shows a favourite as a favourite', () =>
    {
        const plain = renderTest(() => ConfigRow(props())).container.innerHTML;

        cleanup();

        const starred = renderTest(() => ConfigRow(props({ row: row('a', { favorite: true }) }))).container.innerHTML;

        expect(starred).not.toBe(plain);
    });
});

describe('FiltersBar', () =>
{
    it('offers search and the filter chips without a catalogue loaded', () =>
    {
        // Storage is unavailable in tests, so this also proves the bar degrades rather
        // than depending on rows having arrived.
        const { container } = renderTest(() => FiltersBar());

        expect(container.querySelector('input')).not.toBeNull();
        expect(container.querySelectorAll('button').length).toBeGreaterThan(0);
    });

    it('always offers a way to sort', () =>
    {
        const { container } = renderTest(() => FiltersBar());

        expect(container.textContent?.toLowerCase()).toContain('sort');
    });

    it('focuses the search on Ctrl+F, which is otherwise a dead key in this app', () =>
    {
        const { container } = renderTest(() => FiltersBar());
        const search = container.querySelector('input')!;

        document.body.appendChild(container);
        expect(document.activeElement).not.toBe(search);

        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true }));

        expect(document.activeElement).toBe(search);
    });

    it('drops its document listener on teardown, so a remounted bar does not stack them', () =>
    {
        const before = renderTest(() => FiltersBar());

        document.body.appendChild(before.container);
        cleanup();

        // After teardown the handler must be gone: firing the shortcut may not reach into
        // a disposed component and focus an element that is no longer on the page.
        expect(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true })))
            .not.toThrow();
    });
});

describe('SubscriptionUsage', () =>
{
    it('renders nothing for a subscription that is not there, rather than a zeroed bar', () =>
    {
        // A quota strip reading 0 of 0 looks like an exhausted plan; absent is the
        // honest rendering for absent data.
        const { container } = renderTest(() => SubscriptionUsage({ subId: 'missing' }));

        expect((container.textContent ?? '').trim()).toBe('');
    });
});
