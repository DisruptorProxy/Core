import { ParseFailure, decodeBase64, optional, readFragment, requireHost, requirePort, splitUri } from './uri';
import type { ProxyDraft } from './uri';

/**
 * Shadowsocks ships in two incompatible shapes and both are still in circulation:
 *
 *   SIP002  ss://base64(method:password)@host:port?plugin=...#name
 *   legacy  ss://base64(method:password@host:port)#name
 *
 * They are told apart by whether an `@` survives outside the base64. Getting this
 * wrong silently produces a server with a garbage host, so the legacy form is
 * decoded first and only then split.
 */
export const parseShadowsocks = (uri: string): ProxyDraft =>
{
    const withoutFragment = uri.split('#')[0];

    return withoutFragment.includes('@') ? parseSip002(uri) : parseLegacy(uri);
};

const splitCredential = (decoded: string): { method: string; password: string } =>
{
    const colon = decoded.indexOf(':');

    if (colon === -1)
    {
        throw new ParseFailure('Shadowsocks credential is not "method:password"');
    }

    return {
        method: decoded.slice(0, colon),
        // Passwords may contain colons; only the first one separates.
        password: decoded.slice(colon + 1)
    };
};

const parseSip002 = (uri: string): ProxyDraft =>
{
    const { userinfo, host, port, params, fragment } = splitUri(uri, 'ss');

    // Userinfo is usually base64, but some providers percent-encode it in the clear.
    const decoded = userinfo.includes(':') ? decodeURIComponent(userinfo) : decodeBase64(userinfo);
    const { method, password } = splitCredential(decoded);

    return {
        protocol: 'shadowsocks',
        rawName: fragment,
        host: requireHost(host),
        port: requirePort(port),
        credential: password,
        method,
        transport: 'tcp',
        security: 'none',
        path: optional(params.get('plugin')),
        allowInsecure: false,
        rawUri: uri
    };
};

const parseLegacy = (uri: string): ProxyDraft =>
{
    const payload = uri.slice('ss://'.length).split('#')[0].split('?')[0];
    const decoded = decodeBase64(payload);

    const at = decoded.lastIndexOf('@');

    if (at === -1)
    {
        throw new ParseFailure('Shadowsocks payload has no server address');
    }

    const { method, password } = splitCredential(decoded.slice(0, at));
    const hostPort = decoded.slice(at + 1);
    const colon = hostPort.lastIndexOf(':');

    if (colon === -1)
    {
        throw new ParseFailure('No port');
    }

    return {
        protocol: 'shadowsocks',
        rawName: readFragment(uri),
        host: requireHost(hostPort.slice(0, colon)),
        port: requirePort(hostPort.slice(colon + 1)),
        credential: password,
        method,
        transport: 'tcp',
        security: 'none',
        allowInsecure: false,
        rawUri: uri
    };
};
