//! Android VPN backend - the `disruptor-vpn` plugin the frontend invokes.
//!
//! Declared as an INLINE plugin (see build.rs) rather than a separate plugin crate: the
//! Kotlin half already lives in gen/android, so a second gradle project would buy nothing.
//! These three commands are thin forwarders - the real work is in VpnPlugin.kt and
//! TunnelService.kt, which own the VpnService lifecycle.
//!
//! Android is the mirror image of desktop: there, the app elevates a core that creates its
//! own tun device; here, the OS owns the tunnel and hands the fd to Xray, so nothing is
//! elevated and there is no stop-file protocol - stopping is just a message to the service.
//! The core itself is spawned by `android_core`, not from here. See TunnelService.kt.

use serde::{Deserialize, Serialize};
use tauri::plugin::{Builder, PluginHandle, TauriPlugin};
use tauri::{AppHandle, Manager, Runtime};

/// Handle to the Kotlin plugin, registered once during setup and reused by every command.
struct Vpn<R: Runtime>(PluginHandle<R>);

#[derive(Serialize)]
struct StartPayload {
    /// The Xray JSON from `buildMobileConfig`, serialised to a string so the Kotlin side
    /// can take a plain String and write it straight to disk.
    config: String,
}

/// Commands that take no arguments still need a payload to hand the bridge.
#[derive(Serialize)]
struct NoPayload {}

/// Mirrors the desktop `xray_traffic` shape, so the frontend treats both identically.
#[derive(Serialize, Deserialize)]
pub struct Traffic {
    pub uplink: u64,
    pub downlink: u64,
}

#[tauri::command]
async fn start<R: Runtime>(app: AppHandle<R>, config: serde_json::Value) -> Result<(), String> {
    app.state::<Vpn<R>>()
        .0
        .run_mobile_plugin::<serde_json::Value>(
            "start",
            StartPayload {
                config: config.to_string(),
            },
        )
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn stop<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    app.state::<Vpn<R>>()
        .0
        .run_mobile_plugin::<serde_json::Value>("stop", NoPayload {})
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn traffic<R: Runtime>(app: AppHandle<R>) -> Result<Traffic, String> {
    app.state::<Vpn<R>>()
        .0
        .run_mobile_plugin::<Traffic>("traffic", NoPayload {})
        .map_err(|e| e.to_string())
}

/// Registers the plugin under the `disruptor-vpn` namespace the frontend invokes, and
/// binds it to the Kotlin class that does the work.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("disruptor-vpn")
        .invoke_handler(tauri::generate_handler![start, stop, traffic])
        .setup(|app, api| {
            let handle = api.register_android_plugin("io.disruptorproxy.client", "VpnPlugin")?;
            app.manage(Vpn(handle));

            Ok(())
        })
        .build()
}
