/**
 * Fetches a subscription body.
 *
 * In the Tauri webview a real provider URL works because the native side is not
 * bound by browser CORS; a plain browser can only reach same-origin URLs (which
 * is how the dev fixture at /__fixture is exercised). When a real cross-origin
 * fetch is wired later, this is the one function that changes - callers stay the
 * same. Kept dependency-free and behind a single seam for exactly that reason.
 */
export class FetchFailure extends Error
{
    constructor(reason: string)
    {
        super(reason);
        this.name = 'FetchFailure';
    }
}

export const fetchSubscription = async (url: string, signal?: AbortSignal): Promise<string> =>
{
    let response: Response;

    try
    {
        response = await fetch(url, {
            signal,
            redirect: 'follow',
            // Providers key on the client name; a generic one avoids being served a
            // deliberately broken payload meant for a browser.
            headers: { 'User-Agent': 'Guardian' }
        });
    }
    catch (error)
    {
        // A DNS failure, a blocked host, or CORS all surface here indistinguishably
        // in the browser - so the message stays about what the user can act on.
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
