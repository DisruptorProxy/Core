export interface HumanError
{
    /** Plain-language statement of what went wrong. */
    title: string;
    /** What the user can do about it. Empty when there is nothing actionable. */
    fix: string;
}

interface Rule
{
    match: RegExp;
    title: string;
    fix: string;
}

/**
 * Turns a proxy core's raw error into something a human can act on.
 *
 * Cores emit developer strings - "context deadline exceeded", "i/o timeout",
 * "EOF" - which every other client shows verbatim, leaving the user to guess. The
 * fix is not to hide the error but to translate it: what happened, and what to do.
 * Rules are ordered most-specific first; the first match wins.
 */
const RULES: Rule[] =
[
    {
        match: /context deadline exceeded|i\/o timeout|deadline/i,
        title: 'The server did not answer in time',
        fix: 'It is likely offline or blocked from your network. Try another server.'
    },
    {
        match: /connection refused|refused/i,
        title: 'The server refused the connection',
        fix: 'The port may be closed or the server is down. Try another server.'
    },
    {
        match: /no such host|dns|name resolution|lookup/i,
        title: 'The server address could not be resolved',
        fix: 'The address may be wrong, or DNS is being blocked. Check the config or switch DNS.'
    },
    {
        match: /tls|handshake|certificate|x509/i,
        title: 'The secure handshake failed',
        fix: 'The server’s TLS settings may have changed, or the SNI is being filtered.'
    },
    {
        match: /reality|invalid public key|pbk|short id/i,
        title: 'The REALITY handshake was rejected',
        fix: 'The public key or short id no longer matches the server. Update the config.'
    },
    {
        match: /connection reset|reset by peer|EOF|broken pipe/i,
        title: 'The connection was dropped',
        fix: 'The network cut the connection - a sign of active interference. Try another server or protocol.'
    },
    {
        match: /network is unreachable|no route/i,
        title: 'The network is unreachable',
        fix: 'Check that you are online before connecting.'
    }
];

export const humanizeError = (raw: string | undefined): HumanError =>
{
    if (raw === undefined || raw.trim() === '')
    {
        return { title: 'The connection failed', fix: 'Try again, or pick another server.' };
    }

    const rule = RULES.find((candidate) => candidate.match.test(raw));

    if (rule !== undefined)
    {
        return { title: rule.title, fix: rule.fix };
    }

    // Unknown error: still say something useful, and keep the raw text available
    // for the detail view rather than pretending we understood it.
    return { title: 'The connection failed', fix: 'Try another server. Technical detail: ' + raw };
};
