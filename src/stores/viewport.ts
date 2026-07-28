import { createSignal, createStore } from 'azerothjs';

/**
 * Is the window wide enough for a two-column master-detail layout? The threshold
 * sits above the expanded window's comfortable size, so the split appears only
 * when there is genuinely room for a list AND a detail panel side by side -
 * compact mode (and a dragged-narrow expanded window) stays single-column with
 * the bottom sheet. Like the theme store's media query, this stays subscribed for
 * the life of the app so a live resize flips the layout without a reload.
 */
const WIDE = '(min-width: 900px)';

/**
 * A real mouse or trackpad, as opposed to a finger. This is a CAPABILITY, not a size:
 * menus anchor to their trigger as popovers where there is a precise pointer and a
 * hover state to preview with, and become modal bottom sheets where there is not.
 * A narrow desktop window still deserves a popover; a wide tablet still does not.
 */
const FINE_POINTER = '(hover: hover) and (pointer: fine)';

export const useViewport = createStore(() =>
{
    const query = window.matchMedia(WIDE);
    const [isWide, setIsWide] = createSignal(query.matches);

    query.addEventListener('change', (event) => setIsWide(event.matches));

    const pointer = window.matchMedia(FINE_POINTER);
    const [isFinePointer, setIsFinePointer] = createSignal(pointer.matches);

    pointer.addEventListener('change', (event) => setIsFinePointer(event.matches));

    return { isWide, isFinePointer };
});
