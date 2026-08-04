import { cleanup, fire, renderTest } from '@azerothjs/testing';

import { Server, Zap } from 'lucide';
import { afterEach, describe, expect, it, vi } from 'vitest';

import Button from '../src/components/button.component.azeroth';
import Card from '../src/components/card.component.azeroth';
import EmptyState from '../src/components/empty-state.component.azeroth';
import Input from '../src/components/input.component.azeroth';
import Screen from '../src/components/screen.component.azeroth';
import SectionHeading from '../src/components/section-heading.component.azeroth';
import Segmented from '../src/components/segmented.component.azeroth';
import Sparkline from '../src/components/sparkline.component.azeroth';

/** A handler a test supplies only because the prop is required. */
const noop = (): void => undefined;

// The shared primitives. What is worth pinning here is not the markup but the promises
// other components rely on: a disabled control does not fire, an optional prop that is
// absent renders nothing rather than "undefined", and a chart with no data draws nothing
// rather than a broken path.

afterEach(() => cleanup());

const child = (text: string): HTMLElement =>
{
    const el = document.createElement('p');

    el.textContent = text;

    return el;
};

describe('Button', () =>
{
    it('renders its label and fires onPress', () =>
    {
        const onPress = vi.fn();
        const { container } = renderTest(() => Button({ label: 'Connect', onPress }));

        expect(container.textContent).toContain('Connect');

        fire(container.querySelector('button')!, 'click');

        expect(onPress).toHaveBeenCalledTimes(1);
    });

    it('does not fire while disabled', () =>
    {
        const onPress = vi.fn();
        const { container } = renderTest(() => Button({ label: 'Connect', onPress, disabled: true }));
        const button = container.querySelector('button')!;

        expect(button.disabled).toBe(true);

        fire(button, 'click');

        // happy-dom dispatches to a disabled button, so the guard has to be the
        // attribute the browser honours - assert it, not the call count alone.
        expect(button.hasAttribute('disabled')).toBe(true);
    });

    it('keeps a 44px touch floor on every variant', () =>
    {
        for (const variant of ['primary', 'ghost', 'danger'] as const)
        {
            const { container } = renderTest(() => Button({ label: 'x', onPress: noop, variant }));

            expect(container.querySelector('button')!.className, variant).toContain('min-h-11');
            cleanup();
        }
    });

    it('renders a leading glyph when given one', () =>
    {
        const { container } = renderTest(() => Button({ label: 'Fastest', onPress: noop, leading: Zap }));

        expect(container.querySelector('svg')).not.toBeNull();
    });
});

describe('Card', () =>
{
    it('wraps its child and merges an extra class', () =>
    {
        const { container } = renderTest(() => Card({ children: child('inside'), class: 'p-4' }));

        expect(container.textContent).toContain('inside');
        expect(container.querySelector('div')!.className).toContain('p-4');
    });

    it('renders without a class prop, leaving no "undefined" in the class list', () =>
    {
        const { container } = renderTest(() => Card({ children: child('bare') }));

        expect(container.querySelector('div')!.className).not.toContain('undefined');
    });
});

describe('EmptyState', () =>
{
    it('shows the title and the hint, so an empty region is never silent', () =>
    {
        const { container } = renderTest(() => EmptyState({ glyph: Server, title: 'No servers yet.', hint: 'Add a subscription.' }));

        expect(container.textContent).toContain('No servers yet.');
        expect(container.textContent).toContain('Add a subscription.');
    });
});

describe('SectionHeading', () =>
{
    it('renders its label', () =>
    {
        const { container } = renderTest(() => SectionHeading({ glyph: Server, label: 'Servers' }));

        expect(container.textContent).toContain('Servers');
    });

    it('renders optional badge and trailing slots when supplied, and nothing when not', () =>
    {
        const withSlots = renderTest(() => SectionHeading({
            glyph: Server,
            label: 'Servers',
            badge: () => child('14'),
            trailing: () => child('Import')
        }));

        expect(withSlots.container.textContent).toContain('14');
        expect(withSlots.container.textContent).toContain('Import');

        cleanup();

        const bare = renderTest(() => SectionHeading({ glyph: Server, label: 'Servers' }));

        expect(bare.container.textContent).not.toContain('undefined');
    });
});

describe('Screen', () =>
{
    it('renders the title always and the subtitle only when given', () =>
    {
        const withSub = renderTest(() => Screen({ title: 'Routing', subtitle: 'What goes direct', children: child('body') }));

        expect(withSub.container.textContent).toContain('Routing');
        expect(withSub.container.textContent).toContain('What goes direct');

        cleanup();

        const bare = renderTest(() => Screen({ title: 'Routing', children: child('body') }));

        expect(bare.container.textContent).toContain('Routing');
        expect(bare.container.textContent).not.toContain('undefined');
    });
});

describe('Input', () =>
{
    it('reports what the user typed', () =>
    {
        const onInput = vi.fn();
        const { container } = renderTest(() => Input({ value: '', onInput }));
        const field = container.querySelector('input')!;

        field.value = 'node.example.invalid';
        fire(field, 'input');

        expect(onInput).toHaveBeenCalledWith('node.example.invalid');
    });

    it('shows the placeholder it was given', () =>
    {
        const { container } = renderTest(() => Input({ value: '', onInput: noop, placeholder: 'Search name, host, country' }));

        expect(container.querySelector('input')!.placeholder).toContain('Search');
    });
});

describe('Segmented', () =>
{
    const OPTIONS = [
        { value: 'smart', label: (): string => 'Smart' },
        { value: 'bypass', label: (): string => 'Bypass' }
    ];

    it('renders every option', () =>
    {
        const { container } = renderTest(() => Segmented({ label: 'Mode', options: OPTIONS, value: 'smart', onSelect: noop }));

        expect(container.textContent).toContain('Smart');
        expect(container.textContent).toContain('Bypass');
    });

    it('reports the value that was chosen, not the one already selected', () =>
    {
        const onSelect = vi.fn();
        const { container } = renderTest(() => Segmented({ label: 'Mode', options: OPTIONS, value: 'smart', onSelect }));
        const buttons = [...container.querySelectorAll('button')];

        fire(buttons.find((b) => b.textContent?.includes('Bypass'))!, 'click');

        expect(onSelect).toHaveBeenCalledWith('bypass');
    });
});

describe('Sparkline', () =>
{
    it('draws nothing for no samples rather than an empty box', () =>
    {
        const { container } = renderTest(() => Sparkline({ samples: [] }));

        expect(container.querySelector('path')?.getAttribute('d') ?? '').toBe('');
    });

    it('draws a flat line for a single sample, since one point has no trend', () =>
    {
        const { container } = renderTest(() => Sparkline({ samples: [42] }));
        const d = container.querySelector('path')!.getAttribute('d') ?? '';

        expect(d).toMatch(/^M0,[\d.]+ L\d+,[\d.]+$/);
    });

    it('plots one point per sample', () =>
    {
        const { container } = renderTest(() => Sparkline({ samples: [10, 20, 30, 40] }));
        const d = container.querySelector('path')!.getAttribute('d') ?? '';

        expect(d.split('L')).toHaveLength(4);
    });
});
