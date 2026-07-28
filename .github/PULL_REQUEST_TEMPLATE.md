## What does this change?

<!-- What the change does, and why. If it closes an issue, write "Closes #123" here. -->

## How was it verified?

<!-- Not "it typechecks" - what did you actually exercise, and where?
     e.g. "Connected and disconnected 5x on Windows 11 with VLESS+REALITY, watched the
     traffic counters move, confirmed no orphan core process after quitting." -->

- Tested on: <!-- Windows / Linux / macOS / Android, and the version -->

## Screenshots

<!-- For anything visual. If it changes layout, include both LTR and RTL (switch to Persian
     in Settings). Delete this section if it isn't a UI change. -->

## Checklist

- [ ] `npm run check` passes (typecheck + lint).
- [ ] `cargo check` passes, if I touched `src-tauri/`.
- [ ] I ran the real app (`npm run desktop`), not just the browser build.
- [ ] Commits follow [Conventional Commits](https://www.conventionalcommits.org/) - they become
      the release notes.
- [ ] New user-facing strings are in `src/lib/i18n/` and added to **every** locale.
- [ ] Layout still works right-to-left (Persian / Arabic), if I touched UI.
- [ ] No credentials, server addresses, or subscription URLs in code, comments, logs, or this
      description.
- [ ] No dead code or compatibility shims left behind.
