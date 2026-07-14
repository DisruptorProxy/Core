import { createStore } from 'azerothjs';
import { createSignal } from 'azerothjs';

/**
 * Which server's detail sheet is open, if any.
 *
 * A tiny store rather than prop-threading: the row that opens the sheet (deep in
 * the virtual list) and the sheet itself (mounted at the screen root) are far
 * apart, and neither should have to know about the other. Both just read this.
 */
export const useDetail = createStore(() =>
{
    const [openId, setOpenId] = createSignal<string | null>(null);

    return {
        openId,
        open: (id: string): void => setOpenId(id),
        close: (): void => setOpenId(null)
    };
});
