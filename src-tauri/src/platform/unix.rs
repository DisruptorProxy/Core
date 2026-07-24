//! Unix proxy-core backend (Linux + macOS).
//!
//! xray needs root for the tun device (`/dev/net/tun` on Linux, `utun` on macOS) and the
//! route table, so the live core is launched **elevated** through a small root shell
//! wrapper. The app itself runs unelevated. This mirrors the Windows backend: the wrapper
//! redirects xray's stdio to files and polls a stop-file so disconnect can kill the root
//! child without a second prompt, and every wait is bounded so nothing hangs.
//!
//! The only per-OS difference is how the wrapper is run as root - `pkexec` (polkit) on
//! Linux, `osascript ... with administrator privileges` on macOS - isolated to
//! `elevate_run` / `elevate_kill` below.

use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::{Child, Command};
use std::time::{Duration, Instant};

use tauri::path::BaseDirectory;
use tauri::Manager;

use super::STOP_TIMEOUT;
use crate::{stop_probe_inner, ProbeXray, XrayProcess};

/// How long to wait for the elevation prompt to be answered before giving up. The user
/// has to approve it and might take a while; bounded so a dialog left open forever cannot
/// hang connect indefinitely.
const AUTH_TIMEOUT: Duration = Duration::from_secs(120);

/// The bundled Xray executable's file name on unix (no extension).
pub fn core_binary_name() -> &'static str {
    "app-xray"
}

/// No console window to suppress on unix.
pub fn hide_console(_cmd: &mut Command) {}

/// No console window to suppress on unix.
pub fn hide_console_tokio(_cmd: &mut tokio::process::Command) {}

/// The physical interface Xray should bind its outbounds to, so the core does not have to
/// detect one itself.
///
/// Linux's own detection can fail seconds AFTER a successful connect: bringing the tun
/// device up emits route/link events, detection re-runs, finds nothing, and the core dies
/// with "no usable outbound interface found" (XTLS/Xray-core#6412). Naming the interface
/// up front skips that path. Best-effort - `None` leaves Xray on `auto`, today's behaviour.
#[cfg(target_os = "linux")]
pub fn default_route_interface() -> Option<String> {
    let output = Command::new("ip")
        .args(["route", "show", "default"])
        .output()
        .ok()?;

    // "default via 192.168.1.1 dev wlan0 proto dhcp metric 600"
    let text = String::from_utf8_lossy(&output.stdout);
    let name = text
        .split_whitespace()
        .skip_while(|word| *word != "dev")
        .nth(1)?;

    (!name.is_empty()).then(|| name.to_string())
}

/// Deliberately nothing on macOS. It is not affected by the Linux re-detection bug, and
/// pinning one interface would stop the tunnel following a network change (Wi-Fi to
/// Ethernet, docking) - a regression traded for no fix. `auto` handles that for us.
#[cfg(target_os = "macos")]
pub fn default_route_interface() -> Option<String> {
    None
}

/// Quotes a value as a bash single-quoted string literal (the `'\''` trick closes the
/// quote, inserts an escaped quote, and reopens - the only character single-quotes cannot
/// contain).
fn sh_literal(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

// ---- Elevation (the only per-OS part) ------------------------------------------------

/// Runs the wrapper script as root, returning the (unelevated) launcher process to track.
/// Like Windows' runas indirection, the returned handle is the launcher, not xray - the
/// wrapper owns and stops the root child.
#[cfg(target_os = "linux")]
fn elevate_run(script: &Path) -> std::io::Result<Child> {
    // pkexec runs bash (found on $PATH) as root, and bash runs the wrapper. Invoking bash
    // explicitly keeps this working under polkit setups that only permit a known interpreter.
    Command::new("pkexec").arg("bash").arg(script).spawn()
}

/// Force-kills every app-xray as root (polkit prompt). Best-effort; the fallback path.
#[cfg(target_os = "linux")]
fn elevate_kill() {
    let _ = Command::new("pkexec")
        .args(["pkill", "-x", "app-xray"])
        .status();
}

/// Quotes a value as an AppleScript string literal.
#[cfg(target_os = "macos")]
fn as_literal(value: &str) -> String {
    format!("\"{}\"", value.replace('\\', "\\\\").replace('"', "\\\""))
}

/// macOS has no pkexec; `osascript`'s `do shell script ... with administrator privileges`
/// shows the native admin prompt and runs the command as root, blocking until it exits -
/// so the osascript process is a faithful stand-in for the launcher handle.
#[cfg(target_os = "macos")]
fn elevate_run(script: &Path) -> std::io::Result<Child> {
    let command = format!("/bin/bash {}", sh_literal(&script.to_string_lossy()));
    let applescript = format!(
        "do shell script {} with administrator privileges",
        as_literal(&command)
    );

    Command::new("osascript").arg("-e").arg(applescript).spawn()
}

#[cfg(target_os = "macos")]
fn elevate_kill() {
    let _ = Command::new("osascript")
        .arg("-e")
        .arg("do shell script \"pkill -x app-xray\" with administrator privileges")
        .status();
}

// ---- Shared lifecycle ----------------------------------------------------------------

/// Files a single elevated xray run uses in place of real stdio pipes and to coordinate a
/// stop with the elevated wrapper - the launcher gives no way to hand the root child real
/// handles or to signal it directly from this unelevated app.
struct RunArtifacts {
    script: PathBuf,
    stdout_log: PathBuf,
    stderr_log: PathBuf,
    pid_file: PathBuf,
    stop_file: PathBuf,
}

impl RunArtifacts {
    fn new(run_dir: &Path) -> Self {
        Self {
            script: run_dir.join("xray-run.sh"),
            stdout_log: run_dir.join("xray-stdout.log"),
            stderr_log: run_dir.join("xray-stderr.log"),
            pid_file: run_dir.join("xray.pid"),
            stop_file: run_dir.join("xray.stop"),
        }
    }

    fn reset(&self) {
        for path in [
            &self.stdout_log,
            &self.stderr_log,
            &self.pid_file,
            &self.stop_file,
        ] {
            let _ = std::fs::remove_file(path);
        }
    }
}

/// Builds the root bash wrapper: it exports XRAY_LOCATION_ASSET (so the core finds the
/// geo `.dat` files in app data), runs xray with stdio redirected to files, writes xray's
/// PID, then polls the stop-file to kill its own child on request. When xray exits on its
/// own, the wrapper re-exits with xray's exit code.
fn build_runner_script(
    xray_path: &Path,
    config_path: &str,
    working_dir: &Path,
    asset_dir: &Path,
    artifacts: &RunArtifacts,
) -> String {
    [
        "#!/usr/bin/env bash".to_string(),
        "set -u".to_string(),
        format!(
            "export XRAY_LOCATION_ASSET={}",
            sh_literal(&asset_dir.to_string_lossy())
        ),
        format!("cd {} || true", sh_literal(&working_dir.to_string_lossy())),
        format!(
            "{} run -c {} > {} 2> {} &",
            sh_literal(&xray_path.to_string_lossy()),
            sh_literal(config_path),
            sh_literal(&artifacts.stdout_log.to_string_lossy()),
            sh_literal(&artifacts.stderr_log.to_string_lossy()),
        ),
        "XPID=$!".to_string(),
        format!(
            "printf '%s' \"$XPID\" > {}",
            sh_literal(&artifacts.pid_file.to_string_lossy())
        ),
        "while kill -0 \"$XPID\" 2>/dev/null; do".to_string(),
        format!(
            "    if [ -e {} ]; then",
            sh_literal(&artifacts.stop_file.to_string_lossy())
        ),
        "        kill \"$XPID\" 2>/dev/null".to_string(),
        format!(
            "        rm -f {}",
            sh_literal(&artifacts.stop_file.to_string_lossy())
        ),
        "        exit 0".to_string(),
        "    fi".to_string(),
        "    sleep 0.15".to_string(),
        "done".to_string(),
        "wait \"$XPID\"".to_string(),
        "exit $?".to_string(),
    ]
    .join("\n")
}

/// The live tunnel core's handle: the (unelevated) launcher process that owns the root
/// wrapper, plus the files used to coordinate its stdio and stop.
pub struct RunningCore {
    runner: Child,
    artifacts: RunArtifacts,
}

/// Waits up to `timeout` for a child to exit; true if it did. std's `Child` has no timed
/// wait, so this polls - giving the same bounded-wait guarantee the Windows handle does.
fn wait_child_timeout(child: &mut Child, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;

    loop {
        match child.try_wait() {
            Ok(Some(_)) => return true,
            Ok(None) => {
                if Instant::now() >= deadline {
                    return false;
                }

                std::thread::sleep(Duration::from_millis(50));
            }
            // Can no longer wait on it (already reaped); treat as gone.
            Err(_) => return true,
        }
    }
}

/// Whether an app-xray process is running, checked without elevation - enumerating by
/// name needs no privilege. `pgrep -x` matches the exact process name (Linux and macOS).
fn is_core_running() -> bool {
    Command::new("pgrep")
        .args(["-x", "app-xray"])
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

/// Force-terminates every app-xray and reports whether none remain. The core runs as
/// root (tun device + routes), so killing it needs root too - an auth prompt. Guarded by
/// `is_core_running`, so the normal path - where the graceful stop worked - never prompts.
pub fn force_kill_core() -> bool {
    if !is_core_running() {
        return true;
    }

    elevate_kill();

    !is_core_running()
}

fn reap_if_exited(process: &mut Option<RunningCore>) {
    if let Some(running) = process {
        if matches!(running.runner.try_wait(), Ok(Some(_))) {
            *process = None;
        }
    }
}

/// Reads whatever the core wrote to its stdout/stderr logs, for surfacing a startup
/// failure to the user.
fn read_logs(artifacts: &RunArtifacts) -> String {
    [
        ("stdout", &artifacts.stdout_log),
        ("stderr", &artifacts.stderr_log),
    ]
    .into_iter()
    .filter_map(|(label, path)| {
        let text = std::fs::read_to_string(path).ok()?;
        let text = text.trim();
        (!text.is_empty()).then(|| format!("{label}:\n{text}"))
    })
    .collect::<Vec<_>>()
    .join("\n\n")
}

/// Makes sure the bundled core can actually be exec'd, before the wrapper tries to.
///
/// The bundler does preserve the executable bit today (verified in the shipped .deb and
/// .app), but that is not guaranteed for every route the binary reaches a user by - and on
/// macOS an unsigned binary still carrying the download's quarantine flag is refused at
/// exec time with no prompt at all, because it is spawned rather than opened, so there is
/// nothing for the user to click. Both failures look identical from the UI: the wrapper
/// starts and xray never does. Idempotent, and costs one stat on the happy path.
fn ensure_core_runnable(xray_path: &Path) -> Result<(), String> {
    let metadata = std::fs::metadata(xray_path)
        .map_err(|e| format!("Bundled core missing at {}: {e}", xray_path.display()))?;

    if (metadata.permissions().mode() & 0o111) == 0 {
        let mut permissions = metadata.permissions();
        permissions.set_mode(0o755);
        std::fs::set_permissions(xray_path, permissions).map_err(|e| {
            format!("The bundled core is not executable and could not be made executable: {e}")
        })?;
    }

    // A normally installed app has no quarantine flag, so this is a no-op there; clearing
    // it is the same thing Finder's right-click -> Open does for the app itself.
    #[cfg(target_os = "macos")]
    {
        let _ = Command::new("xattr")
            .args(["-d", "com.apple.quarantine"])
            .arg(xray_path)
            .status();
    }

    Ok(())
}

/// Launches the live tunnel core elevated, self-healing any orphan first.
pub fn run_core(
    app: &tauri::AppHandle,
    state: &XrayProcess,
    probe: &ProbeXray,
    config_path: &str,
) -> Result<String, String> {
    // A prober left over from a test is pure waste once a tunnel is up (probing reuses
    // the live core), and a second core next to the live one only invites conflicts.
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

    ensure_core_runnable(&xray_path)?;

    let mut process = state
        .0
        .lock()
        .map_err(|e| format!("Failed to lock xray process state: {e}"))?;

    reap_if_exited(&mut process);

    if process.is_some() {
        return Err("xray is already running".to_string());
    }

    // An untracked core can still be alive (a crashed session, or a stop whose wrapper
    // died without taking its child); it holds the tun device and ports. Guarded by
    // `is_core_running`, so an ordinary connect never raises a second auth prompt.
    if is_core_running() {
        force_kill_core();
    }

    let artifacts = RunArtifacts::new(&app_data_dir);
    artifacts.reset();

    let script = build_runner_script(
        &xray_path,
        config_path,
        &resource_dir,
        &app_data_dir,
        &artifacts,
    );

    std::fs::write(&artifacts.script, script)
        .map_err(|e| format!("Failed to write xray runner script: {e}"))?;

    let mut runner = elevate_run(&artifacts.script)
        .map_err(|e| format!("Failed to start xray elevated: {e}. Is the auth agent available?"))?;

    // Unlike Windows' runas, the launcher returns before the prompt is answered - so wait
    // for the wrapper to write xray's PID (approved + core started), or for the launcher
    // to exit (declined / instant failure), whichever comes first.
    let auth_deadline = Instant::now() + AUTH_TIMEOUT;
    let pid: u32;

    loop {
        if let Ok(Some(status)) = runner.try_wait() {
            let logs = read_logs(&artifacts);

            return Err(if logs.is_empty() {
                format!("The proxy core did not start ({status}). Authorization may have been declined.")
            } else {
                format!("The proxy core did not start ({status}):\n{logs}")
            });
        }

        if let Some(p) = std::fs::read_to_string(&artifacts.pid_file)
            .ok()
            .and_then(|s| s.trim().parse().ok())
        {
            pid = p;
            break;
        }

        if Instant::now() >= auth_deadline {
            let _ = runner.kill();

            return Err("Timed out waiting for authorization to start the proxy core.".to_string());
        }

        std::thread::sleep(Duration::from_millis(100));
    }

    *process = Some(RunningCore { runner, artifacts });

    // Give xray a moment to reject a bad config or fail to open the tun device, so a dead
    // process is reported as an error instead of a false "connected".
    std::thread::sleep(Duration::from_millis(600));

    let died = process
        .as_mut()
        .is_some_and(|running| matches!(running.runner.try_wait(), Ok(Some(_))));

    if died {
        let artifacts = process.take().map(|core| core.artifacts);
        let logs = artifacts.as_ref().map(read_logs).unwrap_or_default();

        return Err(if logs.is_empty() {
            "xray exited immediately. The config was likely rejected.".to_string()
        } else {
            format!("xray exited immediately:\n{logs}")
        });
    }

    Ok(format!("Started xray, PID: {pid}"))
}

/// Disconnects, guaranteeing no app-xray is left running. Signals the root wrapper via the
/// stop-file (no second prompt), waits briefly, and force-kills anything that survives.
/// Idempotent: nothing running is success. Verifies rather than assumes, so it never
/// reports "disconnected" while the tunnel is still up.
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
        let _ = std::fs::write(&running.artifacts.stop_file, b"stop");
        stopped = wait_child_timeout(&mut running.runner, STOP_TIMEOUT);
    }

    if (!stopped || is_core_running()) && !force_kill_core() {
        return Err("Could not stop the proxy core - it may still be running.".to_string());
    }

    Ok("Stopped xray".to_string())
}

/// Stops the core on app shutdown: signal the wrapper, wait briefly, force-kill the rest.
/// The core must never outlive the app holding the tun device and the route table.
pub fn stop_core_on_exit(state: &XrayProcess) {
    let running = {
        let Ok(mut process) = state.0.lock() else {
            return;
        };

        reap_if_exited(&mut process);
        process.take()
    };

    if let Some(mut running) = running {
        let _ = std::fs::write(&running.artifacts.stop_file, b"stop");

        if wait_child_timeout(&mut running.runner, STOP_TIMEOUT) {
            return;
        }
    }

    force_kill_core();
}
