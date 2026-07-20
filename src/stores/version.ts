import { createSignal, createStore } from 'azerothjs';

import { getVersion } from '@tauri-apps/api/app';
import { relaunch } from '@tauri-apps/plugin-process';
import { check as checkUpdate, type Update } from '@tauri-apps/plugin-updater';

/** Fallback shown in browser dev; the desktop app reads the real version from Tauri. */
const FALLBACK_VERSION = '1.0.0';

const isTauri = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

type CheckState = 'idle' | 'checking' | 'current' | 'available' | 'downloading' | 'error';

/**
 * The app's version and update status, on the real Tauri updater plugin: `check()`
 * asks the endpoint in tauri.conf.json (a `latest.json` published alongside each
 * GitHub release) for a newer, SIGNED build; `install()` downloads and verifies it
 * against the bundled public key, then relaunches into the new version. There is
 * no manual link to click - a browser-dev session (no Tauri) always reports
 * current, since there is nothing to install into.
 */
export const useVersion = createStore(() =>
{
    const [current, setCurrent] = createSignal(FALLBACK_VERSION);
    const [latest, setLatest] = createSignal<string | null>(null);
    const [state, setState] = createSignal<CheckState>('idle');
    const [progress, setProgress] = createSignal<number | null>(null);
    const [error, setError] = createSignal<string | null>(null);

    // The live Update handle from the last successful check - install() acts on it.
    let pending: Update | null = null;

    const loadCurrent = async (): Promise<void> =>
    {
        if (!isTauri())
        {
            return;
        }

        try
        {
            setCurrent(await getVersion());
        }
        catch
        {
            // Keep the fallback - a version read failure must not break Settings.
        }
    };

    const check = async (): Promise<void> =>
    {
        setError(null);
        setState('checking');

        if (!isTauri())
        {
            // Nothing to install into outside the desktop app.
            setState('current');

            return;
        }

        try
        {
            const update = await checkUpdate();

            pending = update;

            if (update === null)
            {
                setState('current');

                return;
            }

            setLatest(update.version);
            setState('available');
        }
        catch (checkError)
        {
            setError(checkError instanceof Error ? checkError.message : 'Could not check for updates');
            setState('error');
        }
    };

    const install = async (): Promise<void> =>
    {
        if (pending === null)
        {
            return;
        }

        setError(null);
        setProgress(null);
        setState('downloading');

        let total = 0;
        let received = 0;

        try
        {
            await pending.downloadAndInstall((event) =>
            {
                if (event.event === 'Started')
                {
                    total = event.data.contentLength ?? 0;
                }
                else if (event.event === 'Progress')
                {
                    received += event.data.chunkLength;
                    setProgress(total > 0 ? Math.round(Math.min(received / total, 1) * 100) : null);
                }
            });

            // The new binary is on disk and verified; relaunch runs it in place of
            // this process, so the user never has to close and reopen by hand.
            await relaunch();
        }
        catch (installError)
        {
            setError(installError instanceof Error ? installError.message : 'Could not install the update');
            setState('error');
        }
    };

    void loadCurrent();

    return {
        current,
        latest,
        state,
        progress,
        error,
        check,
        install
    };
});
