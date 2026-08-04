import { afterEach, describe, expect, it } from 'vitest';

import { createSignal } from 'azerothjs';
import { cleanup, renderTest } from '@azerothjs/testing';

import VirtualList from '../src/components/virtual-list.component.azeroth';

// The list that makes an 8000-server catalogue affordable. Its contract is narrower than
// a generic virtualizer's: heights are KNOWN per item but VARY by kind (a server row, a
// group header, a quota strip), so it owns a prefix sum plus a binary search rather than
// using the framework's fixed-size createVirtualizer.

interface Row
{
    id: string;
    tall: boolean;
}

const rows = (n: number): Row[] =>
    Array.from({ length: n }, (_, i) => ({ id: `r${ i }`, tall: i % 10 === 0 }));

const heightOf = (row: Row): number => (row.tall ? 64 : 40);

const render = (items: Row[], overscan?: number): HTMLElement =>
    VirtualList<Row>({
        items: () => items,
        keyOf: (row) => row.id,
        heightOf,
        overscan,
        children: (row) =>
        {
            const el = document.createElement('div');

            el.dataset.id = row.id;
            el.textContent = row.id;

            return el;
        }
    });

afterEach(() => cleanup());

describe('VirtualList', () =>
{
    it('renders a fraction of a large list, not all of it', () =>
    {
        const { container } = renderTest(() => render(rows(8000)));
        const painted = container.querySelectorAll('[data-id]').length;

        expect(painted).toBeGreaterThan(0);
        expect(painted, '8000 rows must not all be in the DOM').toBeLessThan(100);
    });

    it('sizes the spacer to the SUM of the varying heights, not count times a constant', () =>
    {
        const items = rows(100);
        const expected = items.reduce((sum, row) => sum + heightOf(row), 0);
        const { container } = renderTest(() => render(items));

        // The sized spacer is what gives the scroller its range; if it were computed from a
        // single row height the scrollbar would be wrong for every mixed-height list.
        const spacer = [...container.querySelectorAll('div')]
            .map((el) => el.style.height)
            .find((h) => h !== '' && h !== '0px');

        expect(spacer).toBe(`${ expected }px`);
    });

    it('gives every rendered row its own declared height', () =>
    {
        const { container } = renderTest(() => render(rows(50)));
        const painted = [...container.querySelectorAll('[data-id]')];

        for (const el of painted)
        {
            const wrapper = el.parentElement!;
            const row = rows(50).find((r) => r.id === (el as HTMLElement).dataset.id)!;

            expect(wrapper.style.height, row.id).toBe(`${ heightOf(row) }px`);
        }
    });

    it('renders nothing for an empty list, and does not throw', () =>
    {
        const { container } = renderTest(() => render([]));

        expect(container.querySelectorAll('[data-id]').length).toBe(0);
    });

    it('survives a list that shrinks under it', () =>
    {
        // A bulk delete replaces the item array while the window still points past its end.
        const [items, setItems] = createSignal(rows(500));
        const { container } = renderTest(() => VirtualList<Row>({
            items,
            keyOf: (row) => row.id,
            heightOf,
            children: (row) =>
            {
                const el = document.createElement('div');

                el.dataset.id = row.id;

                return el;
            }
        }));

        expect(container.querySelectorAll('[data-id]').length).toBeGreaterThan(0);

        setItems(rows(2));

        expect(container.querySelectorAll('[data-id]').length).toBe(2);
    });

    it('keys rows by identity, so a reorder reuses elements rather than rebuilding', () =>
    {
        // Small enough that every row stays inside the window across the reorder - a row
        // that scrolls out and back is legitimately a new element and would prove nothing.
        const first = rows(4);
        const [items, setItems] = createSignal(first);
        const { container } = renderTest(() => VirtualList<Row>({
            items,
            keyOf: (row) => row.id,
            heightOf,
            children: (row) =>
            {
                const el = document.createElement('div');

                el.dataset.id = row.id;

                return el;
            }
        }));

        const before = container.querySelector('[data-id="r1"]');

        setItems([...first].reverse());

        const after = container.querySelector('[data-id="r1"]');

        expect(before).not.toBeNull();
        expect(after).toBe(before);
    });
});
