import type { ConfigRow } from '../../src/lib/db/repo';

/**
 * Catalogue fixtures. Every value is deliberately fake: `.invalid` is reserved by RFC 2606
 * and can never resolve, and the UUIDs are nil-pattern. A spec that accidentally logs one
 * of these leaks nothing.
 */
export const row = (id: string, over: Partial<ConfigRow> = {}): ConfigRow => ({
    id,
    name: `Demo ${ id }`,
    protocol: 'vless',
    host: `${ id }.example.invalid`,
    port: 443,
    security: 'tls',
    transport: 'tcp',
    tags: [],
    favorite: false,
    haystack: `demo ${ id }`,
    ...over
});
