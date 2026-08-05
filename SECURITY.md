# Security policy

Disruptor Proxy is a censorship-circumvention tool. For many of the people who use it, a
vulnerability is not an inconvenience - it is a real risk. Reports are taken seriously and
handled privately until there is a fix users can install.

## Reporting a vulnerability

**Do not open a public issue for a security problem.**

Use GitHub's private reporting instead: go to the
[Security tab](https://github.com/DisruptorProxy/Core/security/advisories/new) and open a
draft advisory. It is visible only to the maintainers, and it lets us credit you and publish
an advisory alongside the fix.

Useful things to include, as far as you can:

- What an attacker can actually do with it, and what access they need to start.
- Steps or a proof of concept.
- The version you tested (Settings > About) and the platform.
- Whether it is already public anywhere.

You will get an acknowledgement that the report was received. After that, expect
irregular-but-honest updates rather than a formal SLA - this is a small project, and
promising a response window it cannot keep would help nobody.

## What is in scope

Anything in this repository: the AzerothJS frontend, the Rust host in `src-tauri/` that
launches and supervises the core, the generated Xray configuration, the updater wiring, and
the release workflow.

Reports that matter most here:

- **Traffic leaks** - anything that sends traffic outside the tunnel while the app reports
  it as connected, or that leaks DNS, or that survives a disconnect.
- **Credential exposure** - server credentials, subscription URLs, or REALITY keys being
  written to logs, error text, crash output, or anywhere on disk they should not be.
- **The elevated path** - the core needs administrator rights to open the TUN adapter and
  rewrite the route table. On Windows the whole app runs elevated (its manifest requests
  `requireAdministrator`) and the core inherits that; on Linux the host elevates the core
  alone through `pkexec`. Anything that turns either into arbitrary code execution or
  privilege escalation is high severity - and on Windows that now includes anything the
  *frontend* can reach, since the webview's host process is the elevated one.
- **Update integrity** - anything that lets an unsigned or substituted build be accepted by
  the auto-updater.

## What is out of scope

- **Xray-core itself.** The proxy engine is [XTLS/Xray-core](https://github.com/XTLS/Xray-core),
  a separate upstream project. Report core protocol issues to them; if the bug is in how this
  app *configures* the core, that is in scope here.
- The fact that a proxy server operator can see your traffic. Choose operators you trust.
- Findings that require an attacker who already has administrator access to the machine, or
  physical access to an unlocked one.
- Automated scanner output with no demonstrated impact.

## Supported versions

Only the latest release is supported. The app ships an auto-updater and installs updates in
place, so fixes reach users through a normal release rather than a backport.

| Version | Supported |
| --- | --- |
| Latest release | Yes |
| Anything older | No - update first |

## How releases are protected

Every release artifact is signed with a minisign keypair, and the public key is compiled into
the app (`src-tauri/tauri.conf.json`, `plugins.updater.pubkey`). The updater refuses any
payload that does not verify against it, so a tampered download cannot be installed as an
update. The private key exists only as an encrypted GitHub Actions secret and is never in the
repository.

Downloads should come from
[this repository's releases](https://github.com/DisruptorProxy/Core/releases). Builds from
anywhere else are not ours and are not signed by us.