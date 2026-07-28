# Contributing

Thanks for wanting to help. This is the source repository for Disruptor Proxy - the app, the
Rust host, and the release pipeline all live here.

Found a security problem? Do not open an issue. See [SECURITY.md](SECURITY.md).

## Getting set up

You need **Node 24+**, a **stable Rust toolchain**, and the
[Tauri 2 system dependencies](https://tauri.app/start/prerequisites/) for your OS.

```
npm ci
npm run fetch-core        # downloads + checksum-verifies the Xray core for your platform
npm run desktop           # the real app, in dev mode
```

`npm run dev` alone runs just the frontend in a browser. That is fine for UI work, but every
Tauri API no-ops there - anything touching the proxy engine, geo files, the tray, or the
updater has to be tested through `npm run desktop`.

| Script | Does |
| --- | --- |
| `npm run dev` | Frontend only, in a browser |
| `npm run desktop` | Full desktop app in dev mode |
| `npm run check` | `azeroth check` - typechecks **and** lints in one pass. This is the gate. |
| `npm run lint:fix` | ESLint with autofix |
| `npm run build` | Production frontend build |
| `npm run desktop-build` | Full production build (installer) |

## Before you open a pull request

```
npm run check
```

That has to pass. CI runs the same thing, plus a build on every platform, so a red `check`
locally is a red PR. If you touched Rust, `cargo check` inside `src-tauri/` too.

Test what you changed in the actual app (`npm run desktop`), not just in the browser. For
anything touching connect, disconnect, or the server list, say in the PR what you exercised
and on which OS - a green typecheck says nothing about whether traffic still flows.

## Commit messages

**[Conventional Commits](https://www.conventionalcommits.org/) are required.** This is not
bikeshedding: release notes are generated from commit messages by git-cliff during the release
run, so a vague message becomes a vague changelog entry that users read.

```
feat: add per-server latency history
fix(routing): keep GeoIP rules when the geo files are missing
perf: cache the collator used by the server sort
docs: explain the updater signing key
```

`feat`, `fix`, and `perf` become "Features", "Bug Fixes", and "Performance" in the release
notes. `ci:`, `chore(release):`, and `chore(deps):` are filtered out; other `chore:` entries
land under "Miscellaneous". Use `!` or a `BREAKING CHANGE:` footer for anything that changes
behaviour users depend on.

## Code style

ESLint enforces most of this - run `npm run lint:fix` and it will sort itself out. The parts
it cannot check:

- **4-space indent, Allman braces, single quotes, semicolons, LF line endings.** No trailing
  whitespace. The ESLint config is the authority.
- **Import order.** Imports are grouped, each group separated by one blank line, in this
  order: side-effect imports, `node:` builtins, `azerothjs` / `@azerothjs/*`, other
  third-party, then internal by layer - `lib`, `workers`, `stores`, `components`, `features`,
  `app`, `pages`. Within a group, sort by module path, and put a value import before its
  `import type` twin.
- **Comments explain why, not what.** The existing code is written that way; match it. A
  comment restating the line below it will be asked about in review.
- **No dead code, no compatibility shims.** If something is being replaced, delete the old
  thing in the same PR.
- **Plain ASCII in docs and comments.** Use `-`, not an em dash.

## Things worth knowing before you change them

- **The server list is virtualized.** It is built to stay smooth at thousands of rows, so a
  row must read its live values rather than capture them, and rows are never animated on
  mount. If you make per-row work more expensive, say so in the PR.
- **Motion is CSS-first.** Animations live in `src/styles.css` and go through the duration and
  easing tokens (`--g-dur-*`, `--g-ease-*`) - do not hard-code a duration or curve. A single
  global `prefers-reduced-motion` block zeroes everything, so new animations need no
  per-component guard.
- **The app ships an RTL locale.** Persian and Arabic run right-to-left. Use logical CSS
  properties (`inset-inline-start`, not `left`) and check your change in both directions.
- **Every user-facing string is translated.** Strings live in `src/lib/i18n/`, typed by a
  `Strings` interface - a locale missing a key is a build error, not a silent English
  fallback. Adding a string means adding it to the interface and to every locale.
- **Never log credentials.** Config URIs carry passwords, UUIDs, and REALITY keys. Error paths
  truncate to a safe snippet on purpose; keep it that way.

## Pull requests

Keep them focused - one concern per PR. Unrelated cleanup in the same branch makes a change
hard to review and hard to revert.

Fill in the template: what changed, why, and how you verified it. Screenshots or a short clip
for anything visual, and mention the OS you tested on. Maintainers may ask for changes; that
is a normal part of review, not a rejection.

By contributing, you agree that your contributions are licensed under the
[MIT License](LICENSE).
