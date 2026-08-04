import { createSignal, createStore } from 'azerothjs';

/**
 * Multi-select for the server list: the state behind "delete 3000 dead configs",
 * which no other client makes possible.
 *
 * The selected set is a plain signal read by each row's checkbox. That is cheap
 * here precisely because the list is virtualized - only ~25 rows are ever mounted,
 * so a toggle re-runs at most ~25 tiny class bindings, never 8000. (The single
 * ACTIVE-connection highlight, where re-running the whole window would be wasteful,
 * is a `createSelector` in the connection store instead.)
 */
export const useSelection = createStore(() =>
{
    const [active, setActive] = createSignal(false);
    const [selected, setSelected] = createSignal<ReadonlySet<string>>(new Set());

    // Where a shift-click measures FROM. Every ordinary tick moves it, which is what makes
    // "click one, shift-click another" mean the run between them and nothing else.
    let anchor: string | null = null;

    const isSelected = (id: string): boolean => selected().has(id);

    const toggle = (id: string): void =>
    {
        const next = new Set(selected());

        if (next.has(id))
        {
            next.delete(id);
        }
        else
        {
            next.add(id);
        }

        anchor = id;
        setSelected(next);
    };

    /**
     * Adds the run between the last-ticked row and `id`, in the order the list is CURRENTLY
     * showing - `ordered` is the visible ids, so a range follows what the user can see
     * rather than some underlying catalogue order they have filtered or sorted away.
     *
     * With no anchor yet this is an ordinary tick, which is what a bare shift-click on a
     * fresh selection should do.
     */
    const extendTo = (id: string, ordered: string[]): void =>
    {
        const from = anchor === null ? -1 : ordered.indexOf(anchor);
        const to = ordered.indexOf(id);

        if (from === -1 || to === -1)
        {
            toggle(id);

            return;
        }

        const next = new Set(selected());
        const [start, end] = from <= to ? [from, to] : [to, from];

        for (let index = start; index <= end; index++)
        {
            next.add(ordered[index]);
        }

        // The anchor deliberately does NOT move: shift-clicking again from the same origin
        // grows or shrinks one run, the behaviour every file manager has.
        setSelected(next);
    };

    /** Enters select mode with nothing ticked - the toolbar "Select" button. */
    const enter = (): void =>
    {
        anchor = null;
        setActive(true);
        setSelected(new Set());
    };

    /** Enters select mode with `id` already ticked - the natural result of a long-press. */
    const begin = (id: string): void =>
    {
        anchor = id;
        setActive(true);
        setSelected(new Set([id]));
    };

    /** Selects an explicit id list - "select all" passes the current filtered ids. */
    const selectMany = (ids: string[]): void =>
    {
        anchor = ids[ids.length - 1] ?? null;
        setSelected(new Set(ids));
    };

    const clear = (): void =>
    {
        anchor = null;
        setActive(false);
        setSelected(new Set());
    };

    const count = (): number => selected().size;

    return {
        active,
        selected,
        count,
        isSelected,
        toggle,
        extendTo,
        enter,
        begin,
        selectMany,
        clear
    };
});
