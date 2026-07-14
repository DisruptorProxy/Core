import { ParseFailure, decodeBase64, optional, readFlag, readSecurity, readTransport, requireHost, requirePort } from './uri';
import type { ProxyDraft } from './uri';

/**
 * `vmess://` is base64 of a JSON blob - the oldest and messiest of the formats.
 * Fields are typed inconsistently across generations (`port` and `aid` may be
 * number or string, `tls` may be `"tls"`, `"none"` or absent), so every read goes
 * through a coercion rather than trusting the declared type.
 */
interface VmessJson
{
    add?: string;
    port?: string | number;
    id?: string;
    ps?: string;
    net?: string;
    type?: string;
    host?: string;
    path?: string;
    tls?: string;
    sni?: string;
    alpn?: string;
    fp?: string;
    scy?: string;
    allowInsecure?: string | number | boolean;
}

const text = (value: unknown): string | undefined =>
    typeof value === 'string' ? value : (typeof value === 'number' ? String(value) : undefined);

export const parseVmess = (uri: string): ProxyDraft =>
{
    const payload = uri.slice('vmess://'.length);
    const json = decodeBase64(payload);

    let parsed: VmessJson;

    try
    {
        parsed = JSON.parse(json) as VmessJson;
    }
    catch
    {
        throw new ParseFailure('vmess payload is not JSON');
    }

    const security = readSecurity(parsed.tls);

    return {
        protocol: 'vmess',
        rawName: text(parsed.ps) ?? '',
        host: requireHost(text(parsed.add) ?? ''),
        port: requirePort(text(parsed.port) ?? ''),
        credential: text(parsed.id) ?? '',
        transport: readTransport(text(parsed.net)),
        security,
        sni: optional(text(parsed.sni)) ?? optional(text(parsed.host)),
        path: optional(text(parsed.path)),
        hostHeader: optional(text(parsed.host)),
        tlsFingerprint: optional(text(parsed.fp)),
        alpn: optional(text(parsed.alpn)),
        method: optional(text(parsed.scy)),
        allowInsecure: parsed.allowInsecure === true || readFlag(text(parsed.allowInsecure)),
        rawUri: uri
    };
};
