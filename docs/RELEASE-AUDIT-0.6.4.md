# Release audit 0.6.4

This audit records the final checks for the 0.6.4 source and release archive.
It supplements the [security review](SECURITY-REVIEW-0.6.4.md).

## Installation evidence

- The user reports that the complete stack works on this fresh Windows x64 PC.
  Node.js LTS was installed manually before this release; no other repair was
  needed.
- An isolated Windows installation used a private target home and npm prefix.
  It downloaded the official pxpipe archive, verified the registry integrity,
  installed the exact nested dependency tree, applied the runtime patch, wrote
  its managed verifier and receipt, and completed without touching the active
  global package.
- The existing missing-Node test suite covers x64/ARM64 selection, pinned MSI
  checksums, repeated setup, stale PATH refresh, npm absence, installer failure,
  version bounds, and dry-run behavior. It does not substitute for a physical
  MSI/UAC run on this already-configured PC.

## Local validation

- pxpipe TypeScript check: passed.
- pxpipe tests: 1,214 passed across 78 files.
- pxpipe production dependency audit: no known vulnerabilities at the configured
  high-severity threshold.
- pxpipe source build and `--version` smoke check: passed.
- Isolated archive/runtime test: official SHA-512 and archive paths passed;
  original, patched, repeat, CLI, large-input, unlisted-file tamper, and
  dependency-tree tamper cases passed.
- Unix lifecycle under Git Bash: 12 cases passed, with the two native-kernel
  process tests explicitly skipped on Windows. Linux and macOS run those cases
  in CI.
- The complete Windows matrix passed under Windows PowerShell 5.1 and
  PowerShell 7, including cross-engine receipts. Controller integration runs
  the real hardened package and verifies proxy, warp, monitor, port separation,
  process ownership, task receipts, settings rollback, and secret filtering in
  an isolated profile.
- The final ZIP and CycloneDX SBOM reproduced byte-for-byte across two builds.
  Their checksums, archive structure, extracted release policy, and a fresh
  installation directly from the ZIP all passed locally.

## Release gates

The release is published only after the complete local policy, provenance,
Windows PowerShell 5.1/7, Unix, Native Context Compiler, pxpipe, RTK, archive,
and CodeQL gates pass for the final commit. GitHub run links and artifact hashes
are added to the release notes generated from that final commit.

## Scope limits

No validation sends a model request or exposes private prompts, credentials,
logs, or receipts. Generated release archives exclude those files. Physical
ARM64 and a fresh automatic Windows MSI elevation remain the two hardware-level
paths not repeated for this release.
