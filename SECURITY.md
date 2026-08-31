# Security policy

## Supported release

Version 0.6.x is supported. Earlier private, 0.2.x, 0.3.x, 0.4.x, or 0.5.x builds
should be upgraded with the 0.6.3 installer so obsolete Codex provider state
is retired and the reviewed native Work hook stack is installed safely.

## Reporting

Do not post credentials, private evidence, request bodies, or exploit details in
a public issue. Use GitHub private vulnerability reporting for this repository.
Include the release version, operating system, affected component, reproduction
steps using non-sensitive fixtures, and expected impact.

## Sensitive local files

Never attach these without reviewing and redacting them:

- `~/.codex/auth.json` or provider credentials;
- Claude/Codex settings and hook files;
- `%LOCALAPPDATA%\NativeContextCompiler\vault` evidence;
- pxpipe event/log files, receipts, baselines, or backups;
- generated `.env`, certificate, key, database, or log files.

The public release archive excludes those patterns. See
[the detailed security model](docs/SECURITY-MODEL.md).

## Scope

Security reports should concern this integration, its installers, monitor,
Native Context Compiler, or documented patches. Upstream-only defects should be
reported to the corresponding upstream project unless this repository's pinned
snapshot or integration creates the issue.
