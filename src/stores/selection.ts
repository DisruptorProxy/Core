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

        setSelected(next);
    };

    /** Enters select mode with nothing ticked - the toolbar "Select" button. */
    const enter = (): void =>
    {
        setActive(true);
        setSelected(new Set());
    };

    /** Enters select mode with `id` already ticked - the natural result of a long-press. */
    const begin = (id: string): void =>
    {
        setActive(true);
        setSelected(new Set([id]));
    };

    /** Selects an explicit id list - "select all" passes the current filtered ids. */
    const selectMany = (ids: string[]): void => setSelected(new Set(ids));

    const clear = (): void =>
    {
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
        enter,
        begin,
        selectMany,
        clear
    };
});
