use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::path::BaseDirectory;
use tauri::Emitter;
use tauri::Manager;
use tauri::State;

use windows::core::PCWSTR;
use windows::Win32::Foundation::{CloseHandle, HANDLE};
use windows::Win32::System::Threading::{GetExitCodeProcess, GetProcessId, WaitForSingleObject};
use windows::Win32::UI::Shell::{
    ShellExecuteExW, SEE_MASK_FLAG_NO_UI, SEE_MASK_NOCLOSEPROCESS, SEE_MASK_NO_CONSOLE,
    SHELLEXECUTEINFOW,
};
use windows::Win32::UI::WindowsAndMessaging::SW_HIDE;

/// Runs a child without flashing a console window - app-xray.exe is a console app, and
/// the UI should not blink a black window on every connect, ping, or test.
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Geo database sources. Xray resolves `geoip:`/`geosite:` routing rules against
/// these `.dat` files; they ship out-of-band (too large and too fast-moving to
/// bundle) and are downloaded into app data on demand (see `geo_data_dir`).
const GEOIP_URL: &str =
    "https://github.com/Loyalsoldier/v2ray-rules-dat/releases/latest/download/geoip.dat";
const GEOSITE_URL: &str =
    "https://github.com/Loyalsoldier/v2ray-rules-dat/releases/latest/download/geosite.dat";

/// GetExitCodeProcess's value for "this process has not exited yet".
const STILL_ACTIVE: u32 = 259;

/// How long a graceful stop is given before the core is force-terminated. Generous
/// enough for the wrapper's 150ms poll to notice the stop file and kill its child,
/// short enough that a wedged wrapper never leaves the user staring at "Disconnecting".
const STOP_TIMEOUT: Duration = Duration::from_secs(5);

/// The fixed probe-account password (the frontend's `PROBE_PASS`). The probe inbound
/// is loopback-only, so the value is irrelevant beyond enabling SOCKS user auth.
const PROBE_PASS: &str = "probe";
/// How long a single probe waits for its request through the server before giving up.
/// A slow-but-usable server abroad can take several seconds on a first request, so
/// this is generous - a probe that exceeds it is a failure, not a latency sample.
const PROBE_TIMEOUT: Duration = Duration::from_secs(15);
/// How long a raw TCP reachability probe waits for the handshake before giving up.
/// Shorter than `PROBE_TIMEOUT`: a bare connect either answers quickly or the host is
/// unreachable - there is no slow-but-usable middle the way a full proxied request has.
const TCP_PING_TIMEOUT: Duration = Duration::from_secs(6);

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

struct RunningXray {
    runner: ElevatedProcess,
    artifacts: RunArtifacts,
}

struct XrayProcess(Mutex<Option<RunningXray>>);

/// The single, persistent prober xray used for bulk latency testing.
///
/// Unlike the live connection, the prober needs no elevation: it opens only loopback
/// SOCKS inbounds and never touches the TUN adapter or the route table, so it is a
/// plain child process this app can spawn and kill directly. One prober holds every
/// server's outbound at once (see `buildProbeConfig`), so a whole "test all" reuses
/// it without a restart per server.
struct ProbeXray(Mutex<Option<std::process::Child>>);

/// Kills the running prober, if any. Best-effort and idempotent - the desired end
/// state is "no prober", whether it was running, already dead, or never started.
fn stop_probe_inner(state: &ProbeXray) {
    if let Ok(mut guard) = state.0.lock() {
        if let Some(mut child) = guard.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

/// Whether an app-xray.exe process is currently running, checked without needing
/// elevation - enumerating processes by name doesn't require admin rights, only
/// touching one that belongs to another user/elevation level does.
fn is_xray_running() -> bool {
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
/// its own "runas", hence a UAC prompt. `is_xray_running` guards every call, so the
/// normal path - where the graceful stop worked - never prompts.
fn force_kill_xray() -> bool {
    if !is_xray_running() {
        return true;
    }

    if let Ok(taskkill) = spawn_elevated(
        Path::new("taskkill.exe"),
        &["/F", "/IM", "app-xray.exe"],
        Path::new("."),
    ) {
        taskkill.wait_timeout(STOP_TIMEOUT);
    }

    !is_xray_running()
}

fn reap_if_exited(process: &mut Option<RunningXray>) {
    if let Some(running) = process {
        if running.runner.try_wait().is_some() {
            *process = None;
        }
    }
}

/// Stops the running xray on app shutdown: signal the already-elevated wrapper (no new
/// UAC prompt), wait briefly, and force-kill anything that survives. The core must never
/// outlive The Disruptor Proxy holding the TUN adapter and the system route table - that
/// would leave the machine tunnelling through a proxy no running app owns any more.
fn stop_xray(state: &XrayProcess) {
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

    force_kill_xray();
}

#[tauri::command]
fn create_xray_config(app: tauri::AppHandle, config: serde_json::Value) -> Result<String, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {e}"))?;

    std::fs::create_dir_all(&app_data_dir)
        .map_err(|e| format!("Failed to create app data dir: {e}"))?;

    let config_path = app_data_dir.join("config.json");

    let contents = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("Failed to serialize config: {e}"))?;

    std::fs::write(&config_path, contents)
        .map_err(|e| format!("Failed to write config file: {e}"))?;

    Ok(config_path.to_string_lossy().into_owned())
}

#[tauri::command]
fn run_xray_windows(
    app: tauri::AppHandle,
    state: State<XrayProcess>,
    probe_state: State<ProbeXray>,
    config_path: &str,
) -> Result<String, String> {
    // A prober left over from a test is pure waste once a tunnel is up (probing reuses
    // the live core), and keeping a second core alive next to the live one only invites
    // the port and process conflicts this app has already been bitten by. Best-effort.
    stop_probe_inner(&probe_state);

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

    let xray_path = resource_dir.join("app-xray.exe");

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
    // `is_xray_running`, so an ordinary connect never raises a second UAC prompt.
    if is_xray_running() {
        force_kill_xray();
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

    *process = Some(RunningXray { runner, artifacts });

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
#[tauri::command]
fn end_xray_windows(state: State<XrayProcess>) -> Result<String, String> {
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
    if (!stopped || is_xray_running()) && !force_kill_xray() {
        return Err("Could not stop the proxy core - it may still be running.".to_string());
    }

    Ok("Stopped xray".to_string())
}

async fn wait_for_port(addr: &str, timeout: Duration) -> Result<(), String> {
    let deadline = Instant::now() + timeout;

    loop {
        if tokio::net::TcpStream::connect(addr).await.is_ok() {
            return Ok(());
        }

        if Instant::now() >= deadline {
            return Err(format!("Timed out waiting for xray to listen on {addr}"));
        }

        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

#[tauri::command]
async fn ping_xray_windows(app: tauri::AppHandle, config_path: String) -> Result<u64, String> {
    let resource_dir = app
        .path()
        .resolve("assets", BaseDirectory::Resource)
        .map_err(|e| format!("Failed to resolve resource dir: {e}"))?;

    let xray_path = resource_dir.join("app-xray.exe");

    let config_contents = std::fs::read_to_string(&config_path)
        .map_err(|e| format!("Failed to read config at {config_path}: {e}"))?;

    let config: serde_json::Value = serde_json::from_str(&config_contents)
        .map_err(|e| format!("Failed to parse config: {e}"))?;

    let inbound = config["inbounds"]
        .get(0)
        .ok_or_else(|| "Config has no inbounds".to_string())?;

    let port = inbound["port"]
        .as_u64()
        .ok_or_else(|| "Inbound has no port".to_string())?;

    let scheme = match inbound["protocol"].as_str().unwrap_or("socks") {
        "http" => "http",
        _ => "socks5",
    };

    // The ping config has no TUN inbound (see `buildPingConfig`), so this probe
    // process never touches WinTUN or the route table and does not need elevation.
    let mut child = Command::new(&xray_path)
        .arg("run")
        .arg("-c")
        .arg(&config_path)
        .current_dir(&resource_dir)
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map_err(|e| format!("Failed to start app-xray.exe at {xray_path:?}: {e}"))?;

    let addr = format!("127.0.0.1:{port}");

    let ping_result: Result<u64, String> = async {
        wait_for_port(&addr, Duration::from_secs(5)).await?;

        let proxy = reqwest::Proxy::all(format!("{scheme}://{addr}"))
            .map_err(|e| format!("Invalid proxy url: {e}"))?;

        let client = reqwest::Client::builder()
            .proxy(proxy)
            .timeout(Duration::from_secs(10))
            .build()
            .map_err(|e| format!("Failed to build http client: {e}"))?;

        let start = Instant::now();

        client
            .get("https://www.google.com/generate_204")
            .send()
            .await
            .map_err(|e| format!("Ping request failed: {e}"))?;

        Ok(start.elapsed().as_millis() as u64)
    }
    .await;

    let _ = child.kill();
    let _ = child.wait();

    ping_result
}

/// Starts the idle prober from a config that carries one shared loopback SOCKS
/// inbound with a user per server plus each server's outbound (built by
/// `buildProbeConfig`). Any prober from a previous test is torn down first, so only
/// one is ever alive. This runs only when no live connection exists; while connected,
/// the frontend probes through the running tunnel core instead and never calls this.
///
/// The prober touches no TUN adapter or route table, so - unlike the live
/// connection - it runs unelevated with no UAC prompt. It exits immediately if xray
/// rejects the config, which is surfaced here (with the core's stderr) rather than
/// left to fail one opaque probe at a time.
#[tauri::command]
fn start_probe(
    app: tauri::AppHandle,
    state: State<ProbeXray>,
    config: serde_json::Value,
) -> Result<(), String> {
    let resource_dir = resource_assets_dir(&app)?;

    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {e}"))?;

    std::fs::create_dir_all(&app_data_dir)
        .map_err(|e| format!("Failed to create app data dir: {e}"))?;

    let xray_path = resource_dir.join("app-xray.exe");
    let config_path = app_data_dir.join("probe.json");
    let stderr_path = app_data_dir.join("probe-stderr.log");

    let contents = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("Failed to serialize probe config: {e}"))?;
    std::fs::write(&config_path, contents)
        .map_err(|e| format!("Failed to write probe config: {e}"))?;

    // Replace any prober left from an earlier test run before starting a new one.
    stop_probe_inner(&state);

    let stderr = std::fs::File::create(&stderr_path)
        .map_err(|e| format!("Failed to create probe log: {e}"))?;

    let mut child = Command::new(&xray_path)
        .arg("run")
        .arg("-c")
        .arg(&config_path)
        .current_dir(&resource_dir)
        .stderr(std::process::Stdio::from(stderr))
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map_err(|e| format!("Failed to start prober xray at {xray_path:?}: {e}"))?;

    // Give xray a moment to reject a bad config before we report success and let the
    // frontend start probing ports that would never open.
    std::thread::sleep(Duration::from_millis(400));

    if let Ok(Some(status)) = child.try_wait() {
        let log = std::fs::read_to_string(&stderr_path).unwrap_or_default();
        let log = log.trim();

        return Err(if log.is_empty() {
            format!("prober xray exited immediately ({status}). The config was likely rejected.")
        } else {
            format!("prober xray exited immediately ({status}):\n{log}")
        });
    }

    let mut guard = state
        .0
        .lock()
        .map_err(|e| format!("Failed to lock prober state: {e}"))?;
    *guard = Some(child);

    Ok(())
}

/// One real latency sample for a single server: fetches google's `generate_204` through
/// a probe SOCKS port authenticated as this server's `user`, which the core's `user`
/// routing sends out that server's outbound. The core is already running - the live
/// tunnel while connected, or the prober while idle (see `start_probe`) - so this spawns
/// nothing; it is just an HTTP round-trip, and returns the elapsed milliseconds.
///
/// `port` says WHICH core to ask: the live core and the prober listen on different
/// ports (the frontend's `PROBE_SOCKS_PORT` / `PROBER_SOCKS_PORT`), so a probe is never
/// answered by the wrong core - and neither can block the other from binding.
#[tauri::command]
async fn probe_ping(user: String, port: u16) -> Result<u64, String> {
    let addr = format!("127.0.0.1:{port}");

    wait_for_port(&addr, Duration::from_secs(5)).await?;

    // Authenticate as this server's probe user (its content id): the core's `user`
    // routing rule then dispatches the request out that server's own outbound. The id
    // is 16 hex chars, so it needs no URL-encoding in the userinfo.
    let proxy = reqwest::Proxy::all(format!("socks5://{user}:{PROBE_PASS}@{addr}"))
        .map_err(|e| format!("Invalid proxy url: {e}"))?;

    let client = reqwest::Client::builder()
        .proxy(proxy)
        .timeout(PROBE_TIMEOUT)
        .build()
        .map_err(|e| format!("Failed to build http client: {e}"))?;

    let start = Instant::now();

    client
        .get("https://www.google.com/generate_204")
        .send()
        .await
        .map_err(|e| format!("Ping request failed: {e}"))?;

    Ok(start.elapsed().as_millis() as u64)
}

/// One raw TCP reachability sample for a server: the time to complete a TCP handshake
/// to its own `host:port`, with no proxy core involved. Unlike `probe_ping` (which
/// proves the server actually PROXIES by fetching google through it), this only proves
/// the endpoint answers and how far away it is - so it is fast, needs no xray, and
/// works for every protocol, including ones the core cannot connect (tuic/hysteria).
/// DNS resolution is part of the measured time, matching what other clients call a
/// "TCP ping". Returns the elapsed milliseconds, or an error on refusal or timeout.
#[tauri::command]
async fn tcp_ping(host: String, port: u16) -> Result<u64, String> {
    let addr = format!("{host}:{port}");
    let start = Instant::now();

    match tokio::time::timeout(TCP_PING_TIMEOUT, tokio::net::TcpStream::connect(&addr)).await {
        Ok(Ok(_stream)) => Ok(start.elapsed().as_millis() as u64),
        Ok(Err(e)) => Err(format!("TCP connect to {addr} failed: {e}")),
        Err(_) => Err(format!(
            "TCP connect to {addr} timed out after {}s",
            TCP_PING_TIMEOUT.as_secs()
        )),
    }
}

/// Tears the prober down when a test finishes or is cancelled. Best-effort and safe
/// to call when nothing is running.
#[tauri::command]
fn stop_probe(state: State<ProbeXray>) -> Result<(), String> {
    stop_probe_inner(&state);

    Ok(())
}

/// A subscription fetch: the body plus the provider's `Subscription-Userinfo`
/// header (upload/download/total/expire), when present. The header rides on the same
/// response, so it is captured here rather than costing a second request.
#[derive(serde::Serialize)]
struct SubscriptionResponse {
    body: String,
    userinfo: Option<String>,
}

/// Fetches a subscription natively (reqwest), bypassing the webview's CORS. This is
/// why a provider URL that works in v2rayN works here: the browser fetch the
/// frontend would otherwise use cannot reach cross-origin subscription servers.
#[tauri::command]
async fn fetch_subscription(url: String) -> Result<SubscriptionResponse, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|e| format!("Failed to build http client: {e}"))?;

    let response = client
        .get(&url)
        .header("User-Agent", "DisruptorProxy")
        .send()
        .await
        .map_err(|_| "Could not reach the subscription URL".to_string())?;

    if !response.status().is_success() {
        return Err(format!("The server returned {}", response.status()));
    }

    // Read the usage header before consuming the body: providers report quota and
    // expiry in `Subscription-Userinfo`, the de-facto standard every client honours.
    let userinfo = response
        .headers()
        .get("subscription-userinfo")
        .and_then(|value| value.to_str().ok())
        .map(|value| value.to_string());

    let body = response
        .text()
        .await
        .map_err(|e| format!("Failed to read subscription body: {e}"))?;

    Ok(SubscriptionResponse { body, userinfo })
}

/// Bytes sent (uplink) and received (downlink) through the proxy since connect.
#[derive(serde::Serialize)]
struct Traffic {
    uplink: u64,
    downlink: u64,
}

/// Cumulative bytes the live connection has moved through the `proxy` outbound, read
/// from Xray's StatsService over its loopback gRPC API. The counters start at zero
/// each time xray launches, so this reads as "since connect". Fails when xray is not
/// running (the API port is closed) - the caller treats that as "no connection".
#[tauri::command]
async fn xray_traffic(app: tauri::AppHandle) -> Result<Traffic, String> {
    let xray_path = resource_assets_dir(&app)?.join("app-xray.exe");

    let output = tokio::process::Command::new(&xray_path)
        .args([
            "api",
            "statsquery",
            "-s",
            "127.0.0.1:10085",
            "-t",
            "2",
            "-pattern",
            "outbound>>>proxy>>>traffic",
        ])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .await
        .map_err(|e| format!("Failed to query xray stats: {e}"))?;

    if !output.status.success() {
        return Err("xray stats API is not reachable".to_string());
    }

    let parsed: serde_json::Value = serde_json::from_slice(&output.stdout)
        .map_err(|e| format!("Failed to parse stats: {e}"))?;

    let mut traffic = Traffic {
        uplink: 0,
        downlink: 0,
    };

    if let Some(stats) = parsed["stat"].as_array() {
        for entry in stats {
            // `value` is a JSON number, but older cores emit it as a string; accept both.
            let value = entry["value"]
                .as_u64()
                .or_else(|| entry["value"].as_str().and_then(|s| s.parse().ok()))
                .unwrap_or(0);

            match entry["name"].as_str().unwrap_or("") {
                name if name.ends_with("uplink") => traffic.uplink = value,
                name if name.ends_with("downlink") => traffic.downlink = value,
                _ => {}
            }
        }
    }

    Ok(traffic)
}

/// Presence of the geo databases xray needs for `geoip:`/`geosite:` routing rules.
/// Serialized to the frontend so the config builder can skip rules whose `.dat` is
/// missing (an unresolved geo rule makes xray reject the whole config on startup).
#[derive(serde::Serialize)]
struct GeoStatus {
    geoip: bool,
    geosite: bool,
}

/// The bundled-assets directory that sits next to app-xray.exe (the exe, wintun.dll).
/// It lives inside the app bundle, which is READ-ONLY in an installed build - so the
/// geo `.dat` files the user updates at runtime do NOT go here; see `geo_data_dir`.
fn resource_assets_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .resolve("assets", BaseDirectory::Resource)
        .map_err(|e| format!("Failed to resolve resource dir: {e}"))
}

/// The writable per-user directory that holds geoip.dat / geosite.dat.
///
/// By default xray looks for its geo `.dat` files next to app-xray.exe, but that dir
/// is inside the (read-only in an installed build) app bundle - writing there fails
/// with Access Denied, which is why the old "update geo files" silently never worked.
/// So the files are downloaded here, in app data, and the core is pointed at them with
/// the XRAY_LOCATION_ASSET env var whenever it runs a config that carries geo routing
/// rules (the live connection). Created if absent.
fn geo_data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {e}"))?;

    std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create app data dir: {e}"))?;

    Ok(dir)
}

fn geo_status_of(dir: &Path) -> GeoStatus {
    GeoStatus {
        geoip: dir.join("geoip.dat").is_file(),
        geosite: dir.join("geosite.dat").is_file(),
    }
}

/// Whether geoip.dat / geosite.dat are present in app data (where the user's downloads
/// land). Read at connect time so the config builder can drop geo rules the core could
/// not resolve.
#[tauri::command]
fn geo_files_status(app: tauri::AppHandle) -> Result<GeoStatus, String> {
    Ok(geo_status_of(&geo_data_dir(&app)?))
}

/// One chunk's worth of download progress, emitted to the webview as `geo-progress`
/// so the Settings card can show a live percentage. `total` is 0 when the server
/// sent no Content-Length; the frontend shows an indeterminate bar for that.
#[derive(Clone, serde::Serialize)]
struct GeoProgress {
    file: String,
    received: u64,
    total: u64,
}

/// Downloads a single file fully into memory, then writes it in one call. The geo
/// `.dat` files are a couple of MB, so buffering is cheap and the on-disk file is
/// only ever replaced by a complete download (a truncated write would make xray
/// reject every geo rule). Streamed chunk by chunk purely so progress can be
/// emitted as the bytes arrive.
async fn download_file(
    app: &tauri::AppHandle,
    client: &reqwest::Client,
    url: &str,
    dest: &Path,
    name: &str,
) -> Result<(), String> {
    let mut response = client
        .get(url)
        .header("User-Agent", "DisruptorProxy")
        .send()
        .await
        .map_err(|_| format!("Could not reach {url}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "Download failed: the server returned {}",
            response.status()
        ));
    }

    let total = response.content_length().unwrap_or(0);
    let mut bytes: Vec<u8> = Vec::with_capacity(total as usize);

    // Throttled: emitting on EVERY chunk (a network read is often only a few KB,
    // so a multi-MB file means hundreds-to-thousands of events) can flood the
    // WebView IPC bridge faster than it drains - the frontend's listener then
    // either lags far behind or never sees a delivered event before the download
    // finishes and tears the listener down, so the percentage never renders. One
    // emit per ~80ms is imperceptibly coarse for a progress bar and keeps the
    // bridge comfortably ahead. The first and final chunk always emit regardless
    // of timing, so short downloads still show at least a start and an end.
    let mut last_emit = Instant::now() - Duration::from_secs(1);

    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|e| format!("Failed to read the download: {e}"))?
    {
        bytes.extend_from_slice(&chunk);

        let now = Instant::now();
        let is_final = total > 0 && bytes.len() as u64 >= total;
        if is_final || now.duration_since(last_emit) >= Duration::from_millis(80) {
            last_emit = now;
            let _ = app.emit(
                "geo-progress",
                GeoProgress {
                    file: name.into(),
                    received: bytes.len() as u64,
                    total,
                },
            );
        }
    }

    std::fs::write(dest, &bytes).map_err(|e| format!("Failed to write {}: {e}", dest.display()))?;

    Ok(())
}

/// Downloads the latest geoip.dat and geosite.dat into app data (a writable location,
/// unlike the read-only bundle), where XRAY_LOCATION_ASSET points the core - so
/// `geoip:`/`geosite:` routing rules resolve on the next connect. Returns their presence.
#[tauri::command]
async fn update_geo_files(app: tauri::AppHandle) -> Result<GeoStatus, String> {
    let dir = geo_data_dir(&app)?;

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|e| format!("Failed to build http client: {e}"))?;

    download_file(
        &app,
        &client,
        GEOIP_URL,
        &dir.join("geoip.dat"),
        "geoip.dat",
    )
    .await?;
    download_file(
        &app,
        &client,
        GEOSITE_URL,
        &dir.join("geosite.dat"),
        "geosite.dat",
    )
    .await?;

    Ok(geo_status_of(&dir))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(XrayProcess(Mutex::new(None)))
        .manage(ProbeXray(Mutex::new(None)))
        .setup(|_app| {
            // Reap any orphan xray from a previous crashed session before we start.
            force_kill_xray();
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            create_xray_config,
            run_xray_windows,
            end_xray_windows,
            ping_xray_windows,
            start_probe,
            probe_ping,
            tcp_ping,
            stop_probe,
            fetch_subscription,
            xray_traffic,
            geo_files_status,
            update_geo_files
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|app_handle, event| {
            // When The Disruptor Proxy exits - the titlebar/tray both close the only window,
            // which ends the app - tear down xray with it. Nothing else stops the
            // elevated child on close, so without this a session left connected
            // would leak an orphan app-xray.exe holding the TUN adapter and routes.
            if let tauri::RunEvent::Exit = event {
                stop_xray(&app_handle.state::<XrayProcess>());
                stop_probe_inner(&app_handle.state::<ProbeXray>());
            }
        });
}
