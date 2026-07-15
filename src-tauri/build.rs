fn main() {
    let mut attributes = tauri_build::Attributes::new();

    // manifest.xml requests `asInvoker` (no forced elevation), so it's safe to embed
    // in dev builds too - only xray.exe self-elevates, via ShellExecuteExW at connect
    // time, not the app.
    #[cfg(windows)]
    {
        attributes = attributes.windows_attributes(tauri_build::WindowsAttributes::new().app_manifest(include_str!("manifest.xml")));
    }

    tauri_build::try_build(attributes).expect("failed to run tauri-build");
}
