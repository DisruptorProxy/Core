fn main() {
    // Only the `#[cfg(windows)]` block below reassigns this, so off Windows the `mut` is
    // (correctly) unused - allow it there rather than fail the -D warnings build.
    #[cfg_attr(not(windows), allow(unused_mut))]
    let mut attributes = tauri_build::Attributes::new();

    // manifest.xml requests `asInvoker` (no forced elevation), so it's safe to embed
    // in dev builds too - only app-xray.exe self-elevates, via ShellExecuteExW at connect
    // time, not the app.
    #[cfg(windows)]
    {
        attributes = attributes.windows_attributes(
            tauri_build::WindowsAttributes::new()
                .app_manifest(include_str!("windows/manifest.xml")),
        );
    }

    tauri_build::try_build(attributes).expect("failed to run tauri-build");
}
