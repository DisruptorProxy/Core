import { optional, readFlag, readSecurity, readTransport, requireHost, requirePort, splitUri } from './uri';
import type { ProxyDraft } from './uri';

/**
 * `trojan://password@host:port?params#name`. Trojan is TLS by definition, so an
 * absent `security` param means TLS here - unlike vless, where absent means none.
 */
export const parseTrojan = (uri: string): ProxyDraft =>
{
    const { userinfo, host, port, params, fragment } = splitUri(uri, 'trojan');

    const declared = params.get('security');
    const security = declared === null ? 'tls' : readSecurity(declared);

    return {
        protocol: 'trojan',
        rawName: fragment,
        host: requireHost(host),
        port: requirePort(port),
        credential: decodeURIComponent(userinfo),
        transport: readTransport(params.get('type')),
        security,
        sni: optional(params.get('sni')) ?? optional(params.get('peer')),
        path: optional(params.get('path')) ?? optional(params.get('serviceName')),
        hostHeader: optional(params.get('host')),
        tlsFingerprint: optional(params.get('fp')),
        alpn: optional(params.get('alpn')),
        allowInsecure: readFlag(params.get('allowInsecure')) || readFlag(params.get('insecure')),
        rawUri: uri
    };
};
