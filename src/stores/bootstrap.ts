/**
 * Starts a store's initial read without letting a storage failure become an unhandled
 * rejection.
 *
 * Every store here fires one of these the moment it is constructed, and every one of them
 * talks to IndexedDB or a Tauri command. Both can fail for reasons that are not bugs: a
 * private-mode browser has no IndexedDB at all, a corrupted profile fails the open, and the
 * Tauri commands are simply absent when the frontend runs in a plain browser. Unhandled,
 * each of those becomes a rejection with no owner and no message the user can act on.
 *
 * Caught, the store keeps whatever defaults it declared, which is a state every screen
 * already renders (empty list, no health, the `global` routing profile). The app degrades
 * instead of breaking, and the reason still reaches the console.
 */
export const bootstrap = (label: string, run: () => Promise<unknown>): void =>
{
    void run().catch((error: unknown) =>
    {
        console.error(`[disruptor-proxy] ${ label } store failed to load:`, error);
    });
};
