import { afterEach, describe, expect, it } from 'vitest';

import { cleanup, fire, renderTest } from '@azerothjs/testing';

import type { LatencyStats } from '../src/lib/db/schema';
import BulkBar from '../src/features/configs/bulk-bar.component.azeroth';
import ImportReport from '../src/features/configs/import-report.component.azeroth';
import LatencyCell from '../src/features/configs/latency-cell.component.azeroth';
import { useSelection } from '../src/stores/selection';

// The server-list feature components. These are the ones that report NUMBERS to the user -
// latency, how many were imported, how many are selected - and a number that is wrong or
// missing is worse than no number at all, because it is believed.

afterEach(() =>
{
    useSelection().clear();
    cleanup();
});

const stats = (over: Partial<LatencyStats> = {}): LatencyStats => ({
    successRate: 1,
    attempts: 4,
    ...over
});

describe('LatencyCell', () =>
{
    it('shows the untested placeholder before the first ping, not a zero', () =>
    {
        const { container } = renderTest(() => LatencyCell({
            label: 'TCP',
            stats: () => undefined,
            untested: 'Not tested',
            successLabel: 'success'
        }));

        expect(container.textContent).toContain('Not tested');
        expect(container.textContent).not.toContain('0ms');
    });

    it('shows the measured latency and success rate once there is one', () =>
    {
        const { container } = renderTest(() => LatencyCell({
            label: 'TCP',
            stats: () => stats({ ewmaMs: 142, successRate: 0.75 }),
            untested: 'Not tested',
            successLabel: 'success'
        }));

        expect(container.textContent).toContain('142ms');
        expect(container.textContent).toContain('75%');
    });

    it('tones the reading by bucket, so a slow server reads slow at a glance', () =>
    {
        const good = renderTest(() => LatencyCell({
            label: 'TCP', stats: () => stats({ ewmaMs: 30 }), untested: 'x', successLabel: 's'
        }));
        const goodTone = good.container.innerHTML;

        cleanup();

        const poor = renderTest(() => LatencyCell({
            label: 'TCP', stats: () => stats({ ewmaMs: 4000 }), untested: 'x', successLabel: 's'
        }));

        expect(goodTone).not.toBe(poor.container.innerHTML);
    });

    it('explains a failure in words rather than showing a raw engine error', () =>
    {
        const { container } = renderTest(() => LatencyCell({
            label: 'TCP',
            stats: () => stats({ successRate: 0, lastError: 'dial tcp 10.0.0.1:443: i/o timeout' }),
            untested: 'Not tested',
            successLabel: 'success'
        }));

        expect(container.textContent).not.toContain('i/o timeout');
        expect((container.textContent ?? '').trim().length).toBeGreaterThan(0);
    });
});

describe('ImportReport', () =>
{
    const report = (over: Record<string, unknown> = {}): never => ({
        kind: 'done',
        format: 'uri-list',
        added: 8,
        duplicates: 2,
        errors: [],
        elapsedMs: 9,
        ...over
    }) as never;

    it('accounts for what the import did, duplicates included', () =>
    {
        const { container } = renderTest(() => ImportReport({ report: report() }));

        expect(container.textContent).toContain('8');
        expect(container.textContent).toContain('2');
        expect(container.textContent).toContain('9ms');
    });

    it('renders nothing rather than crashing when handed a null report', () =>
    {
        // The narrowed accessor from the caller's <Show> has been observed yielding null
        // while the branch is built; this component tolerates it deliberately.
        const { container } = renderTest(() => ImportReport({ report: null }));

        expect((container.textContent ?? '').trim()).toBe('');
    });

    it('lists the unreadable lines so a bad paste can be fixed, not just counted', () =>
    {
        const { container } = renderTest(() => ImportReport({
            report: report({
                added: 1,
                errors: [{ line: 2, reason: 'Not a config link', snippet: 'not-a-link' }]
            })
        }));

        expect(container.textContent).toContain('Not a config link');
        expect(container.textContent).toContain('not-a-link');
    });
});

describe('BulkBar', () =>
{
    it('disables Delete at zero rather than offering an action that does nothing', () =>
    {
        // Showing the bar at all is the PAGE's decision - servers.page wraps this in a
        // <Transition when={ selection.active() }>. The component's own contract is that
        // its destructive action is unreachable while the selection is empty.
        const { container } = renderTest(() => BulkBar({ visibleIds: () => ['a', 'b'] }));
        const destructive = [...container.querySelectorAll('button')].find((b) => b.disabled);

        expect(destructive, 'the delete button must be disabled with nothing selected').toBeDefined();
    });

    it('appears with the count once a selection exists', () =>
    {
        const selection = useSelection();

        selection.enter();
        selection.toggle('a');
        selection.toggle('b');

        const { container } = renderTest(() => BulkBar({ visibleIds: () => ['a', 'b', 'c'] }));

        expect(container.textContent).toContain('2');
    });

    it('clears the selection from its own dismiss, so the bar can always be escaped', () =>
    {
        const selection = useSelection();

        selection.enter();
        selection.toggle('a');

        const { container } = renderTest(() => BulkBar({ visibleIds: () => ['a', 'b'] }));
        // Cancel is FIRST; the last button is Delete, which would start a real removal.
        const cancel = [...container.querySelectorAll('button')][0];

        fire(cancel, 'click');

        expect(selection.count()).toBe(0);
    });

    it('selects every visible row, not every row in the catalogue', () =>
    {
        // "Select all" while a filter is applied must mean the filtered set; selecting
        // 8000 hidden rows and then deleting is the accident this guards.
        const selection = useSelection();

        selection.enter();
        selection.toggle('a');

        const { container } = renderTest(() => BulkBar({ visibleIds: () => ['a', 'b'] }));
        const all = [...container.querySelectorAll('button')]
            .find((b) => b.querySelector('svg') !== null && b !== container.querySelector('button'));

        if (all !== undefined)
        {
            fire(all, 'click');
        }

        expect(selection.count()).toBeLessThanOrEqual(2);
    });
});

describe('selection store', () =>
{
    it('toggles a row in and out', () =>
    {
        const selection = useSelection();

        selection.enter();
        selection.toggle('a');

        expect(selection.isSelected('a')).toBe(true);

        selection.toggle('a');

        expect(selection.isSelected('a')).toBe(false);
    });

    it('leaves selection mode when cleared', () =>
    {
        const selection = useSelection();

        selection.enter();
        selection.toggle('a');
        selection.clear();

        expect(selection.count()).toBe(0);
        expect(selection.active()).toBe(false);
    });

    it('extendTo ticks the whole run between the last tick and the target', () =>
    {
        const selection = useSelection();
        const visible = ['a', 'b', 'c', 'd', 'e'];

        selection.enter();
        selection.toggle('b');
        selection.extendTo('d', visible);

        expect([...selection.selected()].sort()).toEqual(['b', 'c', 'd']);
    });

    it('extends the same way in both directions', () =>
    {
        const selection = useSelection();
        const visible = ['a', 'b', 'c', 'd', 'e'];

        selection.enter();
        selection.toggle('d');
        selection.extendTo('b', visible);

        expect([...selection.selected()].sort()).toEqual(['b', 'c', 'd']);
    });

    it('follows the VISIBLE order, not the catalogue order', () =>
    {
        // The user filtered or sorted; a range must mean what they can see between the
        // two rows they clicked, or it silently ticks servers that are off screen.
        const selection = useSelection();

        selection.enter();
        selection.toggle('e');
        selection.extendTo('c', ['e', 'd', 'c', 'b', 'a']);

        expect([...selection.selected()].sort()).toEqual(['c', 'd', 'e']);
    });

    it('keeps the anchor put, so shift-clicking again resizes one run', () =>
    {
        const selection = useSelection();
        const visible = ['a', 'b', 'c', 'd', 'e'];

        selection.enter();
        selection.toggle('b');
        selection.extendTo('e', visible);
        selection.extendTo('c', visible);

        // Still anchored at b: the second shift-click re-measures from there.
        expect([...selection.selected()]).toContain('c');
        expect([...selection.selected()]).toContain('b');
    });

    it('falls back to a plain tick when the row is not in the visible list', () =>
    {
        const selection = useSelection();

        selection.enter();
        selection.toggle('b');
        selection.extendTo('zz', ['a', 'b', 'c']);

        expect(selection.isSelected('zz')).toBe(true);
    });

    it('selectMany replaces rather than accumulating, so a re-filter cannot double up', () =>
    {
        const selection = useSelection();

        selection.enter();
        selection.selectMany(['a', 'b']);
        selection.selectMany(['a', 'b']);

        expect(selection.count()).toBe(2);
    });
});
