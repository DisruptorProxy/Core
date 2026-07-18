import { TauriConnectionService } from './tauri';
import type { ConnectionService } from './port';

/**
 * The one live engine instance. A connection service is stateful (it holds the
 * current status), so there is exactly one, shared by the connection store and the
 * detail sheet's ping. It drives the real app-xray.exe via Tauri; in a plain browser
 * its methods degrade to a clear "desktop only" message rather than crashing.
 */
export const service: ConnectionService = new TauriConnectionService();
