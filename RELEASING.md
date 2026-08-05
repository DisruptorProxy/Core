# Releasing Disruptor Proxy

How a version gets from this repo to users, and the one-time setup that makes it work.

## The shape of it

One repository: **`DisruptorProxy/Core`** — the source, where the release workflow
runs, and where the release lands. Users and the auto-updater download from here too;
`tauri.conf.json`'s updater endpoint points at
`Core/releases/latest/download/latest.json`.

Pushing a `v*` tag triggers `.github/workflows/release.yml`, which builds and signs, then
publishes a **draft** release on this repo.

A draft is invisible to anonymous downloads and to the updater (`releases/latest` only
resolves to a *published* release), so a bad build never reaches anyone until you
publish it by hand.

### What gets built

Exactly four assets, plus the updater manifest:

| Asset | Purpose |
| --- | --- |
| `Disruptor-Proxy_<version>_x64-setup.exe` | Windows installer — the updater's target |
| `Disruptor-Proxy_<version>_x64-setup.exe.sig` | Its updater signature |
| `Disruptor-Proxy_<version>_amd64.deb` | Linux, direct download |
| `Disruptor-Proxy_<version>.apk` | Android, direct download |
| `latest.json` | The updater manifest |

Nothing else is bundled: no MSI and no AppImage. macOS is not a supported platform.
Because the AppImage was Linux's only updater target, `latest.json` covers
`windows-x86_64` **only** — `.deb` and `.apk` users update by downloading the new file.

## Cutting a release

```
npm run release -- <version | patch | minor | major>
```

`scripts/release.mjs` bumps the version in `package.json`, `src-tauri/Cargo.toml`, and
`Cargo.lock`, commits it as `chore(release): vX.Y.Z`, tags it, and pushes the branch and
the tag. Pushing the tag is the entire handoff — CI takes over from there.

The app version comes from `Cargo.toml`, and the updater compares the tag-derived
version in `latest.json` against what's installed. The release script keeps the two in
lockstep, so **always release through it** — a hand-cut tag that doesn't match the built
version makes the updater either miss the update or offer the same version forever.

Then, on GitHub:

1. Watch the **Actions** tab until the `Release` run is green (~14 min).
2. Open **Releases**, review the draft, and **Publish** it.
3. Verify (below).

## Release notes

Notes are generated automatically from your **Conventional Commits** by git-cliff
(`cliff.toml`) during the CI run — there is no hand-maintained `CHANGELOG.md`. The same
generated notes are spliced into both surfaces: the release body and the updater's in-app
`notes`.

What this means day to day:

- Write commits as `feat: …`, `fix: …`, `perf: …`, etc. Those become the "Features",
  "Bug Fixes", "Performance" sections. `ci:`, `chore(release):`, and `chore(deps):` are
  skipped; other `chore:` land under "Miscellaneous".
- Nothing extra to do at release time — `npm run release` tags, CI runs git-cliff over
  the commits since the previous tag, and fills the notes in.
- To change grouping or wording, edit `cliff.toml`'s `commit_parsers` / `body` template.

## Verifying a published release

After publishing the draft:

- `https://github.com/DisruptorProxy/Core/releases/latest/download/latest.json`
  returns JSON with the new `version` and a `platforms.windows-x86_64.url` pointing at
  `Disruptor-Proxy_<version>_x64-setup.exe`.
- That URL actually downloads the installer.

The auto-update path itself is only exercised when a *newer* release exists than what's
installed — so the first version a user can update *to* is the one after their install.

## One-time setup (already done — recorded here so it isn't lost)

### Secrets (Settings → Secrets and variables → Actions)

| Secret | What it is |
| --- | --- |
| `TAURI_SIGNING_PRIVATE_KEY` | The updater signing key — the base64 contents of the `.key` file exactly as `tauri signer generate` wrote it. Do not reformat or re-encode it. |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | The password entered when the key was generated. |
| `WINDOWS_CERTIFICATE` | **Not set yet.** base64 of an Authenticode code-signing `.pfx`. When present, the workflow imports it and Tauri signs both `disruptor-proxy.exe` and the installer. |
| `WINDOWS_CERTIFICATE_PASSWORD` | Its password. Leave unset if the `.pfx` has none. |

Authenticode signing is a *different* trust system from the updater key above: the updater
key stops a tampered update, while the certificate is what stops SmartScreen warning on
every download and what removes the last real ingredient of the
`Trojan:Win32/Bearfoos.B!ml` false positive (see the README). Until it is set, releases go
out unsigned and the workflow says so with a warning annotation rather than failing.
[SignPath Foundation](https://signpath.org/) issues free certificates to OSS projects.

The release itself is published by the default `GITHUB_TOKEN`; no PAT is needed now that
everything lands on this repo. (`ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`,
`ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` sign the APK — without them it builds unsigned
and therefore uninstallable.)

### The signing keypair

Generated with `npm run tauri signer generate -- -w <path>/disruptor.key`. It produced
`disruptor.key` (private) and `disruptor.key.pub` (public). The **public** key is
committed in `src-tauri/tauri.conf.json` under `plugins.updater.pubkey`; the **private**
key + its password are the two `TAURI_SIGNING_*` secrets above.

Back up the private key and password somewhere safe. If you lose them you cannot sign
updates, and — because the public key is baked into every installed app — you'd have to
ship a new keypair and every existing install would stop accepting updates until users
reinstall.

If you ever rotate the key: regenerate, replace `pubkey` in `tauri.conf.json`, update the
`TAURI_SIGNING_PRIVATE_KEY` + password secrets, and cut a fresh release. Only clients that
install the new build will accept updates signed with the new key.

## Troubleshooting

**`failed to decode secret key: ... Missing comment in secret key`** — the
`TAURI_SIGNING_PRIVATE_KEY` secret is malformed. It's a `minisign` parse error, not a
password problem: the value must be the full base64 of the `.key` file, exactly as the
generator printed it. Re-copy it without reformatting. (The build succeeds and only the
signing step fails.)

**`fail_on_unmatched_files` / no `.deb` staged** — the Linux job failed. It blocks the
release on purpose; fix it and re-run. A missing `.apk` does *not* fail the run (that job
is `continue-on-error`), so check whether the APK is actually attached before publishing.

**`latest.json` returns 404 at the `releases/latest` URL** — the release is still a draft.
Publish it. Note that on a **private** repo the updater cannot read `latest.json` at all,
published or not — the repo has to be public for auto-update to work.
