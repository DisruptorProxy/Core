import { afterEach, describe, expect, it, vi } from 'vitest';

import { cleanup, fire, renderTest } from '@azerothjs/testing';

import type { ConfigRow } from '../src/lib/db/repo';
import CandidateList from '../src/features/connection/candidate-list.component.azeroth';
import ConnectionStatus from '../src/features/connection/connection-status.component.azeroth';

// The switch-server list and the live readout. Both are rendered in two places each (the
// Connect screen and the servers side panel), which is exactly why they are components -
// so the phone and desktop placements cannot drift.

/** A row with obviously fake values; `.invalid` can never resolve. */
const row = (id: string, over: Partial<ConfigRow> = {}): ConfigRow => ({
    id,
    name: `Demo ${ id }`,
    protocol: 'vless',
    host: `${ id }.example.invalid`,
    port: 443,
    security: 'tls',
    transport: 'tcp',
    tags: [],
    favorite: false,
    haystack: `demo ${ id }`,
    ...over
});

afterEach(() => cleanup());

describe('CandidateList', () =>
{
    it('renders one row per candidate, with its address', () =>
    {
        const { container } = renderTest(() => CandidateList({
            rows: [row('a'), row('b')],
            activeId: null,
            onTap: () => undefined
        }));

        expect(container.querySelectorAll('button').length).toBe(2);
        expect(container.textContent).toContain('a.example.invalid:443');
    });

    it('reports the id that was tapped', () =>
    {
        const onTap = vi.fn();
        const { container } = renderTest(() => CandidateList({
            rows: [row('a'), row('b')],
            activeId: null,
            onTap
        }));

        fire([...container.querySelectorAll('button')][1], 'click');

        expect(onTap).toHaveBeenCalledWith('b');
    });

    it('marks the connected server in place rather than reordering the list', () =>
    {
        const { container } = renderTest(() => CandidateList({
            rows: [row('a'), row('b'), row('c')],
            activeId: 'b',
            onTap: () => undefined
        }));

        const buttons = [...container.querySelectorAll('button')];
        const highlighted = buttons.filter((b) => b.className.includes('border-accent'));

        expect(highlighted).toHaveLength(1);
        // Position must be unchanged: a list that reorders under the thumb mis-taps.
        expect(buttons.indexOf(highlighted[0])).toBe(1);
    });

    it('draws a flag when the country is known and nothing when it is not', () =>
    {
        const { container } = renderTest(() => CandidateList({
            rows: [row('a', { country: 'se' }), row('b')],
            activeId: null,
            onTap: () => undefined
        }));

        const flags = [...container.querySelectorAll('span')].filter((s) => s.className.includes('fi-'));

        // An unknown code yields '' from flagIcon, which must render no flag rather than
        // an empty bordered box.
        expect(flags).toHaveLength(1);
        expect(flags[0].className).toContain('fi-se');
    });

    it('renders an empty list without throwing', () =>
    {
        const { container } = renderTest(() => CandidateList({
            rows: [],
            activeId: null,
            onTap: () => undefined
        }));

        expect(container.querySelectorAll('button').length).toBe(0);
    });
});

describe('ConnectionStatus', () =>
{
    it('renders nothing without an active config, leaving the gating to its caller', () =>
    {
        const { container } = renderTest(() => ConnectionStatus());

        // Disconnected is the default state of the store in a fresh test root.
        expect(container.textContent?.trim() ?? '').toBe('');
    });
});
