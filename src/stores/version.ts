import { createStore } from 'azerothjs';
import { createSignal } from 'azerothjs';

/** Fallback shown in browser dev; the desktop app reads the real version from Tauri. */
const FALLBACK_VERSION = '1.0.0';

const isTauri = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/** Numeric-dotted semver compare: true when `a` is strictly newer than `b`. */
const isNewer = (a: string, b: string): boolean =>
{
    const pa = a.replace(/^v/, '').split('.').map((n) => Number.parseInt(n, 10) || 0);
    const pb = b.replace(/^v/, '').split('.').map((n) => Number.parseInt(n, 10) || 0);

    for (let i = 0; i < Math.max(pa.length, pb.length); i++)
    {
        const da = pa[i] ?? 0;
        const db = pb[i] ?? 0;

        if (da !== db)
        {
            return da > db;
        }
    }

    return false;
};

export type CheckState = 'idle' | 'checking' | 'current' | 'available' | 'error';

/**
 * The app's version and update status.
 *
 * The current version comes from Tauri in the desktop app; the check fetches an
 * update manifest (`VITE_UPDATE_URL`, a JSON `{ version, url }`) and compares it.
 * Downloading the new build is a link for now - fully automatic install needs the
 * Tauri updater plugin plus code-signing, which is a separate, keyed step.
 */
export const useVersion = createStore(() =>
{
    const [current, setCurrent] = createSignal(FALLBACK_VERSION);
    const [latest, setLatest] = createSignal<string | null>(null);
    const [downloadUrl, setDownloadUrl] = createSignal<string | null>(null);
    const [state, setState] = createSignal<CheckState>('idle');
    const [error, setError] = createSignal<string | null>(null);

    const loadCurrent = async (): Promise<void> =>
    {
        if (!isTauri())
        {
            return;
        }

        try
        {
            const { getVersion } = await import('@tauri-apps/api/app');

            setCurrent(await getVersion());
        }
        catch
        {
            // Keep the fallback - a version read failure must not break Settings.
        }
    };

    const check = async (): Promise<void> =>
    {
        const url = import.meta.env.VITE_UPDATE_URL;

        setError(null);
        setState('checking');

        if (url === undefined || url === '')
        {
            // No update channel configured; report the current build as up to date.
            setState('current');

            return;
        }

        try
        {
            const response = await fetch(url, { cache: 'no-store' });

            if (!response.ok)
            {
                throw new Error(`The update server returned ${ response.status }`);
            }

            const data = await response.json() as { version?: string; url?: string };
            const remote = (data.version ?? '').trim();

            setLatest(remote);
            setDownloadUrl(data.url ?? null);
            setState(remote !== '' && isNewer(remote, current()) ? 'available' : 'current');
        }
        catch (fetchError)
        {
            setError(fetchError instanceof Error ? fetchError.message : 'Could not check for updates');
            setState('error');
        }
    };

    void loadCurrent();

    return {
        current,
        latest,
        downloadUrl,
        state,
        error,
        check
    };
});
