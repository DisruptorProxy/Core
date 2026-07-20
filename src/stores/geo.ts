import { createSignal, createStore } from 'azerothjs';

import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

const isTauri = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

const NOT_DESKTOP = 'Geo files can only be updated in the Guardian desktop app.';

/** Presence of xray's geoip.dat / geosite.dat, mirrored from the Rust side. */
interface GeoStatus
{
    geoip: boolean;
    geosite: boolean;
}

type GeoState = 'idle' | 'updating' | 'ready' | 'error';

/** One chunk of a geo download, emitted by the Rust side as `geo-progress`. */
interface GeoProgressEvent
{
    file: string;
    received: number;
    total: number;
}

/** The two files download sequentially in this order; the overall bar spans both. */
const DOWNLOAD_ORDER = ['geoip.dat', 'geosite.dat'];

/**
 * The geo databases xray uses for `geoip:`/`geosite:` routing rules.
 *
 * They are downloaded on demand next to xray.exe (too large and too fast-moving to
 * bundle), so this store tracks whether each file is present and drives the manual
 * "update" from Settings. `refresh` reads the current on-disk state; `update`
 * pulls the latest builds and re-reads it. The connect path reads the same status
 * from Rust directly, so an out-of-date signal here can never route around a
 * missing file.
 */
export const useGeo = createStore(() =>
{
    const [geoip, setGeoip] = createSignal(false);
    const [geosite, setGeosite] = createSignal(false);
    const [state, setState] = createSignal<GeoState>('idle');
    const [error, setError] = createSignal<string | null>(null);

    // Overall download percentage across BOTH sequential files (geoip spans 0-50,
    // geosite 50-100); null while updating means the server sent no size to
    // measure against, so the bar shows indeterminate instead of a fake number.
    const [progress, setProgress] = createSignal<number | null>(null);

    const apply = (status: GeoStatus): void =>
    {
        setGeoip(status.geoip);
        setGeosite(status.geosite);
    };

    const refresh = async (): Promise<void> =>
    {
        if (!isTauri())
        {
            return;
        }

        try
        {
            apply(await invoke<GeoStatus>('geo_files_status'));
        }
        catch
        {
            // A status read failure must not break Settings; leave the flags as-is.
        }
    };

    const update = async (): Promise<void> =>
    {
        if (!isTauri())
        {
            setError(NOT_DESKTOP);
            setState('error');

            return;
        }

        setError(null);
        setProgress(null);
        setState('updating');

        const unlisten = await listen<GeoProgressEvent>('geo-progress', (event) =>
        {
            const { file, received, total } = event.payload;
            const index = DOWNLOAD_ORDER.indexOf(file);

            if (index === -1 || total === 0)
            {
                return;
            }

            const fraction = Math.min(received / total, 1);

            setProgress(Math.round(((index + fraction) / DOWNLOAD_ORDER.length) * 100));
        });

        try
        {
            apply(await invoke<GeoStatus>('update_geo_files'));
            setState('ready');
        }
        catch (updateError)
        {
            setError(typeof updateError === 'string' ? updateError : 'Could not update the geo files');
            setState('error');
        }
        finally
        {
            unlisten();
            setProgress(null);
        }
    };

    void refresh();

    return {
        geoip,
        geosite,
        state,
        error,
        progress,
        update,
        refresh
    };
});
