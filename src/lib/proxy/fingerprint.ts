import type { ProxyDraft } from './uri';

/**
 * The identity of a server is WHERE IT SENDS YOUR TRAFFIC and HOW - never what a
 * provider decided to call it.
 *
 * This is the whole reason Disruptor Proxy dedups where other clients do not: the same
 * server appears in six subscriptions under six different names ("🇩🇪 DE-04",
 * "Germany | 2x", "vip-de4"), and any identity that includes the name treats them
 * as six servers. Hashing only the connection-defining fields collapses them to
 * one - and REALITY's public key and short id are connection-defining, so two
 * servers on the same address with different REALITY keys stay distinct.
 */
const canonical = (draft: ProxyDraft): string =>
    [
        draft.protocol,
        draft.host.toLowerCase(),
        draft.port,
        draft.credential,
        draft.method ?? '',
        draft.transport,
        draft.security,
        draft.sni ?? '',
        draft.path ?? '',
        draft.hostHeader ?? '',
        draft.flow ?? '',
        draft.publicKey ?? '',
        draft.shortId ?? ''
    ].join('|');

/**
 * FNV-1a, run twice with different offsets and concatenated into 64 bits.
 *
 * Deliberately not SHA-256: this is an identity for a Map key, not a security
 * boundary, and `crypto.subtle.digest` is async - which would force the whole
 * parse pipeline to become async for 8000 items to gain nothing. At this scale a
 * 64-bit space makes a collision a rounding error away from impossible.
 */
const hash64 = (input: string): string =>
{
    let h1 = 0x811c9dc5;
    let h2 = 0x01000193;

    for (let i = 0; i < input.length; i++)
    {
        const code = input.charCodeAt(i);

        h1 ^= code;
        h1 = Math.imul(h1, 0x01000193);

        h2 ^= code + i;
        h2 = Math.imul(h2, 0x85ebca6b);
    }

    const left = (h1 >>> 0).toString(16).padStart(8, '0');
    const right = (h2 >>> 0).toString(16).padStart(8, '0');

    return left + right;
};

/** The stable content id of a server. Same server, same id - whatever it is called. */
export const fingerprint = (draft: ProxyDraft): string => hash64(canonical(draft));
