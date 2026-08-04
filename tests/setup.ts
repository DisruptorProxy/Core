// happy-dom does not give us a working `localStorage`, and the locale, theme and
// window-mode stores all read it at construction - so almost any component test would
// die on `getItem is not a function` before rendering a single node. A real in-memory
// implementation is closer to the browser than a stub of undefineds, and it lets a test
// seed a locale by writing to it.
if (typeof localStorage === 'undefined' || typeof localStorage.getItem !== 'function')
{
    const store = new Map<string, string>();

    const shim: Storage =
    {
        get length()
        {
            return store.size;
        },
        key: (index: number): string | null => [...store.keys()][index] ?? null,
        getItem: (key: string): string | null => store.get(key) ?? null,
        setItem: (key: string, value: string): void => void store.set(key, String(value)),
        removeItem: (key: string): void => void store.delete(key),
        clear: (): void => store.clear()
    };

    Object.defineProperty(globalThis, 'localStorage', { value: shim, configurable: true, writable: true });
}

// happy-dom has no IndexedDB, and the configs, health, subscriptions and routing stores all
// kick off a read the moment they are constructed. Without this every component test that
// touches a store emits an unhandled rejection that drowns the real failures. The stub
// FAILS the open deliberately rather than pretending to store anything: a spec that wants
// persistence should exercise the repo directly, and a component spec should be fine when
// storage is unavailable - which is also true on a device with IndexedDB blocked.
if (typeof globalThis.indexedDB === 'undefined')
{
    const failing = (): unknown =>
    {
        const request: Record<string, unknown> = { result: undefined, error: new Error('IndexedDB unavailable in tests') };

        queueMicrotask(() =>
        {
            const onerror = request.onerror as ((event: unknown) => void) | null;

            if (typeof onerror === 'function')
            {
                onerror({ target: request });
            }
        });

        return request;
    };

    Object.defineProperty(globalThis, 'indexedDB', {
        value: { open: failing, deleteDatabase: failing, databases: async (): Promise<unknown[]> => [] },
        configurable: true,
        writable: true
    });
}

// matchMedia backs the `system` theme; absent, the theme store throws on construction.
if (typeof globalThis.matchMedia !== 'function')
{
    Object.defineProperty(globalThis, 'matchMedia', {
        value: (query: string): MediaQueryList => ({
            matches: false,
            media: query,
            onchange: null,
            addEventListener: (): void => undefined,
            removeEventListener: (): void => undefined,
            addListener: (): void => undefined,
            removeListener: (): void => undefined,
            dispatchEvent: (): boolean => false
        }) as unknown as MediaQueryList,
        configurable: true,
        writable: true
    });
}
