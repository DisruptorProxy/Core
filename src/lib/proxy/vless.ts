import { optional, readFlag, readSecurity, readTransport, requireHost, requirePort, splitUri } from './uri';
import type { ProxyDraft } from './uri';

/**
 * `vless://uuid@host:port?params#name` - the current default, and the only format
 * that carries REALITY. A REALITY server is identified by its public key and short
 * id as much as by its address, which is why both reach the fingerprint.
 *
 * The gRPC service name arrives as `serviceName`, the WebSocket path as `path`;
 * both are stored in `path`, because to a user they answer the same question.
 */
export const parseVless = (uri: string): ProxyDraft =>
{
    const { userinfo, host, port, params, fragment } = splitUri(uri, 'vless');

    return {
        protocol: 'vless',
        rawName: fragment,
        host: requireHost(host),
        port: requirePort(port),
        credential: decodeURIComponent(userinfo),
        transport: readTransport(params.get('type')),
        security: readSecurity(params.get('security')),
        sni: optional(params.get('sni')) ?? optional(params.get('host')),
        path: optional(params.get('path')) ?? optional(params.get('serviceName')),
        hostHeader: optional(params.get('host')),
        flow: optional(params.get('flow')),
        tlsFingerprint: optional(params.get('fp')),
        publicKey: optional(params.get('pbk')),
        shortId: optional(params.get('sid')),
        alpn: optional(params.get('alpn')),
        allowInsecure: readFlag(params.get('allowInsecure')) || readFlag(params.get('insecure')),
        rawUri: uri
    };
};
