import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("rust")
}

val tauriProperties = Properties().apply {
    val propFile = file("tauri.properties")
    if (propFile.exists()) {
        propFile.inputStream().use { load(it) }
    }
}

// Release signing. Android refuses to install an unsigned APK, so a release build is
// useless without this. Values come from keystore.properties (local, gitignored) or from
// env vars (CI secrets); when neither is present the release build simply stays unsigned
// rather than failing, so `tauri android build` still works for a smoke test.
// Both the properties file and a relative storeFile resolve against gen/android
// (rootProject), not app/ -- that is where they actually live.
val keystoreProperties = Properties().apply {
    val propFile = rootProject.file("keystore.properties")
    if (propFile.exists()) {
        propFile.inputStream().use { load(it) }
    }
}

fun signingValue(key: String, env: String): String? =
    keystoreProperties.getProperty(key) ?: System.getenv(env)

// An absolute path (what CI exports) is taken as-is; a bare filename is resolved next to
// keystore.properties, so the file can name it plainly and stay portable.
val keystoreFile = signingValue("storeFile", "ANDROID_KEYSTORE_PATH")?.let(rootProject::file)

// The ABIs `npm run fetch-core:android` installs a core for (ANDROID_ABIS in that script).
// The APK ships exactly these, and the build fails below if a core for one is missing.
val coreAbis = listOf("arm64-v8a", "x86_64", "armeabi-v7a", "x86")

android {
    compileSdk = 36
    namespace = "io.disruptorproxy.client"
    defaultConfig {
        manifestPlaceholders["usesCleartextTraffic"] = "false"
        applicationId = "io.disruptorproxy.client"
        minSdk = 24
        targetSdk = 36
        versionCode = tauriProperties.getProperty("tauri.android.versionCode", "1").toInt()
        versionName = tauriProperties.getProperty("tauri.android.versionName", "1.0")

        // Tied to `coreAbis` so the APK can never carry an ABI it has no core for. The Rust
        // lib builds for every ABI regardless, and an APK holding only that would install
        // happily and then fail to bring the tunnel up, since XrayCore.start would find no
        // binary to exec - an "incompatible device" at install time is the honest answer.
        ndk {
            abiFilters += coreAbis
        }
    }

    // The Xray core, fetched per ABI by `npm run fetch-core:android`. Kept out of
    // src/main/jniLibs, which the Tauri gradle plugin owns (it symlinks the Rust lib in).
    sourceSets.getByName("main").jniLibs.srcDir("xrayLibs")

    packaging {
        // libxray.so is an executable, not a library: it has to exist as a real file in
        // nativeLibraryDir for the core to be exec'd, and that only happens when native
        // libs are extracted at install time rather than left compressed in the APK.
        jniLibs.useLegacyPackaging = true
    }
    signingConfigs {
        create("release") {
            if (keystoreFile != null) {
                storeFile = keystoreFile
                storePassword = signingValue("storePassword", "ANDROID_KEYSTORE_PASSWORD")
                keyAlias = signingValue("keyAlias", "ANDROID_KEY_ALIAS")
                keyPassword = signingValue("keyPassword", "ANDROID_KEY_PASSWORD")
            }
        }
    }
    buildTypes {
        getByName("debug") {
            manifestPlaceholders["usesCleartextTraffic"] = "true"
            isDebuggable = true
            isJniDebuggable = true
            isMinifyEnabled = false
            packaging {                jniLibs.keepDebugSymbols.add("*/arm64-v8a/*.so")
                jniLibs.keepDebugSymbols.add("*/armeabi-v7a/*.so")
                jniLibs.keepDebugSymbols.add("*/x86/*.so")
                jniLibs.keepDebugSymbols.add("*/x86_64/*.so")
            }
        }
        getByName("release") {
            // Attaching a config with no keystore behind it fails the build outright, so an
            // unconfigured checkout still produces the (unsigned) artifact.
            if (keystoreFile != null) {
                signingConfig = signingConfigs.getByName("release")
            }
            isMinifyEnabled = true
            proguardFiles(
                *fileTree(".") { include("**/*.pro") }
                    .plus(getDefaultProguardFile("proguard-android-optimize.txt"))
                    .toList().toTypedArray()
            )
        }
    }
    kotlinOptions {
        jvmTarget = "1.8"
    }
    buildFeatures {
        buildConfig = true
    }

    dependenciesInfo {
        includeInApk = false
    }
}

// The ABIs `npm run fetch-core:android` installs a core for (ANDROID_ABIS in that script).
val coreAbis = listOf("arm64-v8a", "x86_64")

// Without this the missing core is invisible: the APK builds, installs and launches
// perfectly, and only at connect time does XrayCore.start find no binary to exec - so
// TunnelService tears the tunnel straight back down and every request goes out
// unproxied, which reads as "the proxy does nothing" rather than as a build error.
tasks.matching { it.name.matches(Regex("merge.*JniLibFolders")) }.configureEach {
    doFirst {
        val missing = coreAbis.filterNot { file("xrayLibs/$it/libxray.so").exists() }

        if (missing.isNotEmpty()) {
            throw GradleException(
                "Xray core missing for ${missing.joinToString()}. " +
                    "Run `npm run fetch-core:android` from the repo root, then build again."
            )
        }
    }
}

rust {
    rootDirRel = "../../../"
}

dependencies {
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.lifecycle:lifecycle-process:2.10.0")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.1.4")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.0")
}

apply(from = "tauri.build.gradle.kts")