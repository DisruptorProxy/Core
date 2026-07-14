/**
 * Builds a synthetic subscription that looks like the real thing: 8000 servers
 * across every supported protocol, with the noise providers actually ship -
 * emoji-spam names, bandwidth multipliers, the same server repeated under
 * different names, and malformed lines.
 *
 * The duplicates are the point: they are IDENTICAL servers with DIFFERENT names,
 * which is exactly what other clients fail to collapse.
 *
 *   node scripts/make-fixture.mjs [count] > fixtures/subscription.txt
 */

const COUNT = Number.parseInt(process.argv[2] ?? '8000', 10);

const FLAGS = ['🇩🇪', '🇺🇸', '🇳🇱', '🇫🇷', '🇬🇧', '🇯🇵', '🇸🇬', '🇹🇷', '🇦🇪', '🇫🇮'];
const CODES = ['DE', 'US', 'NL', 'FR', 'GB', 'JP', 'SG', 'TR', 'AE', 'FI'];
const TAGS = ['', ' | 2.5x', ' | 1.5x', ' | VIP', ' | IPv6', ' | Game'];
const NOISE = ['🚀', '⚡', '🔥', '✨', ''];

const rng = (seed) => () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const random = rng(42);

const pick = (list) => list[Math.floor(random() * list.length)];
const uuid = (n) => `${ String(n).padStart(8, '0') }-1111-2222-3333-444444444444`;

const name = (i) =>
{
    const country = Math.floor(random() * FLAGS.length);

    return `${ pick(NOISE) }${ FLAGS[country] } ${ CODES[country] }-${ String(i % 99).padStart(2, '0') }${ pick(TAGS) } | @free_configs`;
};

const lines = [];

for (let i = 0; i < COUNT; i++)
{
    const host = `node-${ i % 900 }.example.net`;
    const port = 443 + (i % 7);
    const label = encodeURIComponent(name(i));
    const kind = i % 6;

    if (kind === 0)
    {
        const json = JSON.stringify({
            v: '2', ps: name(i), add: host, port: String(port), id: uuid(i),
            aid: '0', net: 'ws', host, path: '/ws', tls: 'tls', sni: host
        });

        lines.push(`vmess://${ Buffer.from(json, 'utf8').toString('base64') }`);
    }
    else if (kind === 1)
    {
        lines.push(`vless://${ uuid(i) }@${ host }:${ port }?encryption=none&security=reality&sni=${ host }`
            + `&fp=chrome&pbk=aBcD${ i % 50 }&sid=${ (i % 16).toString(16) }&type=grpc`
            + `&serviceName=grpc&flow=xtls-rprx-vision#${ label }`);
    }
    else if (kind === 2)
    {
        lines.push(`trojan://password-${ i }@${ host }:${ port }?security=tls&sni=${ host }&type=tcp#${ label }`);
    }
    else if (kind === 3)
    {
        const credential = Buffer.from(`aes-256-gcm:secret-${ i }`, 'utf8').toString('base64');

        lines.push(`ss://${ credential }@${ host }:${ port }#${ label }`);
    }
    else if (kind === 4)
    {
        lines.push(`hysteria2://auth-${ i }@${ host }:${ port }?sni=${ host }&insecure=1#${ label }`);
    }
    else
    {
        lines.push(`tuic://${ uuid(i) }:pass-${ i }@${ host }:${ port }?sni=${ host }&alpn=h3#${ label }`);
    }

    // Every 10th server is re-listed under a different name - an identical server
    // that a name-based identity would count twice.
    if (i % 10 === 0)
    {
        const previous = lines[lines.length - 1];
        const renamed = previous.replace(/#.*$/, `#${ encodeURIComponent(`🔥 Mirror ${ i } | 3x`) }`);

        lines.push(previous.startsWith('vmess://') ? previous : renamed);
    }
}

// The garbage a real subscription carries: truncated lines, unknown schemes, prose.
lines.push('vmess://not-base64!!!');
lines.push('vless://missing-everything');
lines.push('ssr://legacy-protocol-we-do-not-support');
lines.push('# just a comment');
lines.push('');
lines.push('https://example.com/not-a-config');
lines.push('trojan://user@host-without-port#broken');

// Providers usually serve the whole thing base64-encoded.
const body = lines.join('\n');

process.stdout.write(process.argv.includes('--plain')
    ? body
    : Buffer.from(body, 'utf8').toString('base64'));
