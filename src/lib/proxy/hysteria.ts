import { optional, readFlag, requireHost, requirePort, splitUri } from './uri';
import type { ProxyDraft } from './uri';

/**
 * `hysteria2://auth@host:port?sni=&insecure=1#name` (also written `hy2://`).
 * Hysteria runs over QUIC and is always TLS - there is no cleartext mode - so the
 * transport and security are facts of the protocol rather than parameters.
 */
export const parseHysteria2 = (uri: string): ProxyDraft =>
{
    const scheme = uri.startsWith('hy2://') ? 'hy2' : 'hysteria2';
    const { userinfo, host, port, params, fragment } = splitUri(uri, scheme);

    return {
        protocol: 'hysteria2',
        rawName: fragment,
        host: requireHost(host),
        port: requirePort(port),
        credential: decodeURIComponent(userinfo),
        transport: 'quic',
        security: 'tls',
        sni: optional(params.get('sni')) ?? optional(params.get('peer')),
        alpn: optional(params.get('alpn')),
        allowInsecure: readFlag(params.get('insecure')) || readFlag(params.get('allowInsecure')),
        rawUri: uri
    };
};
