//! Fallback proxy-core backend for targets without a real implementation yet.
//!
//! The crate must compile on every target the moment the Windows code moved behind
//! `#[cfg(windows)]`, so this provides the same surface with honest "not yet supported"
//! behaviour. Phase 1 replaces this on Linux with a real `pkexec`-based backend; macOS
//! and mobile follow. The portable commands in `lib.rs` (probes, subscription fetch, geo
//! download) work here already - only the live tunnel is stubbed.

use crate::{ProbeXray, XrayProcess};

/// Placeholder live-core handle. No core is ever started on these targets yet, so one is
/// never constructed - `XrayProcess` just holds `None`.
#[allow(dead_code)]
pub struct RunningCore;

/// The bundled Xray executable's file name on non-Windows targets (no `.exe`).
pub fn core_binary_name() -> &'static str {
    "app-xray"
}

/// No console window to suppress off Windows.
pub fn hide_console(_cmd: &mut std::process::Command) {}

/// No console window to suppress off Windows.
pub fn hide_console_tokio(_cmd: &mut tokio::process::Command) {}

/// Nothing to reap - no live core backend exists on this target yet.
pub fn force_kill_core() -> bool {
    true
}

pub fn run_core(
    _app: &tauri::AppHandle,
    _state: &XrayProcess,
    _probe: &ProbeXray,
    _config_path: &str,
) -> Result<String, String> {
    Err("Connecting is not supported on this platform yet.".to_string())
}

pub fn end_core(_state: &XrayProcess) -> Result<String, String> {
    // Idempotent, like the real backends: nothing running is success.
    Ok("Stopped xray".to_string())
}

pub fn stop_core_on_exit(_state: &XrayProcess) {}
