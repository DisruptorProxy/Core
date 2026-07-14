fn main() {
    let mut attributes = tauri_build::Attributes::new();

    // Require administrator only in RELEASE builds. TUN (WinTUN adapter + route
    // changes) needs elevation in the shipped app, but embedding it in debug builds
    // stops `tauri dev` from launching the exe from a normal terminal (os error 740).
    // For a real TUN test in dev, run the dev terminal as administrator instead.
    #[cfg(windows)]
    if std::env::var("PROFILE").as_deref() == Ok("release") {
        attributes = attributes.windows_attributes(
            tauri_build::WindowsAttributes::new().app_manifest(include_str!("manifest.xml")),
        );
    }

    tauri_build::try_build(attributes).expect("failed to run tauri-build");
}
