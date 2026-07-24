//! Platform-dispatched proxy-core backend.
//!
//! The live tunnel core needs OS-specific handling - privilege elevation for the TUN
//! adapter, process reaping, and console-window suppression all differ per platform - so
//! that surface lives behind this module and exactly one implementation is compiled in.
//! Everything portable (config writing, the reqwest-based probes/subscription fetch, geo
//! download, the idle prober which needs no elevation) stays in `lib.rs`.
//!
//! Every backend exposes the same surface, called from `lib.rs`:
//!   - `run_core` / `end_core` / `stop_core_on_exit` - the live tunnel's lifecycle.
//!   - `force_kill_core` - reap an orphan core (startup sweep + connect self-heal).
//!   - `core_binary_name` - the bundled Xray executable's file name.
//!   - `hide_console` / `hide_console_tokio` - suppress a child's console window.
//!   - `RunningCore` - the opaque live-core handle stored in `XrayProcess`.

/// How long a graceful stop is given before the core is force-terminated.
///
/// The shared contract every real backend honours: signal the core to stop, wait at
/// most this long, then force-kill whatever survives. So disconnect - and app shutdown -
/// can never hang on a wedged core, and always ends with no core left running. Only the
/// desktop backends (Windows, Linux, macOS) run a real core, so it is scoped to them.
#[cfg(any(windows, target_os = "linux", target_os = "macos"))]
pub const STOP_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(5);

#[cfg(windows)]
mod windows;
#[cfg(windows)]
pub use windows::*;

#[cfg(any(target_os = "linux", target_os = "macos"))]
mod unix;
#[cfg(any(target_os = "linux", target_os = "macos"))]
pub use unix::*;

#[cfg(not(any(windows, target_os = "linux", target_os = "macos")))]
mod unsupported;
#[cfg(not(any(windows, target_os = "linux", target_os = "macos")))]
pub use unsupported::*;
