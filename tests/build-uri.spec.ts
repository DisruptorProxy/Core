import { describe, expect, it } from 'vitest';

import { buildUri } from '../src/lib/proxy/build-uri';
import { fingerprint } from '../src/lib/proxy/fingerprint';
import { parseUri } from '../src/lib/proxy/parse';
import type { ProxyConfig } from '../src/lib/proxy/types';
import { ParseFailure } from '../src/lib/proxy/uri';

// The serialiser exists so a hand-built or edited server has a link at all. Its contract
// is the ROUND TRIP: parse(build(c)) must agree with c on every field `fingerprint` hashes,
// because those fields ARE the server's identity. Drop one and the same server silently
// becomes a different one the next time the link is imported.

const configOf = (uri: string): ProxyConfig =>
{
    const parsed = parseUri(uri);

    if (parsed instanceof ParseFailure)
    {
        throw new Error(`fixture did not parse: ${ parsed.message }`);
    }

    return parsed;
};

const URIS: [string, string][] = [
    ['vless tcp+tls', 'vless://00000000-0000-4000-8000-000000000001@a.example.invalid:443?type=tcp&security=tls&sni=a.example.invalid#Demo A'],
    ['vless ws', 'vless://00000000-0000-4000-8000-000000000002@b.example.invalid:8443?type=ws&security=tls&path=%2Fdemo&host=cdn.example.invalid#Demo B'],
    ['vless reality', 'vless://00000000-0000-4000-8000-000000000003@c.example.invalid:2053?type=grpc&security=reality&pbk=demokey&sid=ab12&flow=xtls-rprx-vision&sni=demo.invalid#Demo C'],
    ['trojan', 'trojan://demo-not-a-real-secret@d.example.invalid:443?security=tls&sni=d.example.invalid#Demo D'],
    ['shadowsocks', 'ss://YWVzLTI1Ni1nY206ZGVtby1ub3QtcmVhbA==@e.example.invalid:8388#Demo E'],
    ['hysteria2', 'hysteria2://demo-not-a-real-secret@f.example.invalid:36712?sni=demo.invalid#Demo F'],
    ['tuic', 'tuic://00000000-0000-4000-8000-000000000007@g.example.invalid:443?sni=demo.invalid#Demo G'],
    ['vmess', 'vmess://eyJ2IjoiMiIsInBzIjoiRGVtbyBIIiwiYWRkIjoiaC5leGFtcGxlLmludmFsaWQiLCJwb3J0IjoiNDQzIiwiaWQiOiIwMDAwMDAwMC0wMDAwLTQwMDAtODAwMC0wMDAwMDAwMDAwMDgiLCJhaWQiOiIwIiwibmV0IjoidGNwIiwidGxzIjoidGxzIn0=']
];

describe('buildUri round trip', () =>
{
    it.each(URIS)('%s keeps its identity through build then parse', (_label, uri) =>
    {
        const original = configOf(uri);
        const rebuilt = configOf(buildUri(original));

        // The id IS the hash of every connection-defining field, so one assertion covers
        // host, port, credential, method, transport, security, sni, path, hostHeader,
        // flow, publicKey and shortId at once.
        expect(rebuilt.id).toBe(original.id);
        expect(fingerprint(rebuilt)).toBe(fingerprint(original));
    });

    it.each(URIS)('%s keeps the name the provider gave it', (_label, uri) =>
    {
        const original = configOf(uri);
        const rebuilt = configOf(buildUri(original));

        expect(rebuilt.name).toBe(original.name);
    });

    it('is stable: building twice gives the same link', () =>
    {
        for (const [, uri] of URIS)
        {
            const config = configOf(uri);

            expect(buildUri(config)).toBe(buildUri(config));
        }
    });

    it('survives a name with emoji and non-Latin script', () =>
    {
        const original = configOf('vless://00000000-0000-4000-8000-000000000001@a.example.invalid:443?type=tcp&security=tls#\u{1F1F8}\u{1F1EA} سرور یک');
        const rebuilt = configOf(buildUri(original));

        expect(rebuilt.name).toBe(original.name);
        expect(rebuilt.country).toBe(original.country);
    });

    it('brackets an IPv6 literal, or the port would read as part of the address', () =>
    {
        const original = configOf('vless://00000000-0000-4000-8000-000000000001@[2001:db8::1]:443?type=tcp&security=tls#v6');
        const link = buildUri(original);

        expect(link).toContain('[2001:db8::1]:443');
        expect(configOf(link).host).toBe(original.host);
    });

    it('carries allowInsecure only when it is actually set', () =>
    {
        const safe = configOf('vless://00000000-0000-4000-8000-000000000001@a.example.invalid:443?type=tcp&security=tls#a');
        const insecure = configOf('vless://00000000-0000-4000-8000-000000000001@a.example.invalid:443?type=tcp&security=tls&allowInsecure=1#a');

        expect(buildUri(safe).toLowerCase()).not.toContain('insecure');
        expect(configOf(buildUri(insecure)).allowInsecure).toBe(true);
    });

    it('keeps a shadowsocks obfs plugin, which is part of the identity', () =>
    {
        // Found against a real 490-config subscription: exactly one used obfs, and dropping
        // `?plugin=` changed its fingerprint, so re-importing an exported link would have
        // produced a duplicate that then failed to connect.
        const original = configOf('ss://YWVzLTI1Ni1nY206ZGVtby1ub3QtcmVhbA==@e.example.invalid:8388?plugin=obfs-local%3Bobfs%3Dhttp%3Bobfs-host%3Dexample.invalid#Demo Obfs');

        expect(original.path).toContain('obfs');

        const rebuilt = configOf(buildUri(original));

        expect(rebuilt.path).toBe(original.path);
        expect(rebuilt.id).toBe(original.id);
    });

    it('falls back to the original link for a protocol it cannot express', () =>
    {
        // Better an exotic server exports exactly as it arrived than gets flattened into
        // something that no longer connects.
        const config = { ...configOf(URIS[0][1]), protocol: 'wireguard', rawUri: 'wireguard://original' } as unknown as ProxyConfig;

        expect(buildUri(config)).toBe('wireguard://original');
    });
});
