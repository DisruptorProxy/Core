use std::os::windows::process::CommandExt;
use std::process::{Child, Command};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::Manager;
use tauri::State;
use tauri::path::BaseDirectory;

/// Runs a child without flashing a console window - xray.exe is a console app, and
/// the UI should not blink a black window on every connect, ping, or test.
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

struct XrayProcess(Mutex<Option<Child>>);

/// Kills any xray.exe left over from a previous session that crashed before
/// `end_xray_windows` ran. Best-effort: the app owns the only xray it should ever
/// spawn, so a lingering one is always an orphan. Because the app runs elevated,
/// this can also reap an elevated (TUN) instance a non-elevated tool could not.
fn kill_stray_xray() {
    let _ = Command::new("taskkill")
        .args(["/F", "/IM", "xray.exe"])
        .creation_flags(CREATE_NO_WINDOW)
        .output();
}

fn reap_if_exited(process: &mut Option<Child>) {
    if let Some(child) = process {
        if matches!(child.try_wait(), Ok(Some(_))) {
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

#[tauri::command]
fn run_xray_windows(app: tauri::AppHandle, state: State<XrayProcess>, config_path: &str) -> Result<String, String> {
    let resource_dir = app
        .path()
        .resolve("assets", BaseDirectory::Resource)
        .map_err(|e| format!("Failed to resolve resource dir: {e}"))?;

    let xray_path = resource_dir.join("xray.exe");

    let mut process = state.0.lock().map_err(|e| format!("Failed to lock xray process state: {e}"))?;

    reap_if_exited(&mut process);

    if process.is_some() {
        return Err("xray is already running".to_string());
    }

    let child = Command::new(&xray_path)
        .arg("run")
        .arg("-c")
        .arg(&config_path)
        .current_dir(&resource_dir)
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map_err(|e| format!("Failed to start xray.exe at {xray_path:?}: {e}"))?;

    let pid = child.id();

    *process = Some(child);

    // Give xray a moment to reject a bad config or fail to open the TUN adapter, so
    // a dead process is reported as an error instead of a false "connected".
    std::thread::sleep(Duration::from_millis(600));

    if let Some(running) = process.as_mut() {
        if let Ok(Some(status)) = running.try_wait() {
            *process = None;

            return Err(format!(
                "xray exited immediately ({status}). The config was rejected, or TUN needs the app to run as administrator."
            ));
        }
    }

    Ok(format!("Started xray, PID: {pid}"))
}

#[tauri::command]
fn end_xray_windows(state: State<XrayProcess>) -> Result<String, String> {
    let mut process = state.0.lock().map_err(|e| format!("Failed to lock xray process state: {e}"))?;

    reap_if_exited(&mut process);

    match process.take() {
        Some(mut child) => {
            child.kill().map_err(|e| format!("Failed to kill xray process: {e}"))?;
            child.wait().map_err(|e| format!("Failed to wait for xray process: {e}"))?;
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
