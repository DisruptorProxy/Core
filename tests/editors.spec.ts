import { afterEach, describe, expect, it, vi } from 'vitest';

import { cleanup, fire, renderTest } from '@azerothjs/testing';

import type { SubscriptionRecord } from '../src/lib/db/schema';
import type { Rule } from '../src/lib/routing/types';
import RuleEditor from '../src/features/routing/rule-editor.component.azeroth';
import DeleteDialog from '../src/features/subscriptions/delete-dialog.component.azeroth';
import SubscriptionEditor from '../src/features/subscriptions/subscription-editor.component.azeroth';

/** A handler a test supplies only because the prop is required. */
const noop = (): void => undefined;

// The three sheet-based editors. They share one shape - open/initial/onClose/onSubmit -
// and the properties worth pinning are the ones a user notices when they are wrong:
// an editor that opens with the previous subject's values still in it, a Save that fires
// with an empty field, and a destructive dialog whose two outcomes are not distinct.

afterEach(() => cleanup());

const rule = (over: Partial<Rule> = {}): Rule => ({
    id: 'r1',
    type: 'domain-suffix',
    value: '.example.invalid',
    action: 'direct',
    ...over
});

const sub = (over: Partial<SubscriptionRecord> = {}): SubscriptionRecord => ({
    id: 's1',
    url: 'https://provider.example.invalid/sub',
    name: 'Demo provider',
    intervalMin: 60,
    ...over
} as SubscriptionRecord);

const fieldsOf = (root: HTMLElement): HTMLInputElement[] =>
    [...root.querySelectorAll('input')].filter((el) => el.type !== 'radio') as HTMLInputElement[];

describe('RuleEditor', () =>
{
    it('renders nothing while closed', () =>
    {
        const { container } = renderTest(() => RuleEditor({
            open: () => false, initial: () => null, onClose: noop, onSubmit: noop
        }));

        expect((container.textContent ?? '').trim()).toBe('');
    });

    it('opens empty for a new rule, with Save unreachable until there is a value', () =>
    {
        const { container } = renderTest(() => RuleEditor({
            open: () => true, initial: () => null, onClose: noop, onSubmit: noop
        }));

        expect(fieldsOf(container)[0].value).toBe('');

        const save = [...container.querySelectorAll('button')].find((b) => b.disabled);

        expect(save, 'Save must be disabled with an empty value').toBeDefined();
    });

    it('prefills from the rule it was given, so editing is not retyping', () =>
    {
        const { container } = renderTest(() => RuleEditor({
            open: () => true, initial: () => rule(), onClose: noop, onSubmit: noop
        }));

        expect(fieldsOf(container)[0].value).toBe('.example.invalid');
    });

    it('never offers `final` as a match type - it is the pinned catch-all', () =>
    {
        const { container } = renderTest(() => RuleEditor({
            open: () => true, initial: () => null, onClose: noop, onSubmit: noop
        }));

        const labels = [...container.querySelectorAll('button')].map((b) => b.textContent?.toLowerCase() ?? '');

        expect(labels.some((l) => l.includes('everything else'))).toBe(false);
    });

    it('reports type, value and action together on submit', () =>
    {
        const onSubmit = vi.fn();
        const { container } = renderTest(() => RuleEditor({
            open: () => true, initial: () => rule(), onClose: noop, onSubmit
        }));

        const save = [...container.querySelectorAll('button')].find((b) => !b.disabled && /save|ذخیره/i.test(b.textContent ?? ''));

        if (save !== undefined)
        {
            fire(save, 'click');
            expect(onSubmit).toHaveBeenCalledWith('domain-suffix', '.example.invalid', 'direct');
        }
        else
        {
            expect.unreachable('the editor must offer a Save once prefilled');
        }
    });
});

describe('SubscriptionEditor', () =>
{
    it('prefills the url and name it was given', () =>
    {
        const { container } = renderTest(() => SubscriptionEditor({
            open: () => true, initial: () => sub(), onClose: noop, onSubmit: noop
        }));

        const values = fieldsOf(container).map((f) => f.value);

        expect(values).toContain('https://provider.example.invalid/sub');
        expect(values).toContain('Demo provider');
    });

    it('opens blank for a new subscription rather than keeping the last one', () =>
    {
        const { container } = renderTest(() => SubscriptionEditor({
            open: () => true, initial: () => null, onClose: noop, onSubmit: noop
        }));

        expect(fieldsOf(container).every((f) => f.value === '')).toBe(true);
    });
});

describe('DeleteDialog', () =>
{
    it('stays closed when there is no subscription to delete', () =>
    {
        const { container } = renderTest(() => DeleteDialog({
            sub: () => null, onClose: noop, onConfirm: noop
        }));

        expect((container.textContent ?? '').trim()).toBe('');
    });

    it('names the subscription it is about to delete', () =>
    {
        const { container } = renderTest(() => DeleteDialog({
            sub: () => sub(), onClose: noop, onConfirm: noop
        }));

        expect(container.textContent).toContain('Demo provider');
    });

    it('offers BOTH outcomes distinctly - keeping the servers is not the same as deleting them', () =>
    {
        const onConfirm = vi.fn();
        const { container } = renderTest(() => DeleteDialog({
            sub: () => sub(), onClose: noop, onConfirm
        }));

        const actions = [...container.querySelectorAll('button')];

        // Two confirm paths plus the sheet's own close controls.
        expect(actions.length).toBeGreaterThanOrEqual(3);

        const calls = new Set<boolean>();

        for (const action of actions)
        {
            onConfirm.mockClear();
            fire(action, 'click');

            if (onConfirm.mock.calls.length > 0)
            {
                calls.add(onConfirm.mock.calls[0][0] as boolean);
            }
        }

        expect(calls, 'keepConfigs must be reachable as both true and false').toEqual(new Set([true, false]));
    });
});
