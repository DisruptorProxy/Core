//! Runs the Xray core as a child process on Android, with the VpnService tun fd attached.
//!
//! Xray's `tun` inbound takes the fd from the `XRAY_TUN_FD` environment variable - it can't
//! create the interface itself on Android, the OS owns it. Handing a live fd to a child is
//! the whole problem this module solves: Java's `ProcessBuilder` closes every descriptor
//! above stderr before exec, so a core spawned from Kotlin would find nothing behind the
//! number. Spawning natively does work, because `dup()` returns a copy with `FD_CLOEXEC`
//! cleared, and that copy survives exec under the same number `XRAY_TUN_FD` names.
//!
//!     VpnService.establish() -> fd -> dup() -> exec libxray.so with XRAY_TUN_FD=<dup>
//!
//! The core's own uplink must stay out of the tunnel it serves, and `VpnService.protect()`
//! only reaches sockets in the app's own process. It doesn't need to: the child runs under
//! this app's uid, and `TunnelService` excludes this package from the VPN, which is a uid
//! rule - so the exclusion covers the core's sockets and the routing loop never forms.
//!
//! Called from Kotlin through `XrayCore` (gen/android/.../XrayCore.kt).
//!
//! jni 0.22 split `JNIEnv` into two types, and the split is the reason this file reads the
//! way it does. `EnvUnowned` is the FFI-safe one and the only thing a native method may
//! take as a parameter; it carries none of the JNI API. `Env` has the API but is not FFI
//! safe. `with_env` bridges them: it attaches the thread, hands the closure an `&mut Env`,
//! and catches any panic before it can unwind across the JNI boundary - which is undefined
//! behaviour. `resolve` then applies an error policy, here "throw a Java exception and
//! return the default", so a failure surfaces on the Kotlin side rather than as a silent
//! `false` that looks like a core that merely refused its config.

use std::process::{Child, Command, Stdio};
use std::sync::{Mutex, MutexGuard};
use std::time::Duration;

use jni::errors::ThrowRuntimeExAndDefault;
use jni::objects::{JClass, JString};
use jni::sys::{jboolean, jint};
use jni::{Env, EnvUnowned};

/// A bad config or a missing geo file makes Xray exit almost immediately. Waiting this long
/// before declaring the core up turns that into a `false` from `start`, so the caller can
/// tear the half-open tunnel back down instead of leaving the device with no route.
const STARTUP_GRACE: Duration = Duration::from_millis(500);

/// The running core, kept so `stop` can kill and reap the child it started.
static CORE: Mutex<Option<Child>> = Mutex::new(None);

/// `panic = "abort"` makes a poisoned lock unreachable, but unwinding across the JNI
/// boundary would be worse than working with whatever state is there.
fn core() -> MutexGuard<'static, Option<Child>> {
    CORE.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// `Env::get_string` is deprecated in jni 0.22; the chars now come off the `JString` itself.
fn read(env: &Env, value: &JString) -> Option<String> {
    value.mutf8_chars(env).ok().map(Into::into)
}

fn stop_core(slot: &mut Option<Child>) {
    if let Some(mut child) = slot.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
}

/// Starts `binary` on `config`, giving it `tun_fd` and the directory holding geoip/geosite.
/// Returns whether the core was still alive once it had a chance to reject its config.
///
/// The fd stays owned by the caller - only a dup of it is handed on.
#[no_mangle]
pub extern "system" fn Java_io_disruptorproxy_client_XrayCore_start<'local>(
    mut unowned_env: EnvUnowned<'local>,
    _class: JClass<'local>,
    binary: JString<'local>,
    config: JString<'local>,
    asset_dir: JString<'local>,
    tun_fd: jint,
) -> jboolean {
    unowned_env
        .with_env(|env| -> jni::errors::Result<jboolean> {
            let (Some(binary), Some(config), Some(asset_dir)) = (
                read(env, &binary),
                read(env, &config),
                read(env, &asset_dir),
            ) else {
                return Ok(false);
            };

            let mut slot = core();

            // A second start with a core already running would orphan the first one.
            stop_core(&mut slot);

            // The copy the child inherits: dup() clears FD_CLOEXEC, which is exactly what
            // lets it through exec. Same number on both sides, so XRAY_TUN_FD can just
            // name it.
            let fd = unsafe { libc::dup(tun_fd) };

            if fd < 0 {
                return Ok(false);
            }

            let spawned = Command::new(binary)
                .arg("run")
                .arg("-c")
                .arg(config)
                .env("XRAY_TUN_FD", fd.to_string())
                .env("XRAY_LOCATION_ASSET", asset_dir)
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn();

            // Ours was only ever the template for the child's copy; holding it open would
            // keep the tun alive past `ParcelFileDescriptor.close()`.
            unsafe { libc::close(fd) };

            let Ok(mut child) = spawned else {
                return Ok(false);
            };

            std::thread::sleep(STARTUP_GRACE);

            // Some(status) means it has already exited - it read the config and refused it.
            if matches!(child.try_wait(), Ok(Some(_)) | Err(_)) {
                let _ = child.wait();

                return Ok(false);
            }

            *slot = Some(child);

            Ok(true)
        })
        .resolve::<ThrowRuntimeExAndDefault>()
}

/// Stops the core, if one is running. Safe to call when none is.
///
/// Takes no `Env`: killing a child process touches nothing on the Java side, so there is
/// nothing to attach for and no failure to report back.
#[no_mangle]
pub extern "system" fn Java_io_disruptorproxy_client_XrayCore_stop(
    _env: EnvUnowned<'_>,
    _class: JClass<'_>,
) {
    stop_core(&mut core());
}
