/**
 * Fetches a subscription body.
 *
 * In the Tauri webview a real provider URL works because the native side is not
 * bound by browser CORS; a plain browser can only reach same-origin URLs. When a
 * real cross-origin fetch is wired later (via the Tauri HTTP path), this is the one
 * function that changes - callers stay the same. Kept dependency-free and behind a
 * single seam for exactly that reason.
 */
export class FetchFailure extends Error
{
    constructor(reason: string)
    {
        super(reason);
        this.name = 'FetchFailure';
    }
}

const isTauri = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export const fetchSubscription = async (url: string, signal?: AbortSignal): Promise<string> =>
{
    // In the desktop app, fetch through Rust (reqwest): it is not bound by the
    // webview's CORS, so real provider URLs that work in v2rayN work here too. The
    // browser fetch below only reaches same-origin URLs and is the dev fallback.
    if (isTauri())
    {
        try
        {
            const { invoke } = await import('@tauri-apps/api/core');

            return await invoke<string>('fetch_subscription', { url });
        }
        catch (error)
        {
            throw new FetchFailure(typeof error === 'string' ? error : 'Could not reach the subscription URL');
        }
    }

    let response: Response;

    try
    {
        response = await fetch(url, { signal, redirect: 'follow' });
    }
    catch (error)
    {
        throw new FetchFailure(error instanceof Error && error.name === 'AbortError'
            ? 'Update cancelled'
            : 'Could not reach the subscription URL');
    }

    if (!response.ok)
    {
        throw new FetchFailure(`The server returned ${ response.status } ${ response.statusText }`.trim());
    }

    return response.text();
};
