import { afterEach, describe, expect, it } from 'vitest';

import { createSignal } from 'azerothjs';
import { cleanup, renderTest } from '@azerothjs/testing';

import ShowHost from './fixtures/show-host.component.azeroth';

// Pins the shape the import sheet crashed on: a <Show> value callback whose branch
// builds a CHILD that reads the narrowed value EAGERLY (a `derived` lowers to a memo
// that pulls at construction). Show seeds that narrowed signal with `when`'s value at
// construction and only updates it from an effect while truthy, so these ask whether
// the value effect always lands before the swap effect builds the branch.
//
// All three pass, yet the live app DID observe a null narrowed value while the store
// behind `when` held a real object - so this file is a regression net, not the whole
// story. Keep it: if a framework change ever breaks the simple orderings too, this
// catches it before the app does.

interface Report
{
    errors: string[];
}

const host = (report: () => Report | null, done: () => boolean): HTMLElement =>
    ShowHost({
        get report()
        {
            return report();
        },
        get done()
        {
            return done();
        }
    });

afterEach(() => cleanup());

describe('Show value callback feeding an eagerly-reading child', () =>
{
    it('hands the child the real value, never the null seed', () =>
    {
        const [report, setReport] = createSignal<Report | null>(null);
        const [done, setDone] = createSignal(false);

        const { container } = renderTest(() => host(report, done));

        expect(container.textContent).not.toContain('errors');

        // The sheet's real order: the report lands first, then the flag flips.
        setReport({ errors: ['one', 'two'] });
        setDone(true);

        expect(container.textContent).toContain('errors: 2');
    });

    it('survives the flag flipping BEFORE the value lands', () =>
    {
        const [report, setReport] = createSignal<Report | null>(null);
        const [done, setDone] = createSignal(false);

        const { container } = renderTest(() => host(report, done));

        setDone(true);
        setReport({ errors: ['one'] });

        expect(container.textContent).toContain('errors: 1');
    });

    it('survives both landing in one synchronous turn', () =>
    {
        const [state, setState] = createSignal<{ report: Report | null; done: boolean }>({ report: null, done: false });

        const { container } = renderTest(() => host(() => state().report, () => state().done));

        setState({ report: { errors: ['one', 'two', 'three'] }, done: true });

        expect(container.textContent).toContain('errors: 3');
    });
});
