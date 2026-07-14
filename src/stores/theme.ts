import { createStore } from 'azerothjs';
import { createEffect, createSignal } from 'azerothjs';

/** What the user chose. `system` follows the OS and keeps following it live. */
export type ThemePreference = 'system' | 'light' | 'dark';

/** What is actually painted right now. */
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'guardian.theme';

const isPreference = (value: string | null): value is ThemePreference =>
    value === 'system' || value === 'light' || value === 'dark';

const readStored = (): ThemePreference =>
{
    const stored = localStorage.getItem(STORAGE_KEY);

    return isPreference(stored) ? stored : 'system';
};

/**
 * Theme as a lazy singleton. The inline script in index.html applies the same
 * resolution before first paint; this store owns it from then on, so the two
 * must agree on STORAGE_KEY and on how `system` resolves.
 */
export const useTheme = createStore(() =>
{
    const query = window.matchMedia('(prefers-color-scheme: dark)');

    const [preference, setPreference] = createSignal<ThemePreference>(readStored());
    const [systemDark, setSystemDark] = createSignal(query.matches);

    // A `system` user who flips their OS theme must see it immediately, without
    // a reload - so the media query stays subscribed for the life of the app.
    const onSystemChange = (event: MediaQueryListEvent): void => setSystemDark(event.matches);

    query.addEventListener('change', onSystemChange);

    const resolved = (): ResolvedTheme =>
    {
        const value = preference();

        if (value === 'system')
        {
            return systemDark() ? 'dark' : 'light';
        }

        return value;
    };

    createEffect(() =>
    {
        document.documentElement.classList.toggle('dark', resolved() === 'dark');
    }, { name: 'theme-class' });

    createEffect(() =>
    {
        localStorage.setItem(STORAGE_KEY, preference());
    }, { name: 'theme-persist' });

    return {
        preference,
        resolved,
        setPreference
    };
});
