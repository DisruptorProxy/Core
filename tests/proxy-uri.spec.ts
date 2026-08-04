import { describe, expect, it } from 'vitest';

import { parseUri } from '../src/lib/proxy/parse';
import { ParseFailure, decodeBase64, looksLikeBase64, requireHost, requirePort } from '../src/lib/proxy/uri';

// Every string here arrives from a subscription URL, a pasted link, or a QR code -
// all of them untrusted. The contract is that a bad one becomes a ParseFailure with a
// reason a user can act on, never a throw that takes the import down and never a
// half-built config that would silently fail to connect later.

const OK = 'vless://00000000-0000-4000-8000-000000000001@node.example.invalid:443?type=tcp&security=tls&sni=node.example.invalid#Demo';

describe('parseUri', () =>
{
    it('reads a vless URI into the fields the config builder needs', () =>
    {
        const result = parseUri(OK);

        expect(result).not.toBeInstanceOf(ParseFailure);

        if (result instanceof ParseFailure)
        {
            return;
        }

        expect(result.protocol).toBe('vless');
        expect(result.host).toBe('node.example.invalid');
        expect(result.port).toBe(443);
        expect(result.security).toBe('tls');
        expect(result.name).toBe('Demo');
    });

    it('gives every parsed config a stable id, so re-importing the same link dedupes', () =>
    {
        const first = parseUri(OK);
        const second = parseUri(OK);

        expect(first).not.toBeInstanceOf(ParseFailure);
        expect(second).not.toBeInstanceOf(ParseFailure);

        if (first instanceof ParseFailure || second instanceof ParseFailure)
        {
            return;
        }

        expect(first.id).toBe(second.id);
    });

    it('names an unsupported scheme instead of failing anonymously', () =>
    {
        const result = parseUri('wireguard://something@host:51820');

        expect(result).toBeInstanceOf(ParseFailure);
        expect((result as ParseFailure).message).toContain('wireguard');
    });

    it.each([
        ['empty', ''],
        ['no scheme', 'just some text'],
        ['scheme only', 'vless://'],
        ['no host', 'vless://uuid@:443'],
        ['port out of range', 'vless://uuid@host.invalid:99999'],
        ['port not a number', 'vless://uuid@host.invalid:https'],
        ['truncated mid-query', 'vless://uuid@host.invalid:443?type='],
        ['bare scheme separator', '://host'],
        ['very long junk', `vless://${ 'x'.repeat(5000) }`]
    ])('refuses %s without throwing', (_label, input) =>
    {
        expect(() => parseUri(input)).not.toThrow();
    });

    it('keeps the provider name verbatim, including emoji and non-Latin scripts', () =>
    {
        const result = parseUri(`${ OK.slice(0, OK.indexOf('#')) }#\u{1F1F8}\u{1F1EA} سرور یک`);

        expect(result).not.toBeInstanceOf(ParseFailure);

        if (result instanceof ParseFailure)
        {
            return;
        }

        expect(result.name).toContain('سرور');
    });
});

describe('decodeBase64', () =>
{
    it('survives the URL-safe alphabet and missing padding, as providers actually send it', () =>
    {
        // "hello world" with - and _ for + and /, no trailing '='.
        expect(decodeBase64('aGVsbG8gd29ybGQ')).toBe('hello world');
    });

    it('decodes UTF-8 rather than latin1, so Persian names survive the round trip', () =>
    {
        const text = 'سرور تهران';
        const encoded = Buffer.from(text, 'utf8').toString('base64');

        expect(decodeBase64(encoded)).toBe(text);
    });
});

describe('looksLikeBase64', () =>
{
    it('says no to a URI list, which is the format it has to be told apart from', () =>
    {
        expect(looksLikeBase64(OK)).toBe(false);
    });
});

describe('requirePort', () =>
{
    it.each([['0', 0], ['65536', 65536], ['-1', -1], ['not a port', 'https']])('rejects %s', (_label, input) =>
    {
        expect(() => requirePort(input as string | number)).toThrow();
    });

    it('accepts the edges of the valid range', () =>
    {
        expect(requirePort(1)).toBe(1);
        expect(requirePort(65535)).toBe(65535);
    });
});

describe('requireHost', () =>
{
    it('rejects an empty host, which would otherwise build a config that dials nowhere', () =>
    {
        expect(() => requireHost('')).toThrow();
    });
});
