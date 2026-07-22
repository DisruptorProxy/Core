# Releasing The Disruptor Proxy

How a version gets from this repo to users, and the one-time setup that makes it work.

## The shape of it

Two repositories are involved:

- **`DisruptorProxy/Core`** (private) — the source, and where the release workflow
  runs. Building happens here.
- **`DisruptorProxy/Xray-Client`** (public) — download-only. Real users and the
  auto-updater fetch from here. Nothing is built here.

Pushing a `v*` tag to Core triggers `.github/workflows/release.yml`, which builds and
signs once, then publishes a **draft** release to *both* repos. The Xray-Client draft
is the one that matters to users — `tauri.conf.json`'s updater endpoint points at
`Xray-Client/releases/latest/download/latest.json`.

Drafts are invisible to anonymous downloads and to the updater (`releases/latest` only
resolves to a *published* release), so a bad build never reaches anyone until you
publish it by hand.

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

1. Watch the **Actions** tab on Core until the `Release` run is green (~14 min).
2. Open **Xray-Client → Releases**, review the draft, and **Publish** it. (Publish the
   Core draft too if you want the internal record public; it's optional.)
3. Verify (below).

## Release notes

Notes are generated automatically from your **Conventional Commits** by git-cliff
(`cliff.toml`) during the CI run — there is no hand-maintained `CHANGELOG.md`. The same
generated notes are spliced into all three surfaces: the Core release body, the
Xray-Client release body, and the updater's in-app `notes`.

What this means day to day:

- Write commits as `feat: …`, `fix: …`, `perf: …`, etc. Those become the "Features",
  "Bug Fixes", "Performance" sections. `ci:`, `chore(release):`, and `chore(deps):` are
  skipped; other `chore:` land under "Miscellaneous".
- Nothing extra to do at release time — `npm run release` tags, CI runs git-cliff over
  the commits since the previous tag, and fills the notes in.
- To change grouping or wording, edit `cliff.toml`'s `commit_parsers` / `body` template.

## Verifying a published release

After publishing the Xray-Client draft:

- `https://github.com/DisruptorProxy/Xray-Client/releases/latest/download/latest.json`
  returns JSON with the new `version` and a `platforms.windows-x86_64.url` pointing at
  `Disruptor-Proxy_<version>_x64-setup.exe`.
- That URL actually downloads the installer.

The auto-update path itself is only exercised when a *newer* release exists than what's
installed — so the first version a user can update *to* is the one after their install.

## One-time setup (already done — recorded here so it isn't lost)

### Secrets (Core → Settings → Secrets and variables → Actions)

| Secret | What it is |
| --- | --- |
| `TAURI_SIGNING_PRIVATE_KEY` | The updater signing key — the base64 contents of the `.key` file exactly as `tauri signer generate` wrote it. Do not reformat or re-encode it. |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | The password entered when the key was generated. |
| `CLIENT_REPO_TOKEN` | A token that can write to Xray-Client. The default `GITHUB_TOKEN` can only touch the repo the workflow runs in (Core), so this is the only way the mirror step reaches Xray-Client. Either a fine-grained PAT scoped to **only Xray-Client** with **Contents: Read and write**, or a classic PAT with the **`repo`** scope. |

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

**`Error: Parameter token or opts.auth is required`** — `CLIENT_REPO_TOKEN` is empty or
unset. The build and signing pass; only the Xray-Client mirror step fails.

**`403` on the mirror step** — the token exists but can't write to Xray-Client. Check its
scope, and if the org enforces SAML SSO, authorize the token for `DisruptorProxy`.

**`latest.json` returns 404 at the `releases/latest` URL** — the Xray-Client release is
still a draft. Publish it.
