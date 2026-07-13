use std::process::Command;

use tauri::Manager;
use tauri::path::BaseDirectory;

#[tauri::command]
fn run_xray_windows(app: tauri::AppHandle, config_path: &str) -> Result<String, String> {
    let resource_dir = app
        .path()
        .resolve("assets", BaseDirectory::Resource)
        .map_err(|e| format!("Failed to resolve resource dir: {e}"))?;

    let xray_path = resource_dir.join("xray.exe");

    let child = Command::new(&xray_path)
        .arg("run")
        .arg("-c")
        .arg(&config_path)
        .current_dir(&resource_dir)
        .spawn()
        .map_err(|e| format!("Failed to start xray.exe at {xray_path:?}: {e}"))?;

    Ok(format!("Started xray, PID: {}", child.id()))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .invoke_handler(tauri::generate_handler![run_xray_windows])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
