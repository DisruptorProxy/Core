import { createStore } from 'azerothjs';
import { createSignal } from 'azerothjs';
import { invoke } from '@tauri-apps/api/core';

const isTauri = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

const NOT_DESKTOP = 'Geo files can only be updated in the Guardian desktop app.';

/** Presence of xray's geoip.dat / geosite.dat, mirrored from the Rust side. */
interface GeoStatus
{
    geoip: boolean;
    geosite: boolean;
}

export type GeoState = 'idle' | 'updating' | 'ready' | 'error';

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
        setState('updating');

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
    };

    void refresh();

    return {
        geoip,
        geosite,
        state,
        error,
        update,
        refresh
    };
});
