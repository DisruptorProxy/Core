use std::process::{Child, Command};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::Manager;
use tauri::State;
use tauri::path::BaseDirectory;

struct XrayProcess(Mutex<Option<Child>>);

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
        .spawn()
        .map_err(|e| format!("Failed to start xray.exe at {xray_path:?}: {e}"))?;

    let pid = child.id();

    *process = Some(child);

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .manage(XrayProcess(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            create_xray_config,
            run_xray_windows,
            end_xray_windows,
            ping_xray_windows
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
