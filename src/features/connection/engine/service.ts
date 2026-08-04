import type { ConnectionService } from './port';
import { TauriConnectionService } from './tauri';

/**
 * The one live engine instance. A connection service is stateful (it holds the
 * current status), so there is exactly one, shared by the connection store and the
 * detail sheet's ping. It drives the real app-xray.exe via Tauri; in a plain browser
 * its methods degrade to a clear "desktop only" message rather than crashing.
 */
let active: ConnectionService = new TauriConnectionService();

/**
 * Reads the engine. A FUNCTION rather than the instance itself, because that is the
 * whole seam: with a bare `export const service`, every consumer captured the Tauri
 * implementation at import time and the connect, disconnect and exit-IP paths - the
 * code where being wrong actually costs something - could not be tested at all.
 */
export const engine = (): ConnectionService => active;

/**
 * Swaps the engine. TESTS ONLY: production composes exactly one, right above. This is
 * deliberately not a general plugin point - a second live engine would mean two things
 * believing they own the tunnel.
 */
export const setEngine = (next: ConnectionService): void =>
{
    active = next;
};
