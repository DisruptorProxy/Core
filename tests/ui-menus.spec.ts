import { cleanup, fire, renderTest } from '@azerothjs/testing';

import { afterEach, describe, expect, it, vi } from 'vitest';

import FilterMenu from '../src/components/filter-menu.component.azeroth';
import FilterOptions from '../src/components/filter-options.component.azeroth';
import type { FilterOption } from '../src/components/filter-options.component.azeroth';

/** A handler a test supplies only because the prop is required. */
const noop = (): void => undefined;

// The two dropdowns. FilterOptions is the one carrying real logic - it windows its own
// list and owns a typeahead - so it gets the most attention. What matters across all three
// is that a menu can always be dismissed and that a disabled action cannot be reached.

afterEach(() => cleanup());

const options = (n: number): FilterOption[] =>
    Array.from({ length: n }, (_, i) => ({ value: `v${ i }`, label: `Option ${ i }` }));

describe('FilterOptions', () =>
{
    it('renders its options as a listbox of options', () =>
    {
        const { container } = renderTest(() => FilterOptions({
            id: 'proto',
            options: () => options(3),
            selected: () => false,
            onChoose: noop,
            onDismiss: noop
        }));

        expect(container.querySelector('[role="listbox"]')).not.toBeNull();
        expect(container.querySelectorAll('[role="option"]').length).toBe(3);
        expect(container.textContent).toContain('Option 1');
    });

    it('reports the chosen value', () =>
    {
        const onChoose = vi.fn();
        const { container } = renderTest(() => FilterOptions({
            id: 'proto',
            options: () => options(3),
            selected: () => false,
            onChoose,
            onDismiss: noop
        }));

        fire([...container.querySelectorAll('[role="option"]')][1] as HTMLElement, 'click');

        expect(onChoose).toHaveBeenCalledWith('v1');
    });

    it('marks the selected option for assistive tech, not just visually', () =>
    {
        const { container } = renderTest(() => FilterOptions({
            id: 'proto',
            options: () => options(3),
            selected: (value) => value === 'v2',
            onChoose: noop,
            onDismiss: noop
        }));

        const chosen = [...container.querySelectorAll('[role="option"]')]
            .filter((el) => el.getAttribute('aria-selected') === 'true');

        expect(chosen).toHaveLength(1);
    });

    it('windows a long list instead of rendering every row', () =>
    {
        // 8000 servers is the case this component exists for; rendering them all is the
        // regression it guards against.
        const { container } = renderTest(() => FilterOptions({
            id: 'proto',
            options: () => options(8000),
            selected: () => false,
            onChoose: noop,
            onDismiss: noop
        }));

        const rendered = container.querySelectorAll('[role="option"]').length;

        expect(rendered).toBeGreaterThan(0);
        expect(rendered, 'a windowed list must render a fraction of 8000').toBeLessThan(100);
    });

    it('declares multi-select on the listbox when asked', () =>
    {
        const single = renderTest(() => FilterOptions({
            id: 'a', options: () => options(2), selected: () => false, onChoose: noop, onDismiss: noop
        }));

        expect(single.container.querySelector('[role="listbox"]')!.getAttribute('aria-multiselectable')).toBe('false');

        cleanup();

        const multi = renderTest(() => FilterOptions({
            id: 'b', options: () => options(2), selected: () => false, onChoose: noop, onDismiss: noop, multi: true
        }));

        expect(multi.container.querySelector('[role="listbox"]')!.getAttribute('aria-multiselectable')).toBe('true');
    });

    it('offers a search field only when searchable', () =>
    {
        const plain = renderTest(() => FilterOptions({
            id: 'a', options: () => options(2), selected: () => false, onChoose: noop, onDismiss: noop
        }));

        expect(plain.container.querySelector('input')).toBeNull();

        cleanup();

        const searchable = renderTest(() => FilterOptions({
            id: 'b',
            options: () => options(2),
            selected: () => false,
            onChoose: noop,
            onDismiss: noop,
            searchable: true,
            searchPlaceholder: 'Find a country'
        }));

        expect(searchable.container.querySelector('input')!.placeholder).toContain('Find');
    });

    it('filters down to what was typed', () =>
    {
        const { container } = renderTest(() => FilterOptions({
            id: 'b',
            options: () => [
                { value: 'ir', label: 'Iran' },
                { value: 'de', label: 'Germany' },
                { value: 'se', label: 'Sweden' }
            ],
            selected: () => false,
            onChoose: noop,
            onDismiss: noop,
            searchable: true
        }));

        const search = container.querySelector('input')!;

        search.value = 'ger';
        fire(search, 'input');

        expect(container.textContent).toContain('Germany');
        expect(container.textContent).not.toContain('Sweden');
    });

    it('dismisses on Escape, so the keyboard is never trapped in the list', () =>
    {
        const onDismiss = vi.fn();
        const { container } = renderTest(() => FilterOptions({
            id: 'proto',
            options: () => options(3),
            selected: () => false,
            onChoose: noop,
            onDismiss
        }));

        const list = container.querySelector('[role="listbox"]') as HTMLElement;

        list.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

        expect(onDismiss).toHaveBeenCalled();
    });
});

describe('FilterMenu', () =>
{
    const base = {
        label: 'Protocol',
        summary: (): string => 'All',
        active: (): boolean => false,
        options: (): FilterOption[] => options(3),
        selected: (): boolean => false,
        onSelect: noop
    };

    it('renders its label and summary on the trigger, closed', () =>
    {
        const { container } = renderTest(() => FilterMenu({ ...base }));

        expect(container.textContent).toContain('Protocol');
        expect(container.textContent).toContain('All');
        expect(container.querySelector('[role="listbox"]')).toBeNull();
    });

    it('opens the list on the trigger, and says so on the button', () =>
    {
        const { container } = renderTest(() => FilterMenu({ ...base }));
        const trigger = container.querySelector('button')!;

        expect(trigger.getAttribute('aria-expanded')).toBe('false');

        fire(trigger, 'click');

        expect(trigger.getAttribute('aria-expanded')).toBe('true');
        expect(container.querySelector('[role="listbox"]')).not.toBeNull();
    });
});
