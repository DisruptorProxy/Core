//! Windows proxy-core backend.
//!
//! xray needs admin rights for the WinTUN adapter and the route table, and the app
//! already has them: `windows/manifest.xml` requests `requireAdministrator`, so the whole
//! process is elevated from launch (one UAC prompt) and everything it spawns inherits
//! that. The core is therefore an ORDINARY CHILD PROCESS here - real handle, real stdio,
//! `kill()` that works - with no elevation machinery of any kind.
//!
//! It did not used to be. The app ran unelevated and elevated only the core, through
//! `ShellExecuteExW`'s "runas" verb; since "runas" cannot redirect a child's stdio, that
//! needed a PowerShell wrapper script written into app data and launched with
//! `-ExecutionPolicy Bypass -WindowStyle Hidden`, which then spawned xray hidden and
//! polled a stop-file so disconnect would not raise a second UAC prompt. All of that
//! existed only to work around not being elevated - and it made release builds look
//! exactly like a dropper to Windows Defender's behavioural classifier, which flagged
//! them as `Trojan:Win32/Bearfoos.B!ml`. Elevating the app deletes the workaround and the
//! false positive together.

use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

use tauri::path::BaseDirectory;
use tauri::Manager;

use super::STOP_TIMEOUT;
use crate::{stop_probe_inner, ProbeXray, XrayProcess};

/// Runs a child without flashing a console window - app-xray.exe is a console app, and
/// the UI should not blink a black window on every connect, ping, or test.
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// How often a bounded wait re-checks whether the core has exited.
const STOP_POLL_INTERVAL: Duration = Duration::from_millis(50);

/// The bundled Xray executable's file name on this platform.
pub fn core_binary_name() -> &'static str {
    "app-xray.exe"
}

/// Nothing to pin: Windows resolves its own outbound interface reliably and is not
/// affected by the unix re-detection bug, so Xray's own `auto` is the right answer here.
pub fn default_route_interface() -> Option<String> {
    None
}

/// Suppresses the console window of a soon-to-spawn child.
pub fn hide_console(cmd: &mut Command) {
    cmd.creation_flags(CREATE_NO_WINDOW);
}

/// Suppresses the console window of a soon-to-spawn tokio child.
pub fn hide_console_tokio(cmd: &mut tokio::process::Command) {
    cmd.creation_flags(CREATE_NO_WINDOW);
}

/// Where a single core run's stdout and stderr are captured.
///
/// Files rather than pipes on purpose: nothing reads them while the core runs, and an
/// unread pipe fills its buffer and then blocks the writer - a core that stalls mid-run
/// the first time it logs enough. They exist to answer one question, "why did the core
/// exit immediately", which is asked after the fact.
struct RunLogs {
    stdout: PathBuf,
    stderr: PathBuf,
}

impl RunLogs {
    fn new(run_dir: &Path) -> Self {
        Self {
            stdout: run_dir.join("xray-stdout.log"),
            stderr: run_dir.join("xray-stderr.log"),
        }
    }

    fn reset(&self) {
        for path in [&self.stdout, &self.stderr] {
            let _ = std::fs::remove_file(path);
        }
    }

    /// Whatever the dead core had to say, formatted for the error the user sees.
    fn collect(&self) -> String {
        [("stdout", &self.stdout), ("stderr", &self.stderr)]
            .into_iter()
            .filter_map(|(label, path)| {
                let text = std::fs::read_to_string(path).ok()?;
                let text = text.trim();
                (!text.is_empty()).then(|| format!("{label}:\n{text}"))
            })
            .collect::<Vec<_>>()
            .join("\n\n")
    }
}

/// The live tunnel core: the xray child itself, plus its captured output.
pub struct RunningCore {
    child: Child,
    logs: RunLogs,
}

impl RunningCore {
    /// Waits up to `timeout` for the core to exit; true if it did.
    ///
    /// Every stop path is bounded by this. An unbounded wait on a wedged core would hang
    /// disconnect forever - and, on shutdown, the whole app - with no way out for the
    /// user. A bounded wait always yields to the force-kill fallback.
    fn wait_timeout(&mut self, timeout: Duration) -> bool {
        let deadline = Instant::now() + timeout;

        loop {
            match self.child.try_wait() {
                Ok(Some(_)) => return true,
                // The handle is unusable; the caller's verify-then-force-kill fallback is
                // what settles it from here.
                Err(_) => return false,
                Ok(None) => {}
            }

            if Instant::now() >= deadline {
                return false;
            }

            std::thread::sleep(STOP_POLL_INTERVAL);
        }
    }

    /// Terminates the core and waits for it to actually go; true if it did.
    fn stop(&mut self, timeout: Duration) -> bool {
        // `kill` errors when the child has already exited - that is the desired end
        // state, and `wait_timeout` reports it accurately either way.
        let _ = self.child.kill();

        self.wait_timeout(timeout)
    }
}

/// Whether an app-xray.exe process is currently running.
fn is_core_running() -> bool {
    Command::new("tasklist")
        .args(["/FI", "IMAGENAME eq app-xray.exe", "/NH"])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map(|out| {
            String::from_utf8_lossy(&out.stdout)
                .to_lowercase()
                .contains("app-xray.exe")
        })
        .unwrap_or(false)
}

/// Force-terminates every app-xray.exe and reports whether none remain.
///
/// The app owns the only core it should ever spawn, so any survivor is an orphan - from a
/// crashed session, or a core that outlived the app that started it. Both this process
/// and the orphan run elevated as the same user, so a plain `taskkill` reaches it; no
/// second UAC prompt is involved anywhere in this path.
pub fn force_kill_core() -> bool {
    if !is_core_running() {
        return true;
    }

    let _ = Command::new("taskkill")
        .args(["/F", "/IM", "app-xray.exe"])
        .creation_flags(CREATE_NO_WINDOW)
        .output();

    !is_core_running()
}

fn reap_if_exited(process: &mut Option<RunningCore>) {
    if let Some(running) = process {
        if matches!(running.child.try_wait(), Ok(Some(_))) {
            *process = None;
        }
    }
}

/// Whether a live core is still running right now.
///
/// The webview can be torn down and rebuilt under a running tunnel - a reload, a renderer
/// crash, devtools - while the tunnel keeps carrying traffic. The frontend therefore
/// cannot assume it starts disconnected; it asks here instead.
pub fn core_running(state: &XrayProcess) -> bool {
    // The tracked handle IS the core now (it used to be the PowerShell wrapper, which
    // could exit while the core it launched kept running - hence the old check by image
    // name), so this is both accurate and specific. Specificity matters: the idle prober
    // is the same app-xray.exe binary, so a check by name reports "connected" during a
    // "test all" on an idle app. Startup force-kills any orphan before the first paint,
    // so within a session the tracked core is the only one there is.
    let Ok(mut process) = state.0.lock() else {
        return false;
    };

    reap_if_exited(&mut process);

    process.is_some()
}

/// Launches the live tunnel core, self-healing any orphan first. Returns a human-readable
/// status string, or an error carrying the core's own stderr when it rejects the config /
/// fails to open the TUN adapter.
pub fn run_core(
    app: &tauri::AppHandle,
    state: &XrayProcess,
    probe: &ProbeXray,
    config_path: &str,
) -> Result<String, String> {
    // A prober left over from a test is pure waste once a tunnel is up (probing reuses
    // the live core), and keeping a second core alive next to the live one only invites
    // the port and process conflicts this app has already been bitten by. Best-effort.
    stop_probe_inner(probe);

    let resource_dir = app
        .path()
        .resolve("assets", BaseDirectory::Resource)
        .map_err(|e| format!("Failed to resolve resource dir: {e}"))?;

    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {e}"))?;

    std::fs::create_dir_all(&app_data_dir)
        .map_err(|e| format!("Failed to create app data dir: {e}"))?;

    let xray_path = resource_dir.join(core_binary_name());

    let mut process = state
        .0
        .lock()
        .map_err(|e| format!("Failed to lock xray process state: {e}"))?;

    reap_if_exited(&mut process);

    if process.is_some() {
        return Err("xray is already running".to_string());
    }

    // We track no core, but one can still be alive: a session that crashed, or a core
    // that outlived the app. It holds the ports and the TUN adapter, so the new core
    // would fail to bind - reap it first.
    if is_core_running() {
        force_kill_core();
    }

    let logs = RunLogs::new(&app_data_dir);
    logs.reset();

    let stdout = std::fs::File::create(&logs.stdout)
        .map_err(|e| format!("Failed to create the core's stdout log: {e}"))?;
    let stderr = std::fs::File::create(&logs.stderr)
        .map_err(|e| format!("Failed to create the core's stderr log: {e}"))?;

    let mut cmd = Command::new(&xray_path);
    cmd.arg("run")
        .arg("-c")
        .arg(config_path)
        .current_dir(&resource_dir)
        // xray resolves geoip.dat/geosite.dat from XRAY_LOCATION_ASSET; they live in app
        // data because the bundle is read-only in an installed build. See `geo_data_dir`.
        .env("XRAY_LOCATION_ASSET", &app_data_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::from(stdout))
        .stderr(Stdio::from(stderr));
    hide_console(&mut cmd);

    // No elevation step: this process is already running as administrator (see
    // `windows/manifest.xml`), and a child inherits that, so the core can open the WinTUN
    // adapter and rewrite the route table straight away.
    let child = cmd
        .spawn()
        .map_err(|e| format!("Failed to start the core at {xray_path:?}: {e}"))?;

    let pid = child.id();

    *process = Some(RunningCore { child, logs });

    // Give xray a moment to reject a bad config or fail to open the TUN adapter, so a
    // dead process is reported as an error instead of a false "connected".
    std::thread::sleep(Duration::from_millis(600));

    if let Some(running) = process.as_mut() {
        if let Ok(Some(status)) = running.child.try_wait() {
            let logs = process.take().unwrap().logs;
            let output = logs.collect();
            let code = status.code().unwrap_or(-1);

            return Err(if output.is_empty() {
                format!(
                    "xray exited immediately (exit code {code}). The config was likely rejected."
                )
            } else {
                format!("xray exited immediately (exit code {code}):\n{output}")
            });
        }
    }

    Ok(format!("Started xray, PID: {pid}"))
}

/// Disconnects, and guarantees the end state the user actually asked for: no
/// app-xray.exe left running.
///
/// Two deliberate choices here:
///  - It is IDEMPOTENT. "Nothing was running" is success, not an error - disconnecting an
///    already-stopped tunnel is the desired state, and reporting failure only made the UI
///    show a scary error for a no-op.
///  - It verifies rather than assumes. A core can survive a session this app never
///    tracked; reporting "disconnected" while the tunnel is still up would leave the
///    user's traffic proxied without them knowing.
pub fn end_core(state: &XrayProcess) -> Result<String, String> {
    let running = {
        let mut process = state
            .0
            .lock()
            .map_err(|e| format!("Failed to lock xray process state: {e}"))?;

        reap_if_exited(&mut process);
        process.take()
    };

    let mut stopped = true;

    if let Some(mut running) = running {
        stopped = running.stop(STOP_TIMEOUT);
    }

    if (!stopped || is_core_running()) && !force_kill_core() {
        return Err("Could not stop the proxy core - it may still be running.".to_string());
    }

    Ok("Stopped xray".to_string())
}

/// Stops the running xray on app shutdown. The core must never outlive Disruptor Proxy
/// holding the TUN adapter and the system route table - that would leave the machine
/// tunnelling through a proxy no running app owns any more.
pub fn stop_core_on_exit(state: &XrayProcess) {
    // The lock is released before any waiting: holding it across a multi-second stop
    // would block every other command that touches this state.
    let running = {
        let Ok(mut process) = state.0.lock() else {
            return;
        };

        reap_if_exited(&mut process);
        process.take()
    };

    if let Some(mut running) = running {
        if running.stop(STOP_TIMEOUT) {
            return;
        }
    }

    force_kill_core();
}
