mod platform;

/// The native VPN tunnel. Android only: every other platform runs the core itself through
/// `platform`, while on Android the OS owns the tunnel and we drive it through a plugin.
#[cfg(target_os = "android")]
mod vpn;

/// Spawning the core with the tunnel's fd attached. Android only, and called from Kotlin
/// over JNI rather than from anything here - see the module docs for why it isn't in
/// `vpn`'s plugin commands.
#[cfg(target_os = "android")]
mod android_core;

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::path::BaseDirectory;
use tauri::Emitter;
use tauri::Manager;
use tauri::State;

/// Geo database sources. Xray resolves `geoip:`/`geosite:` routing rules against
/// these `.dat` files; they ship out-of-band (too large and too fast-moving to
/// bundle) and are downloaded into app data on demand (see `geo_data_dir`).
const GEOIP_URL: &str =
    "https://github.com/Loyalsoldier/v2ray-rules-dat/releases/latest/download/geoip.dat";
const GEOSITE_URL: &str =
    "https://github.com/Loyalsoldier/v2ray-rules-dat/releases/latest/download/geosite.dat";

/// The fixed probe-account password (the frontend's `PROBE_PASS`). The probe inbound
/// is loopback-only, so the value is irrelevant beyond enabling SOCKS user auth.
const PROBE_PASS: &str = "probe";
/// How long a single probe waits for its request through the server before giving up.
/// A slow-but-usable server abroad can take several seconds on a first request, so
/// this is generous - a probe that exceeds it is a failure, not a latency sample.
const PROBE_TIMEOUT: Duration = Duration::from_secs(15);

/// The live tunnel core, held per-platform (see `platform::RunningCore`). The lifecycle
/// (launch/stop/reap) is OS-specific and lives in the `platform` backend; this is just
/// the shared slot the commands lock.
///
/// `allow(dead_code)`: a backend with no live-tunnel implementation yet (the
/// `unsupported` fallback) never reads this slot, which would otherwise trip the
/// never-read lint on those targets. The real backends (Windows now, Linux next) do.
#[allow(dead_code)]
struct XrayProcess(Mutex<Option<platform::RunningCore>>);

/// The single, persistent prober xray used for bulk latency testing.
///
/// Unlike the live connection, the prober needs no elevation: it opens only loopback
/// SOCKS inbounds and never touches the TUN adapter or the route table, so it is a
/// plain child process this app can spawn and kill directly on every platform. One
/// prober holds every server's outbound at once (see `buildProbeConfig`), so a whole
/// "test all" reuses it without a restart per server.
struct ProbeXray(Mutex<Option<std::process::Child>>);

/// Kills the running prober, if any. Best-effort and idempotent - the desired end
/// state is "no prober", whether it was running, already dead, or never started.
fn stop_probe_inner(state: &ProbeXray) {
    if let Ok(mut guard) = state.0.lock() {
        if let Some(mut child) = guard.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

#[tauri::command]
fn create_xray_config(app: tauri::AppHandle, config: serde_json::Value) -> Result<String, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {e}"))?;

    std::fs::create_dir_all(&app_data_dir)
        .map_err(|e| format!("Failed to create app data dir: {e}"))?;

    let config_path = app_data_dir.join("config.json");

    let contents = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("Failed to serialize config: {e}"))?;

    std::fs::write(&config_path, contents)
        .map_err(|e| format!("Failed to write config file: {e}"))?;

    Ok(config_path.to_string_lossy().into_owned())
}

/// Brings up the live tunnel. The OS-specific launch (privilege elevation, TUN adapter)
/// lives in the platform backend; this just hands it the state and the config path.
#[tauri::command]
fn run_xray(
    app: tauri::AppHandle,
    state: State<XrayProcess>,
    probe_state: State<ProbeXray>,
    config_path: &str,
) -> Result<String, String> {
    platform::run_core(&app, state.inner(), probe_state.inner(), config_path)
}

/// Tears the live tunnel down, guaranteeing no core is left running (see the platform
/// backend for the verify-then-force-kill contract). Idempotent.
#[tauri::command]
fn end_xray(state: State<XrayProcess>) -> Result<String, String> {
    platform::end_core(state.inner())
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
async fn ping_xray(app: tauri::AppHandle, config_path: String) -> Result<u64, String> {
    let resource_dir = resource_assets_dir(&app)?;
    let xray_path = resource_dir.join(platform::core_binary_name());

    let config_contents = std::fs::read_to_string(&config_path)
        .map_err(|e| format!("Failed to read config at {config_path}: {e}"))?;

    let config: serde_json::Value = serde_json::from_str(&config_contents)
        .map_err(|e| format!("Failed to parse config: {e}"))?;

    let inbound = config["inbounds"]
        .get(0)
        .ok_or_else(|| "Config has no inbounds".to_string())?;

    let port = inbound["port"]
        .as_u64()
        .ok_or_else(|| "Inbound has no port".to_string())?;

    let scheme = match inbound["protocol"].as_str().unwrap_or("socks") {
        "http" => "http",
        _ => "socks5",
    };

    // The ping config has no TUN inbound (see `buildPingConfig`), so this probe
    // process never touches the TUN adapter or the route table and needs no elevation.
    let mut cmd = Command::new(&xray_path);
    cmd.arg("run")
        .arg("-c")
        .arg(&config_path)
        .current_dir(&resource_dir);
    platform::hide_console(&mut cmd);

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to start the core at {xray_path:?}: {e}"))?;

    let addr = format!("127.0.0.1:{port}");

    let ping_result: Result<u64, String> = async {
        wait_for_port(&addr, Duration::from_secs(5)).await?;

        let proxy = reqwest::Proxy::all(format!("{scheme}://{addr}"))
            .map_err(|e| format!("Invalid proxy url: {e}"))?;

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

/// Starts the idle prober from a config that carries one shared loopback SOCKS
/// inbound with a user per server plus each server's outbound (built by
/// `buildProbeConfig`). Any prober from a previous test is torn down first, so only
/// one is ever alive. This runs only when no live connection exists; while connected,
/// the frontend probes through the running tunnel core instead and never calls this.
///
/// The prober touches no TUN adapter or route table, so - unlike the live
/// connection - it runs unelevated with no UAC prompt. It exits immediately if xray
/// rejects the config, which is surfaced here (with the core's stderr) rather than
/// left to fail one opaque probe at a time.
#[tauri::command]
fn start_probe(
    app: tauri::AppHandle,
    state: State<ProbeXray>,
    config: serde_json::Value,
) -> Result<(), String> {
    let resource_dir = resource_assets_dir(&app)?;

    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {e}"))?;

    std::fs::create_dir_all(&app_data_dir)
        .map_err(|e| format!("Failed to create app data dir: {e}"))?;

    let xray_path = resource_dir.join(platform::core_binary_name());
    let config_path = app_data_dir.join("probe.json");
    let stderr_path = app_data_dir.join("probe-stderr.log");

    let contents = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("Failed to serialize probe config: {e}"))?;
    std::fs::write(&config_path, contents)
        .map_err(|e| format!("Failed to write probe config: {e}"))?;

    // Replace any prober left from an earlier test run before starting a new one.
    stop_probe_inner(&state);

    let stderr = std::fs::File::create(&stderr_path)
        .map_err(|e| format!("Failed to create probe log: {e}"))?;

    let mut cmd = Command::new(&xray_path);
    cmd.arg("run")
        .arg("-c")
        .arg(&config_path)
        .current_dir(&resource_dir)
        .stderr(std::process::Stdio::from(stderr));
    platform::hide_console(&mut cmd);

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to start prober xray at {xray_path:?}: {e}"))?;

    // Give xray a moment to reject a bad config before we report success and let the
    // frontend start probing ports that would never open.
    std::thread::sleep(Duration::from_millis(400));

    if let Ok(Some(status)) = child.try_wait() {
        let log = std::fs::read_to_string(&stderr_path).unwrap_or_default();
        let log = log.trim();

        return Err(if log.is_empty() {
            format!("prober xray exited immediately ({status}). The config was likely rejected.")
        } else {
            format!("prober xray exited immediately ({status}):\n{log}")
        });
    }

    let mut guard = state
        .0
        .lock()
        .map_err(|e| format!("Failed to lock prober state: {e}"))?;
    *guard = Some(child);

    Ok(())
}

/// One real latency sample for a single server: fetches google's `generate_204` through
/// a probe SOCKS port authenticated as this server's `user`, which the core's `user`
/// routing sends out that server's outbound. The core is already running - the live
/// tunnel while connected, or the prober while idle (see `start_probe`) - so this spawns
/// nothing; it is just an HTTP round-trip, and returns the elapsed milliseconds.
///
/// `port` says WHICH core to ask: the live core and the prober listen on different
/// ports (the frontend's `PROBE_SOCKS_PORT` / `PROBER_SOCKS_PORT`), so a probe is never
/// answered by the wrong core - and neither can block the other from binding.
#[tauri::command]
async fn probe_ping(user: String, port: u16) -> Result<u64, String> {
    let addr = format!("127.0.0.1:{port}");

    wait_for_port(&addr, Duration::from_secs(5)).await?;

    // Authenticate as this server's probe user (its content id): the core's `user`
    // routing rule then dispatches the request out that server's own outbound. The id
    // is 16 hex chars, so it needs no URL-encoding in the userinfo.
    let proxy = reqwest::Proxy::all(format!("socks5://{user}:{PROBE_PASS}@{addr}"))
        .map_err(|e| format!("Invalid proxy url: {e}"))?;

    let client = reqwest::Client::builder()
        .proxy(proxy)
        .timeout(PROBE_TIMEOUT)
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

/// Where the exit IP is read from. Plain text, one address, no JSON to misparse.
const EXIT_IP_URL: &str = "https://api.ipify.org";

/// How long to wait for the exit-IP lookup. Shorter than `PROBE_TIMEOUT`: this is a UI
/// readout the user is watching, not a measurement worth stalling for.
const EXIT_IP_TIMEOUT: Duration = Duration::from_secs(8);

/// The public IP the internet currently sees for this device, looked up THROUGH the
/// running core's probe SOCKS inbound rather than directly.
///
/// Going through the core is what makes the answer true on every platform. A direct
/// request would be right on desktop, where the tun pulls in the whole device - but wrong
/// on Android, where `TunnelService` excludes this app's uid from the VPN, so the webview
/// and this process both reach the internet off-tunnel and would report the device's real
/// address while connected. Authenticating as the active server's probe user sends the
/// lookup out that server's outbound, so what comes back is the address the tunnel
/// presents.
///
/// The response is parsed as an `IpAddr` before being returned: a captive portal or an
/// error page would otherwise be shown to the user as though it were their address.
#[tauri::command]
async fn exit_ip(user: String, port: u16) -> Result<String, String> {
    let addr = format!("127.0.0.1:{port}");

    wait_for_port(&addr, Duration::from_secs(5)).await?;

    let proxy = reqwest::Proxy::all(format!("socks5://{user}:{PROBE_PASS}@{addr}"))
        .map_err(|e| format!("Invalid proxy url: {e}"))?;

    let client = reqwest::Client::builder()
        .proxy(proxy)
        .timeout(EXIT_IP_TIMEOUT)
        .build()
        .map_err(|e| format!("Failed to build http client: {e}"))?;

    let body = client
        .get(EXIT_IP_URL)
        .send()
        .await
        .map_err(|e| format!("IP lookup failed: {e}"))?
        .text()
        .await
        .map_err(|e| format!("IP lookup returned no body: {e}"))?;

    let ip = body.trim();

    ip.parse::<std::net::IpAddr>()
        .map(|_| ip.to_string())
        .map_err(|_| "IP lookup returned something that is not an address".to_string())
}

/// Tears the prober down when a test finishes or is cancelled. Best-effort and safe
/// to call when nothing is running.
#[tauri::command]
fn stop_probe(state: State<ProbeXray>) -> Result<(), String> {
    stop_probe_inner(&state);

    Ok(())
}

/// A subscription fetch: the body plus the provider's `Subscription-Userinfo`
/// header (upload/download/total/expire), when present. The header rides on the same
/// response, so it is captured here rather than costing a second request.
#[derive(serde::Serialize)]
struct SubscriptionResponse {
    body: String,
    userinfo: Option<String>,
}

/// Fetches a subscription natively (reqwest), bypassing the webview's CORS. This is
/// why a provider URL that works in v2rayN works here: the browser fetch the
/// frontend would otherwise use cannot reach cross-origin subscription servers.
#[tauri::command]
async fn fetch_subscription(url: String) -> Result<SubscriptionResponse, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|e| format!("Failed to build http client: {e}"))?;

    let response = client
        .get(&url)
        .header("User-Agent", "DisruptorProxy")
        .send()
        .await
        .map_err(|_| "Could not reach the subscription URL".to_string())?;

    if !response.status().is_success() {
        return Err(format!("The server returned {}", response.status()));
    }

    // Read the usage header before consuming the body: providers report quota and
    // expiry in `Subscription-Userinfo`, the de-facto standard every client honours.
    let userinfo = response
        .headers()
        .get("subscription-userinfo")
        .and_then(|value| value.to_str().ok())
        .map(|value| value.to_string());

    let body = response
        .text()
        .await
        .map_err(|e| format!("Failed to read subscription body: {e}"))?;

    Ok(SubscriptionResponse { body, userinfo })
}

/// Bytes sent (uplink) and received (downlink) through the proxy since connect.
#[derive(serde::Serialize)]
struct Traffic {
    uplink: u64,
    downlink: u64,
}

/// Cumulative bytes the live connection has moved through the `proxy` outbound, read
/// from Xray's StatsService over its loopback gRPC API. The counters start at zero
/// each time xray launches, so this reads as "since connect". Fails when xray is not
/// running (the API port is closed) - the caller treats that as "no connection".
#[tauri::command]
async fn xray_traffic(app: tauri::AppHandle) -> Result<Traffic, String> {
    let xray_path = resource_assets_dir(&app)?.join(platform::core_binary_name());

    let mut cmd = tokio::process::Command::new(&xray_path);
    cmd.args([
        "api",
        "statsquery",
        "-s",
        "127.0.0.1:10085",
        "-t",
        "2",
        "-pattern",
        "outbound>>>proxy>>>traffic",
    ]);
    platform::hide_console_tokio(&mut cmd);

    let output = cmd
        .output()
        .await
        .map_err(|e| format!("Failed to query xray stats: {e}"))?;

    if !output.status.success() {
        return Err("xray stats API is not reachable".to_string());
    }

    let parsed: serde_json::Value = serde_json::from_slice(&output.stdout)
        .map_err(|e| format!("Failed to parse stats: {e}"))?;

    let mut traffic = Traffic {
        uplink: 0,
        downlink: 0,
    };

    if let Some(stats) = parsed["stat"].as_array() {
        for entry in stats {
            // `value` is a JSON number, but older cores emit it as a string; accept both.
            let value = entry["value"]
                .as_u64()
                .or_else(|| entry["value"].as_str().and_then(|s| s.parse().ok()))
                .unwrap_or(0);

            match entry["name"].as_str().unwrap_or("") {
                name if name.ends_with("uplink") => traffic.uplink = value,
                name if name.ends_with("downlink") => traffic.downlink = value,
                _ => {}
            }
        }
    }

    Ok(traffic)
}

/// Presence of the geo databases xray needs for `geoip:`/`geosite:` routing rules.
/// Serialized to the frontend so the config builder can skip rules whose `.dat` is
/// missing (an unresolved geo rule makes xray reject the whole config on startup).
#[derive(serde::Serialize)]
struct GeoStatus {
    geoip: bool,
    geosite: bool,
}

/// The bundled-assets directory that sits next to the core binary (the exe + wintun.dll
/// on Windows). It lives inside the app bundle, which is READ-ONLY in an installed
/// build, so the geo `.dat` files the user updates at runtime do NOT go here; see
/// `geo_data_dir`.
fn resource_assets_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .resolve("assets", BaseDirectory::Resource)
        .map_err(|e| format!("Failed to resolve resource dir: {e}"))
}

/// The writable per-user directory that holds geoip.dat / geosite.dat.
///
/// By default xray looks for its geo `.dat` files next to the core binary, but that dir
/// is inside the (read-only in an installed build) app bundle - writing there fails
/// with Access Denied, which is why the old "update geo files" silently never worked.
/// So the files are downloaded here, in app data, and the core is pointed at them with
/// the XRAY_LOCATION_ASSET env var whenever it runs a config that carries geo routing
/// rules (the live connection). Created if absent.
fn geo_data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {e}"))?;

    std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create app data dir: {e}"))?;

    Ok(dir)
}

fn geo_status_of(dir: &Path) -> GeoStatus {
    GeoStatus {
        geoip: dir.join("geoip.dat").is_file(),
        geosite: dir.join("geosite.dat").is_file(),
    }
}

/// Whether geoip.dat / geosite.dat are present in app data (where the user's downloads
/// land). Read at connect time so the config builder can drop geo rules the core could
/// not resolve.
#[tauri::command]
fn geo_files_status(app: tauri::AppHandle) -> Result<GeoStatus, String> {
    Ok(geo_status_of(&geo_data_dir(&app)?))
}

/// One chunk's worth of download progress, emitted to the webview as `geo-progress`
/// so the Settings card can show a live percentage. `total` is 0 when the server
/// sent no Content-Length; the frontend shows an indeterminate bar for that.
#[derive(Clone, serde::Serialize)]
struct GeoProgress {
    file: String,
    received: u64,
    total: u64,
}

/// Downloads a single file fully into memory, then writes it in one call. The geo
/// `.dat` files are a couple of MB, so buffering is cheap and the on-disk file is
/// only ever replaced by a complete download (a truncated write would make xray
/// reject every geo rule). Streamed chunk by chunk purely so progress can be
/// emitted as the bytes arrive.
async fn download_file(
    app: &tauri::AppHandle,
    client: &reqwest::Client,
    url: &str,
    dest: &Path,
    name: &str,
) -> Result<(), String> {
    let mut response = client
        .get(url)
        .header("User-Agent", "DisruptorProxy")
        .send()
        .await
        .map_err(|_| format!("Could not reach {url}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "Download failed: the server returned {}",
            response.status()
        ));
    }

    let total = response.content_length().unwrap_or(0);
    let mut bytes: Vec<u8> = Vec::with_capacity(total as usize);

    // Throttled: emitting on EVERY chunk (a network read is often only a few KB,
    // so a multi-MB file means hundreds-to-thousands of events) can flood the
    // WebView IPC bridge faster than it drains - the frontend's listener then
    // either lags far behind or never sees a delivered event before the download
    // finishes and tears the listener down, so the percentage never renders. One
    // emit per ~80ms is imperceptibly coarse for a progress bar and keeps the
    // bridge comfortably ahead. The first and final chunk always emit regardless
    // of timing, so short downloads still show at least a start and an end.
    let mut last_emit = Instant::now() - Duration::from_secs(1);

    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|e| format!("Failed to read the download: {e}"))?
    {
        bytes.extend_from_slice(&chunk);

        let now = Instant::now();
        let is_final = total > 0 && bytes.len() as u64 >= total;
        if is_final || now.duration_since(last_emit) >= Duration::from_millis(80) {
            last_emit = now;
            let _ = app.emit(
                "geo-progress",
                GeoProgress {
                    file: name.into(),
                    received: bytes.len() as u64,
                    total,
                },
            );
        }
    }

    std::fs::write(dest, &bytes).map_err(|e| format!("Failed to write {}: {e}", dest.display()))?;

    Ok(())
}

/// Downloads the latest geoip.dat and geosite.dat into app data (a writable location,
/// unlike the read-only bundle), where XRAY_LOCATION_ASSET points the core - so
/// `geoip:`/`geosite:` routing rules resolve on the next connect. Returns their presence.
#[tauri::command]
async fn update_geo_files(app: tauri::AppHandle) -> Result<GeoStatus, String> {
    let dir = geo_data_dir(&app)?;

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|e| format!("Failed to build http client: {e}"))?;

    download_file(
        &app,
        &client,
        GEOIP_URL,
        &dir.join("geoip.dat"),
        "geoip.dat",
    )
    .await?;
    download_file(
        &app,
        &client,
        GEOSITE_URL,
        &dir.join("geosite.dat"),
        "geosite.dat",
    )
    .await?;

    Ok(geo_status_of(&dir))
}

/// The host OS, so the frontend can tell desktop from mobile - window chrome (titlebar),
/// the tray, and the compact/expanded window modes are desktop-only. Returns one of
/// `windows` / `linux` / `macos` / `android` / `ios`.
#[tauri::command]
fn platform_kind() -> &'static str {
    std::env::consts::OS
}

/// The physical interface Xray should bind its outbounds to, or `None` to leave the core
/// on its own detection. Only unix needs this - see `platform::default_route_interface`.
#[tauri::command]
fn tun_outbound_interface() -> Option<String> {
    platform::default_route_interface()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Must happen before anything builds a reqwest client. See the `rustls` note in
    // Cargo.toml: reqwest is compiled without a default crypto provider, and building a
    // client without one panics - fatally, since the panic unwinds out of a Rust thread
    // into the JVM. On Android in dev that is Tauri's own dev-server proxy
    // (`protocol/tauri.rs`), which it builds before the first paint, so the app aborted on
    // launch and only ever showed a white screen. Idempotent: `install_default` returns an
    // error if a provider is already set, which is fine.
    let _ = rustls::crypto::ring::default_provider().install_default();

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init());

    // Android alone needs the VPN plugin; desktop drives the core directly.
    #[cfg(target_os = "android")]
    let builder = builder.plugin(vpn::init());

    builder
        .manage(XrayProcess(Mutex::new(None)))
        .manage(ProbeXray(Mutex::new(None)))
        .setup(|_app| {
            // Reap any orphan xray from a previous crashed session before we start.
            platform::force_kill_core();
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            create_xray_config,
            run_xray,
            end_xray,
            ping_xray,
            start_probe,
            probe_ping,
            exit_ip,
            stop_probe,
            fetch_subscription,
            xray_traffic,
            geo_files_status,
            update_geo_files,
            platform_kind,
            tun_outbound_interface
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|app_handle, event| {
            // When Disruptor Proxy exits - the titlebar/tray both close the only window,
            // which ends the app - tear down xray with it. Nothing else stops the
            // elevated child on close, so without this a session left connected
            // would leak an orphan core holding the TUN adapter and routes.
            if let tauri::RunEvent::Exit = event {
                let xray = app_handle.state::<XrayProcess>();
                let probe = app_handle.state::<ProbeXray>();
                platform::stop_core_on_exit(xray.inner());
                stop_probe_inner(probe.inner());
            }
        });
}
