# 0.6.3 release audit

Reviewed 2026-08-31. This is a source review and isolated automated verification,
not a guarantee that every machine, application update, or configuration works.
No installer was run against the maintainer's active Claude/Codex configuration.
No live model evaluation, credential migration, or paid API request was performed.

## Changes from the review

- Both Windows setup entry points bootstrap missing Node.js/npm from the pinned
  official Node.js 24.19.0 x64/ARM64 MSI, verify SHA-256 before execution, refresh
  the current process PATH, then verify Node and npm. Existing compatible Node is
  retained. Unsupported Node or missing npm fails without replacing it.
- Codex-only setup provisions missing RTK 0.45.0 from the official winget source.
  Existing incompatible RTK is preserved. Shared prerequisites are not removed
  by Codex uninstall. Claude's explicit tool cleanup checks native Codex hooks
  before removing its own RTK installation.
- Fixed Codex uninstall's obsolete function call, stale installation receipt,
  and deletion of unrelated handlers in mixed hook groups. Added a real isolated
  uninstall integration test in addition to the existing pure-function tests.
- OpenAI dry-run no longer needs Node. The legacy migration switch works, the
  final CLI check uses the receipt's path, and setup reminds users to trust hooks.
- Legacy task names alone no longer authorize deletion. Task XML is backed up
  for review. Unknown legacy launcher contents are preserved.
- The installed Claude maintenance menu opens without the absent Codex payload;
  it gives an actionable message for operations needing the full release.
- Corrected the pxpipe source commit notice and the SBOM's integration license;
  the personal-use license is unchanged. Node's bootstrap pin is included in the
  SBOM. Upstream source snapshots and runtime dependency pins remain unchanged.

## Verification

The release checks cover the following. The pull request's GitHub Actions runs
are the authoritative platform-by-platform result; do not interpret this list
as a claim of a fresh physical-machine installation on every architecture.

- Windows PowerShell 5.1 and 7: version contracts, missing prerequisites,
  checksum rejection, stale PATH, dry run, setup exit/output behavior, rollback,
  collision preservation, package inventory, both uninstall orders, native NCC
  dependency preservation, runtime ownership, and cross-engine receipts.
- Claude runtime tests use fake package managers, isolated profiles, temporary
  ports, and test scheduled-task providers. Monitor access-control and warpd
  process identity tests are included.
- Native Context Compiler: unit and integration tests, offline benchmark safety
  gates, evidence round trips, user-detail preservation, and package dry run.
- Vendored pxpipe: TypeScript checks, 1,203 tests, source build/version smoke
  check, and production dependency vulnerability audit.
- All unpatched vendored files are compared with immutable upstream commits:
  540 pxpipe files, 34 claude-token-efficient files, and 408 RTK files.
- Release policy checks include JSON/PowerShell validity, pinned actions and
  dependencies, source links, secrets patterns, provenance, and forbidden files.
  Two independent archive builds must produce identical SHA-256 hashes.
- GitHub CI additionally exercises Linux/macOS lifecycle scripts, the supported
  Node matrix, and RTK's Rust tests/security audit on its configured platforms.

## Practical limits and follow-up

- The Node bootstrap's process orchestration is tested with isolated providers.
  This audit does **not** claim a clean Windows VM/UAC/MSI installation test or a
  physical ARM64 run. Administrator consent, internet access, Windows Installer,
  and Microsoft App Installer for RTK are prerequisites. Cancellation stops setup.
- Node is a shared machine prerequisite. An unsuccessful later stack operation
  leaves successfully installed Node in place. Remove it through Windows Apps
  only if no other software needs it. No automatic downgrade is attempted.
- PowerShell 5.1 has path-length limits. Extract the release to a short local
  path if Windows reports a path-too-long error; do not use a deeply nested home.
- The pinned pxpipe 0.13.2 runtime can warn about Claude's `browser_surfaces`
  static tag. The tag is preserved and the warning alone does not indicate proxy
  failure. This release does not patch or suppress that upstream diagnostic.
- Existing legacy scheduled tasks whose ownership cannot be established require
  human review of their backed-up action before retirement. Changed hooks need
  a fresh review/approval in Codex; the installer does not bypass that trust gate.
- Experimental whole-turn evaluation remains opt-in. Offline token savings are
  not a prediction of real task quality, subscription cost, or end-to-end speed.
