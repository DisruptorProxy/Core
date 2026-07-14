import { MockConnectionService } from './mock';
import type { ConnectionService } from './port';

/**
 * The one live engine instance. A connection service is stateful (it holds the
 * current status), so there is exactly one, shared by the connection store and the
 * health/latency pool. Swapping in a real Xray/sing-box service is a one-line
 * change here - nothing else imports the concrete class.
 */
export const service: ConnectionService = new MockConnectionService();
