import { createStore } from 'azerothjs';
import { createSignal } from 'azerothjs';

/**
 * Is the window wide enough for a two-column master-detail layout? The threshold
 * sits above the expanded window's comfortable size, so the split appears only
 * when there is genuinely room for a list AND a detail panel side by side -
 * compact mode (and a dragged-narrow expanded window) stays single-column with
 * the bottom sheet. Like the theme store's media query, this stays subscribed for
 * the life of the app so a live resize flips the layout without a reload.
 */
const WIDE = '(min-width: 900px)';

export const useViewport = createStore(() =>
{
    const query = window.matchMedia(WIDE);
    const [isWide, setIsWide] = createSignal(query.matches);

    query.addEventListener('change', (event) => setIsWide(event.matches));

    return { isWide };
});
