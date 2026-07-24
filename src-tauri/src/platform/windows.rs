//! Windows proxy-core backend.
//!
//! xray needs admin rights for the WinTUN adapter and the route table, so the live core
//! is launched **elevated** via `ShellExecuteExW`'s "runas" verb through a small elevated
//! PowerShell wrapper (runas cannot redirect a child's stdio, so the wrapper captures it
//! and owns the stop). The app itself runs unelevated.

use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

use tauri::path::BaseDirectory;
use tauri::Manager;

use windows::core::PCWSTR;
use windows::Win32::Foundation::{CloseHandle, HANDLE};
use windows::Win32::System::Threading::{GetExitCodeProcess, GetProcessId, WaitForSingleObject};
use windows::Win32::UI::Shell::{
    ShellExecuteExW, SEE_MASK_FLAG_NO_UI, SEE_MASK_NOCLOSEPROCESS, SEE_MASK_NO_CONSOLE,
    SHELLEXECUTEINFOW,
};
use windows::Win32::UI::WindowsAndMessaging::SW_HIDE;

use super::STOP_TIMEOUT;
use crate::{stop_probe_inner, ProbeXray, XrayProcess};

/// Runs a child without flashing a console window - app-xray.exe is a console app, and
/// the UI should not blink a black window on every connect, ping, or test.
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// GetExitCodeProcess's value for "this process has not exited yet".
const STILL_ACTIVE: u32 = 259;

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

/// A process started elevated via `ShellExecuteExW`'s "runas" verb.
///
/// `std::process::Command` has no way to request UAC elevation for a single child
/// process, so xray (which needs admin rights for the WinTUN adapter and route
/// table) is launched through the shell instead and tracked by its raw HANDLE.
/// The handle already carries the access rights granted when the elevation broker
/// created it, so this app can wait on and terminate the elevated child even
/// though the app itself runs as a normal user.
struct ElevatedProcess {
    handle: HANDLE,
}

unsafe impl Send for ElevatedProcess {}
unsafe impl Sync for ElevatedProcess {}

impl ElevatedProcess {
    fn id(&self) -> u32 {
        unsafe { GetProcessId(self.handle) }
    }

    /// Returns the exit code if the process has already exited.
    fn try_wait(&self) -> Option<u32> {
        let mut exit_code = 0u32;

        unsafe { GetExitCodeProcess(self.handle, &mut exit_code) }.ok()?;

        (exit_code != STILL_ACTIVE).then_some(exit_code)
    }

    /// Waits up to `timeout` for the process to exit; true if it did.
    ///
    /// Every stop path is bounded by this. An unbounded wait on a wrapper that never
    /// exits would hang disconnect forever - and, on shutdown, the whole app - with no
    /// way out for the user. A bounded wait always yields to the force-kill fallback.
    fn wait_timeout(&self, timeout: Duration) -> bool {
        unsafe {
            let _ = WaitForSingleObject(self.handle, timeout.as_millis() as u32);
        }

        self.try_wait().is_some()
    }
}

impl Drop for ElevatedProcess {
    fn drop(&mut self) {
        unsafe {
            let _ = CloseHandle(self.handle);
        }
    }
}

fn to_wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}

/// Quotes an argument for a Win32 command line if it contains whitespace.
fn quote_arg(value: &str) -> String {
    if value.chars().any(char::is_whitespace) {
        format!("\"{}\"", value.replace('"', "\\\""))
    } else {
        value.to_string()
    }
}

fn build_command_line(args: &[&str]) -> String {
    args.iter()
        .map(|arg| quote_arg(arg))
        .collect::<Vec<_>>()
        .join(" ")
}

/// Quotes a value as a PowerShell single-quoted string literal.
fn ps_literal(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

/// Launches `exe` elevated (UAC "runas" prompt) via `ShellExecuteExW`, without
/// spawning a visible console window.
fn spawn_elevated(
    exe: &Path,
    args: &[&str],
    working_dir: &Path,
) -> windows::core::Result<ElevatedProcess> {
    let verb = to_wide("runas");
    let file = to_wide(&exe.to_string_lossy());
    let params = to_wide(&build_command_line(args));
    let dir = to_wide(&working_dir.to_string_lossy());

    let mut info = SHELLEXECUTEINFOW {
        cbSize: std::mem::size_of::<SHELLEXECUTEINFOW>() as u32,
        fMask: SEE_MASK_NOCLOSEPROCESS | SEE_MASK_NO_CONSOLE | SEE_MASK_FLAG_NO_UI,
        lpVerb: PCWSTR(verb.as_ptr()),
        lpFile: PCWSTR(file.as_ptr()),
        lpParameters: PCWSTR(params.as_ptr()),
        lpDirectory: PCWSTR(dir.as_ptr()),
        nShow: SW_HIDE.0,
        ..Default::default()
    };

    unsafe { ShellExecuteExW(&mut info) }?;

    Ok(ElevatedProcess {
        handle: info.hProcess,
    })
}

/// Files a single xray run uses in place of real stdio pipes and to coordinate a
/// stop request with the elevated wrapper script - `ShellExecuteExW` gives no way
/// to hand a `runas`-elevated child real handles for either.
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
            script: run_dir.join("xray-run.ps1"),
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

/// Builds a PowerShell script that runs xray with real stdio redirected to files
/// (`ShellExecuteExW` cannot redirect a child's handles itself) and then polls for
/// `artifacts.stop_file` so this app can stop xray later without a second UAC
/// prompt: the script is already elevated, so it can kill its own child directly.
/// When xray exits on its own, the script re-exits with xray's own exit code.
fn build_runner_script(
    xray_path: &Path,
    xray_args: &str,
    working_dir: &Path,
    asset_dir: &Path,
    artifacts: &RunArtifacts,
) -> String {
    [
        "$ErrorActionPreference = 'Stop'".to_string(),
        // xray resolves geoip.dat/geosite.dat from XRAY_LOCATION_ASSET; Start-Process
        // inherits this session's environment, so the elevated core reads geo files
        // from app data - they cannot live in the read-only bundle. See `geo_data_dir`.
        format!(
            "$env:XRAY_LOCATION_ASSET = {}",
            ps_literal(&asset_dir.to_string_lossy())
        ),
        format!(
            "$proc = Start-Process -FilePath {} -ArgumentList {} -WorkingDirectory {} -RedirectStandardOutput {} -RedirectStandardError {} -WindowStyle Hidden -PassThru",
            ps_literal(&xray_path.to_string_lossy()),
            ps_literal(xray_args),
            ps_literal(&working_dir.to_string_lossy()),
            ps_literal(&artifacts.stdout_log.to_string_lossy()),
            ps_literal(&artifacts.stderr_log.to_string_lossy()),
        ),
        format!(
            "Set-Content -LiteralPath {} -Value $proc.Id -NoNewline -Encoding ascii",
            ps_literal(&artifacts.pid_file.to_string_lossy())
        ),
        "while (-not $proc.HasExited) {".to_string(),
        format!("    if (Test-Path -LiteralPath {}) {{", ps_literal(&artifacts.stop_file.to_string_lossy())),
        "        try { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue } catch {}".to_string(),
        format!("        Remove-Item -LiteralPath {} -ErrorAction SilentlyContinue", ps_literal(&artifacts.stop_file.to_string_lossy())),
        "        exit 0".to_string(),
        "    }".to_string(),
        "    Start-Sleep -Milliseconds 150".to_string(),
        "}".to_string(),
        "exit $proc.ExitCode".to_string(),
    ]
    .join("\n")
}

/// The live tunnel core's handle: the elevated PowerShell wrapper that owns xray, plus
/// the files used to coordinate its stdio and stop.
pub struct RunningCore {
    runner: ElevatedProcess,
    artifacts: RunArtifacts,
}

/// Whether an app-xray.exe process is currently running, checked without needing
/// elevation - enumerating processes by name doesn't require admin rights, only
/// touching one that belongs to another user/elevation level does.
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
/// The app owns the only core it should ever spawn, so any survivor is an orphan - from
/// a crashed session, or a wrapper that died without taking its child. This app runs
/// unelevated while the core runs elevated (for the TUN adapter), so killing it needs
/// its own "runas", hence a UAC prompt. `is_core_running` guards every call, so the
/// normal path - where the graceful stop worked - never prompts.
pub fn force_kill_core() -> bool {
    if !is_core_running() {
        return true;
    }

    if let Ok(taskkill) = spawn_elevated(
        Path::new("taskkill.exe"),
        &["/F", "/IM", "app-xray.exe"],
        Path::new("."),
    ) {
        taskkill.wait_timeout(STOP_TIMEOUT);
    }

    !is_core_running()
}

fn reap_if_exited(process: &mut Option<RunningCore>) {
    if let Some(running) = process {
        if running.runner.try_wait().is_some() {
            *process = None;
        }
    }
}

/// Launches the live tunnel core elevated, self-healing any orphan first. Returns a
/// human-readable status string, or an error carrying the core's own stderr when it
/// rejects the config / fails to open the TUN adapter.
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

    // We track no core, but one can still be alive: a session that crashed, or a stop
    // whose wrapper died without taking its child. It holds the ports and the TUN
    // adapter, so the new core would fail to bind - reap it first. Guarded by
    // `is_core_running`, so an ordinary connect never raises a second UAC prompt.
    if is_core_running() {
        force_kill_core();
    }

    let artifacts = RunArtifacts::new(&app_data_dir);
    artifacts.reset();

    let xray_args = build_command_line(&["run", "-c", config_path]);
    let script = build_runner_script(
        &xray_path,
        &xray_args,
        &resource_dir,
        &app_data_dir,
        &artifacts,
    );

    std::fs::write(&artifacts.script, script)
        .map_err(|e| format!("Failed to write xray runner script: {e}"))?;

    let script_path = artifacts.script.to_string_lossy().into_owned();

    // xray needs admin rights here for the WinTUN adapter and route table, so it is
    // launched elevated on its own rather than requiring the whole app to run as
    // administrator. This shows a UAC prompt at connect time. It runs through a
    // small elevated PowerShell wrapper rather than being launched directly:
    // `ShellExecuteExW`'s "runas" verb has no way to redirect a child's stdio, so
    // the wrapper captures xray's real stdout/stderr to files itself.
    let runner = spawn_elevated(
        Path::new("powershell.exe"),
        &[
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-WindowStyle",
            "Hidden",
            "-File",
            &script_path,
        ],
        &resource_dir,
    )
    .map_err(|e| format!("Failed to start xray elevated: {e}"))?;

    // The wrapper writes xray's real PID almost immediately after it starts; wait
    // briefly for it purely to report an accurate PID below.
    let mut pid = runner.id();

    for _ in 0..20 {
        if let Some(real_pid) = std::fs::read_to_string(&artifacts.pid_file)
            .ok()
            .and_then(|s| s.trim().parse().ok())
        {
            pid = real_pid;
            break;
        }

        std::thread::sleep(Duration::from_millis(50));
    }

    *process = Some(RunningCore { runner, artifacts });

    // Give xray a moment to reject a bad config or fail to open the TUN adapter, so
    // a dead process is reported as an error instead of a false "connected".
    std::thread::sleep(Duration::from_millis(600));

    if let Some(running) = process.as_ref() {
        if let Some(exit_code) = running.runner.try_wait() {
            let artifacts = process.take().unwrap().artifacts;

            let output = [
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
            .join("\n\n");

            return Err(if output.is_empty() {
                format!("xray exited immediately (exit code {exit_code}). The config was likely rejected.")
            } else {
                format!("xray exited immediately (exit code {exit_code}):\n{output}")
            });
        }
    }

    Ok(format!("Started xray, PID: {pid}"))
}

/// Disconnects, and guarantees the end state the user actually asked for: no
/// app-xray.exe left running.
///
/// The graceful path signals the already-elevated wrapper to kill its child (the runner
/// handle is the wrapper, not xray, so this app cannot terminate the core directly
/// without its own elevation) and waits briefly. Anything that survives is force-killed.
///
/// Two deliberate choices here:
///  - It is IDEMPOTENT. "Nothing was running" is success, not an error - disconnecting
///    an already-stopped tunnel is the desired state, and reporting failure only made
///    the UI show a scary error for a no-op.
///  - It verifies rather than assumes. A core can outlive the wrapper that owned it, or
///    survive a session this app never tracked; reporting "disconnected" while the
///    tunnel is still up would leave the user's traffic proxied without them knowing.
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

    if let Some(running) = running {
        let _ = std::fs::write(&running.artifacts.stop_file, b"stop");
        stopped = running.runner.wait_timeout(STOP_TIMEOUT);
    }

    // Whether the wrapper obliged or there was nothing tracked at all, the core must be
    // gone before this reports success.
    if (!stopped || is_core_running()) && !force_kill_core() {
        return Err("Could not stop the proxy core - it may still be running.".to_string());
    }

    Ok("Stopped xray".to_string())
}

/// Stops the running xray on app shutdown: signal the already-elevated wrapper (no new
/// UAC prompt), wait briefly, and force-kill anything that survives. The core must never
/// outlive The Disruptor Proxy holding the TUN adapter and the system route table - that
/// would leave the machine tunnelling through a proxy no running app owns any more.
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

    if let Some(running) = running {
        let _ = std::fs::write(&running.artifacts.stop_file, b"stop");

        if running.runner.wait_timeout(STOP_TIMEOUT) {
            return;
        }
    }

    force_kill_core();
}
