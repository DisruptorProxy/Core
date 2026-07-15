use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::Manager;
use tauri::State;
use tauri::path::BaseDirectory;

use windows::Win32::Foundation::{CloseHandle, HANDLE};
use windows::Win32::System::Threading::{GetExitCodeProcess, GetProcessId, TerminateProcess, WaitForSingleObject, INFINITE};
use windows::Win32::UI::Shell::{SEE_MASK_FLAG_NO_UI, SEE_MASK_NOCLOSEPROCESS, SEE_MASK_NO_CONSOLE, SHELLEXECUTEINFOW, ShellExecuteExW};
use windows::Win32::UI::WindowsAndMessaging::SW_HIDE;
use windows::core::PCWSTR;

/// Runs a child without flashing a console window - xray.exe is a console app, and
/// the UI should not blink a black window on every connect, ping, or test.
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// GetExitCodeProcess's value for "this process has not exited yet".
const STILL_ACTIVE: u32 = 259;

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

    /// Blocks until the process exits and returns its exit code.
    fn wait(&self) -> Option<u32> {
        unsafe {
            let _ = WaitForSingleObject(self.handle, INFINITE);
        }

        self.try_wait()
    }

    fn kill(&self) -> windows::core::Result<()> {
        unsafe { TerminateProcess(self.handle, 1) }
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
    args.iter().map(|arg| quote_arg(arg)).collect::<Vec<_>>().join(" ")
}

/// Launches `exe` elevated (UAC "runas" prompt) via `ShellExecuteExW`, without
/// spawning a visible console window.
fn spawn_elevated(exe: &Path, args: &[&str], working_dir: &Path) -> windows::core::Result<ElevatedProcess> {
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

    Ok(ElevatedProcess { handle: info.hProcess })
}

struct XrayProcess(Mutex<Option<ElevatedProcess>>);

/// Whether an xray.exe process is currently running, checked without needing
/// elevation - enumerating processes by name doesn't require admin rights, only
/// touching one that belongs to another user/elevation level does.
fn is_xray_running() -> bool {
    Command::new("tasklist")
        .args(["/FI", "IMAGENAME eq xray.exe", "/NH"])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map(|out| String::from_utf8_lossy(&out.stdout).to_lowercase().contains("xray.exe"))
        .unwrap_or(false)
}

/// Kills any xray.exe left over from a previous session that crashed before
/// `end_xray_windows` ran. Best-effort: the app owns the only xray it should ever
/// spawn, so a lingering one is always an orphan. The app itself no longer runs
/// elevated, so a stray elevated (TUN) instance needs its own "runas" elevation to
/// reap; checking with `tasklist` first keeps a normal startup free of UAC prompts.
fn kill_stray_xray() {
    if !is_xray_running() {
        return;
    }

    if let Ok(taskkill) = spawn_elevated(Path::new("taskkill.exe"), &["/F", "/IM", "xray.exe"], Path::new("."))
    {
        taskkill.wait();
    }
}

fn reap_if_exited(process: &mut Option<ElevatedProcess>) {
    if let Some(running) = process {
        if running.try_wait().is_some() {
            *process = None;
        }
    }
}

#[tauri::command]
fn create_xray_config(app: tauri::AppHandle, config: serde_json::Value) -> Result<String, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {e}"))?;

    std::fs::create_dir_all(&app_data_dir).map_err(|e| format!("Failed to create app data dir: {e}"))?;

    let config_path = app_data_dir.join("config.json");

    let contents = serde_json::to_string_pretty(&config).map_err(|e| format!("Failed to serialize config: {e}"))?;

    std::fs::write(&config_path, contents).map_err(|e| format!("Failed to write config file: {e}"))?;

    Ok(config_path.to_string_lossy().into_owned())
}

/// Points xray's own error log at a file in `run_dir` and writes the result to a
/// fresh config file, returning `(config path to launch with, log file to read
/// back)`. `ShellExecuteExW` has no way to redirect a child's stdout/stderr, so
/// this is the only way to recover *why* xray exited (bad config, TUN adapter
/// failure, ...) instead of just its exit code.
fn prepare_run_config(config_path: &str, run_dir: &Path) -> Result<(PathBuf, PathBuf), String> {
    let contents = std::fs::read_to_string(config_path).map_err(|e| format!("Failed to read config at {config_path}: {e}"))?;

    let mut config: serde_json::Value =
        serde_json::from_str(&contents).map_err(|e| format!("Failed to parse config: {e}"))?;

    let log_path = run_dir.join("xray-run.log");
    let _ = std::fs::remove_file(&log_path);
    let log_path_str = log_path.to_string_lossy().into_owned();

    match config.get_mut("log").and_then(|v| v.as_object_mut()) {
        Some(log) => {
            log.insert("error".to_string(), serde_json::Value::String(log_path_str));
            log.entry("loglevel").or_insert_with(|| serde_json::Value::String("warning".to_string()));
        }
        None => config["log"] = serde_json::json!({ "error": log_path_str, "loglevel": "warning" }),
    }

    let run_config_path = run_dir.join("xray-run-config.json");

    let run_config_contents = serde_json::to_string(&config).map_err(|e| format!("Failed to serialize run config: {e}"))?;

    std::fs::write(&run_config_path, run_config_contents).map_err(|e| format!("Failed to write run config: {e}"))?;

    Ok((run_config_path, log_path))
}

#[tauri::command]
fn run_xray_windows(app: tauri::AppHandle, state: State<XrayProcess>, config_path: &str) -> Result<String, String> {
    let resource_dir = app
        .path()
        .resolve("assets", BaseDirectory::Resource)
        .map_err(|e| format!("Failed to resolve resource dir: {e}"))?;

    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {e}"))?;

    let xray_path = resource_dir.join("xray.exe");

    let mut process = state.0.lock().map_err(|e| format!("Failed to lock xray process state: {e}"))?;

    reap_if_exited(&mut process);

    if process.is_some() {
        return Err("xray is already running".to_string());
    }

    println!("config_path: {}", config_path);

    let (run_config_path, log_path) = prepare_run_config(config_path, &app_data_dir)?;
    let run_config_path = run_config_path.to_string_lossy().into_owned();

    // xray needs admin rights here for the WinTUN adapter and route table, so it is
    // launched elevated on its own rather than requiring the whole app to run as
    // administrator. This shows a UAC prompt at connect time.
    let elevated = spawn_elevated(&xray_path, &["run", "-c", &run_config_path], &resource_dir)
        .map_err(|e| format!("Failed to start xray.exe elevated at {xray_path:?}: {e}"))?;

    let pid = elevated.id();

    *process = Some(elevated);

    // Give xray a moment to reject a bad config or fail to open the TUN adapter, so
    // a dead process is reported as an error instead of a false "connected".
    std::thread::sleep(Duration::from_millis(600));

    if let Some(running) = process.as_ref() {
        if let Some(exit_code) = running.try_wait() {
            *process = None;

            let output = std::fs::read_to_string(&log_path).unwrap_or_default();
            let output = output.trim();

            return Err(if output.is_empty() {
                format!("xray exited immediately (exit code {exit_code}). The config was likely rejected.")
            } else {
                format!("xray exited immediately (exit code {exit_code}):\n{output}")
            });
        }
    }

    Ok(format!("Started xray, PID: {pid}"))
}

#[tauri::command]
fn end_xray_windows(state: State<XrayProcess>) -> Result<String, String> {
    let mut process = state.0.lock().map_err(|e| format!("Failed to lock xray process state: {e}"))?;

    reap_if_exited(&mut process);

    match process.take() {
        Some(child) => {
            child.kill().map_err(|e| format!("Failed to kill xray process: {e}"))?;
            child.wait();
            Ok("Stopped xray".to_string())
        }
        None => Err("xray is not running".to_string()),
    }
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

    let xray_path = resource_dir.join("xray.exe");

    let config_contents =
        std::fs::read_to_string(&config_path).map_err(|e| format!("Failed to read config at {config_path}: {e}"))?;

    let config: serde_json::Value =
        serde_json::from_str(&config_contents).map_err(|e| format!("Failed to parse config: {e}"))?;

    let inbound = config["inbounds"]
        .get(0)
        .ok_or_else(|| "Config has no inbounds".to_string())?;

    let port = inbound["port"].as_u64().ok_or_else(|| "Inbound has no port".to_string())?;

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
        .map_err(|e| format!("Failed to start xray.exe at {xray_path:?}: {e}"))?;

    let addr = format!("127.0.0.1:{port}");

    let ping_result: Result<u64, String> = async {
        wait_for_port(&addr, Duration::from_secs(5)).await?;

        let proxy = reqwest::Proxy::all(format!("{scheme}://{addr}")).map_err(|e| format!("Invalid proxy url: {e}"))?;

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

/// Light TCP-connect latency to `host:port`, in milliseconds. Used for bulk server
/// testing - it measures reachability without spawning an xray per probe, so
/// testing hundreds of servers stays cheap. A real through-proxy figure comes from
/// `ping_xray_windows` for a single server.
#[tauri::command]
async fn tcp_ping(host: String, port: u16) -> Result<u64, String> {
    let addr = format!("{host}:{port}");
    let start = Instant::now();

    match tokio::time::timeout(Duration::from_secs(3), tokio::net::TcpStream::connect(&addr)).await {
        Ok(Ok(_stream)) => Ok(start.elapsed().as_millis() as u64),
        Ok(Err(e)) => Err(format!("connection refused: {e}")),
        Err(_) => Err("i/o timeout".to_string()),
    }
}

/// Fetches a subscription body natively (reqwest), bypassing the webview's CORS.
/// This is why a provider URL that works in v2rayN works here: the browser fetch
/// the frontend would otherwise use cannot reach cross-origin subscription servers.
#[tauri::command]
async fn fetch_subscription(url: String) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|e| format!("Failed to build http client: {e}"))?;

    let response = client
        .get(&url)
        .header("User-Agent", "Guardian")
        .send()
        .await
        .map_err(|_| "Could not reach the subscription URL".to_string())?;

    if !response.status().is_success() {
        return Err(format!("The server returned {}", response.status()));
    }

    response
        .text()
        .await
        .map_err(|e| format!("Failed to read subscription body: {e}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .manage(XrayProcess(Mutex::new(None)))
        .setup(|_app| {
            // Reap any orphan xray from a previous crashed session before we start.
            kill_stray_xray();
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            create_xray_config,
            run_xray_windows,
            end_xray_windows,
            ping_xray_windows,
            tcp_ping,
            fetch_subscription
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
