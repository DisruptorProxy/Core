fn main() {
    // Only the `#[cfg(windows)]` block below reassigns this, so off Windows the `mut` is
    // (correctly) unused - allow it there rather than fail the -D warnings build.
    // The Android VPN commands are declared as an INLINE plugin rather than a separate
    // plugin crate: the Kotlin half already lives in gen/android, so a second gradle
    // project would buy nothing. Declaring them here is what generates the
    // `disruptor-vpn:*` ACL permissions that capabilities/mobile.json grants - without it
    // every invoke from the frontend would be denied.
    #[cfg_attr(not(windows), allow(unused_mut))]
    let mut attributes = tauri_build::Attributes::new().plugin(
        "disruptor-vpn",
        tauri_build::InlinedPlugin::new()
            .commands(&["start", "stop", "traffic"])
            .default_permission(tauri_build::DefaultPermissionRule::AllowAllCommands),
    );

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
