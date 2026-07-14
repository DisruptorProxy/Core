import { optional, readFlag, requireHost, requirePort, splitUri } from './uri';
import type { ProxyDraft } from './uri';

/**
 * `tuic://uuid:password@host:port?params#name`. TUIC's userinfo carries two
 * secrets separated by a colon; both are kept in `credential` verbatim, because
 * splitting them here would lose a password that legitimately contains a colon.
 */
export const parseTuic = (uri: string): ProxyDraft =>
{
    const { userinfo, host, port, params, fragment } = splitUri(uri, 'tuic');

    return {
        protocol: 'tuic',
        rawName: fragment,
        host: requireHost(host),
        port: requirePort(port),
        credential: decodeURIComponent(userinfo),
        transport: 'quic',
        security: 'tls',
        sni: optional(params.get('sni')),
        alpn: optional(params.get('alpn')),
        allowInsecure: readFlag(params.get('insecure')) || readFlag(params.get('allow_insecure')),
        rawUri: uri
    };
};
