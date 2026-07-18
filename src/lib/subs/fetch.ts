import { invoke } from '@tauri-apps/api/core';

/**
 * Fetches a subscription body.
 *
 * In the Tauri webview a real provider URL works because the native side is not
 * bound by browser CORS; a plain browser can only reach same-origin URLs. When a
 * real cross-origin fetch is wired later (via the Tauri HTTP path), this is the one
 * function that changes - callers stay the same. Kept dependency-free and behind a
 * single seam for exactly that reason.
 */
class FetchFailure extends Error
{
    constructor(reason: string)
    {
        super(reason);
        this.name = 'FetchFailure';
    }
}

interface SubscriptionFetch
{
    /** The raw subscription body (base64 list or config links). */
    body: string;
    /** The `Subscription-Userinfo` header verbatim, or null when the provider omits it. */
    userinfo: string | null;
}

const isTauri = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export const fetchSubscription = async (url: string, signal?: AbortSignal): Promise<SubscriptionFetch> =>
{
    // In the desktop app, fetch through Rust (reqwest): it is not bound by the
    // webview's CORS, so real provider URLs that work in v2rayN work here too. It
    // also returns the `Subscription-Userinfo` header, which a CORS'd browser fetch
    // cannot read. The browser path below is the same-origin dev fallback.
    if (isTauri())
    {
        try
        {
            return await invoke<SubscriptionFetch>('fetch_subscription', { url });
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

    return { body: await response.text(), userinfo: response.headers.get('subscription-userinfo') };
};
