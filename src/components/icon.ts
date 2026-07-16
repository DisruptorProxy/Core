import { createElement } from 'lucide';
import type { IconNode } from 'lucide';

/**
 * Builds a Lucide icon as a real SVG element.
 *
 * The renderer appends any DOM node (its appendChild explicitly handles SVG),
 * but its `Child` type only names `HTMLElement` - the same cast the framework
 * itself uses internally for `<For>`. Kept in one place so no component has to
 * repeat it.
 *
 * Icons are decorative here: every icon in this app sits next to a text label or
 * inside a control with an accessible name, so they are hidden from screen
 * readers rather than announced as a second, redundant label.
 */
export const icon = (node: IconNode, className = 'size-5'): HTMLElement =>
{
    const svg = createElement(node, { class: className, 'aria-hidden': 'true' });

    return svg as unknown as HTMLElement;
};
