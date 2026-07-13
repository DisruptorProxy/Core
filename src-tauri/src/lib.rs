use std::process::{Child, Command};
use std::sync::Mutex;

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .manage(XrayProcess(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![create_xray_config, run_xray_windows, end_xray_windows])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
