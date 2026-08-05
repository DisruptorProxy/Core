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

    // manifest.xml requests `requireAdministrator`, and that is embedded in dev builds
    // too on purpose: the manifest is what makes the core launchable as a plain child
    // process, so a dev build without it could not bring the tunnel up at all. The cost
    // is that `npm run desktop` needs a terminal that is already elevated - Windows
    // refuses to CreateProcess a requireAdministrator exe from an unelevated parent
    // (error 740) rather than prompting, so cargo would just fail to launch it.
    #[cfg(windows)]
    {
        attributes = attributes.windows_attributes(
            tauri_build::WindowsAttributes::new()
                .app_manifest(include_str!("windows/manifest.xml")),
        );
    }

    tauri_build::try_build(attributes).expect("failed to run tauri-build");
}
