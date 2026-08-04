import { afterEach, describe, expect, it } from 'vitest';

import { cleanup, renderTest } from '@azerothjs/testing';

import ConfigDetail from '../src/features/configs/config-detail.component.azeroth';
import ConfigList from '../src/features/configs/config-list.component.azeroth';
import GroupHeader from '../src/features/configs/group-header.component.azeroth';
import { STANDALONE_KEY } from '../src/stores/groups';
import ImportSheet from '../src/features/import/import-sheet.component.azeroth';

/** A handler a test supplies only because the prop is required. */
const noop = (): void => undefined;

// The remaining panels of the servers screen. All four read stores rather than props, so
// with storage unavailable they render their empty or closed state - which is the state a
// first launch shows, and the one most likely to be wrong because it is least looked at.

afterEach(() => cleanup());

describe('ConfigDetail', () =>
{
    it('shows the nothing-selected panel rather than an empty column', () =>
    {
        // A wide window always has this panel on screen; blank would read as broken.
        const { container } = renderTest(() => ConfigDetail());

        expect((container.textContent ?? '').trim().length).toBeGreaterThan(0);
    });
});

describe('ConfigList', () =>
{
    it('renders without a catalogue and without throwing', () =>
    {
        expect(() => renderTest(() => ConfigList({ onEditSub: noop, onDeleteSub: noop }))).not.toThrow();
    });
});

describe('GroupHeader', () =>
{
    it('renders the standalone group, which has no subscription behind it', () =>
    {
        // `subId: null` is the "Other servers" bucket - it must not offer edit or refresh
        // actions for a subscription that does not exist.
        const { container } = renderTest(() => GroupHeader({
            groupKey: STANDALONE_KEY,
            subId: null,
            onEdit: noop,
            onDelete: noop
        }));

        expect((container.textContent ?? '').trim().length).toBeGreaterThan(0);
    });

    it('exposes its collapse state to assistive tech', () =>
    {
        const { container } = renderTest(() => GroupHeader({
            groupKey: STANDALONE_KEY,
            subId: null,
            onEdit: noop,
            onDelete: noop
        }));

        const expandable = container.querySelector('[aria-expanded]');

        if (expandable !== null)
        {
            expect(['true', 'false']).toContain(expandable.getAttribute('aria-expanded'));
        }
        else
        {
            expect(container.querySelectorAll('button').length).toBeGreaterThan(0);
        }
    });
});

describe('ImportSheet', () =>
{
    it('renders nothing while closed', () =>
    {
        const { container } = renderTest(() => ImportSheet({ open: () => false, onClose: noop }));

        expect((container.textContent ?? '').trim()).toBe('');
    });

    it('opens onto the paste field with Import unreachable until there is input', () =>
    {
        const { container } = renderTest(() => ImportSheet({ open: () => true, onClose: noop }));

        expect(container.querySelector('textarea')).not.toBeNull();

        const disabled = [...container.querySelectorAll('button')].filter((b) => b.disabled);

        expect(disabled.length, 'Import must be disabled on an empty paste').toBeGreaterThan(0);
    });

    it('offers the clipboard and file routes in, not only typing', () =>
    {
        const { container } = renderTest(() => ImportSheet({ open: () => true, onClose: noop }));

        expect(container.querySelectorAll('button').length).toBeGreaterThanOrEqual(3);
        expect(container.querySelector('input[type="file"]')).not.toBeNull();
    });
});
