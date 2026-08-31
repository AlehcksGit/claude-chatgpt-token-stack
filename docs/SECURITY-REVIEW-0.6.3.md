# Security review for 0.6.3

## Result and scope

This release is **not a zero-finding security certification**. The first CodeQL
scan completed successfully but reported 44 findings against commit
`3035081afd00f87220690ecb563764ffa8f585fd`. They were reviewed by source location
and trust boundary. Findings were not bulk-dismissed or hidden with exclusions.

The supported installer still obtains **pxpipe-proxy 0.13.2 from npm**. It does
not build or install the vendored `upstream/pxpipe` snapshot. Consequently, the
vendored parsing and startup-log fixes below benefit source builds only; they
do **not** patch the installed npm package. The monitor and copied warpd fixes
are in the stack-owned files deployed by Windows setup. Existing installations
are not silently upgraded by publishing this release.

Keep all services on loopback and local state accessible only to your account.
Do not run these services as administrator or expose their ports to a network.
Optional upstream research scripts are not a hardened, supported application.
The remaining risks below should be considered before using those scripts,
changing upstream URLs, or allowing another account to modify local state.

## Findings and disposition

Numbers refer to this repository's GitHub code-scanning alerts.

| Alerts | Review and action |
| --- | --- |
| 1-2 | Bracket-tag removal could repeatedly scan a long unmatched bracket string. The vendored copy now uses a linear scan preserving complete-tag behavior. The npm runtime remains unchanged. |
| 3-7 | Trailing-slash expressions can repeatedly scan adversarial URL strings. Vendored URL normalization now walks backward once. Normal installations obtain these URLs from local configuration; the npm runtime remains unchanged. |
| 8-9 | Branch telemetry expressions could rescan long newline runs. Vendored environment-field parsing now uses line anchors and horizontal whitespace, also covering adjacent environment-field expressions. The npm runtime remains unchanged. |
| 10 | The installed monitor no longer returns exception messages through `/api/state`; failures return a fixed message. |
| 11 | Vendored startup logging no longer prints upstream URLs or model configuration, which could contain credentials. The npm runtime remains unchanged: never embed credentials in upstream URLs. |
| 12-15 | Monitor managed-file checks and reads are separate operations. Another process with write access to those paths can race them. Existing symlink/size checks are useful validation, not an atomic filesystem sandbox. This local race limitation remains. |
| 16 | Monitor log tailing now opens before checking the descriptor, rejects non-files, uses the actual byte count, and closes in a `finally` block even on failure. Non-following/non-blocking flags are used where the OS exposes them. This fixes the stale-path size check and descriptor leak; it does not add an atomic parent-directory sandbox on Windows. |
| 17-22 | Unix lifecycle reads follow checks on ownership, file type, links, and path scope. Those checks do not make later path-based operations atomic. Protect the target home and installation source from concurrent writers; cross-process filesystem race resistance is not claimed. These findings remain. |
| 23 | The optional pxpipe file exporter checks size before reading. Concurrent file growth or replacement can invalidate that check. Use it only on trusted, stable input trees; the source and npm runtime remain unchanged. |
| 24 | A private authentication-token file is read after checking its modification time for caching. Concurrent rotation can momentarily associate content with a stale timestamp. This is not evidence of a remote token disclosure, but the cache/read race remains. |
| 25 | An upstream test stats a fixture before opening it. Its actual read remains capped at 8 MiB and incomplete JSON is skipped. This test-only finding was left unchanged. |
| 26, 28 | Both stack-owned and vendored warpd now build forwarded-header dictionaries without a prototype. Incoming Node HTTP header parsing already rejects the `__proto__` case tested locally; the change also avoids depending on object prototype setters. |
| 27, 29 | Forwarding valid upstream header names is intentional proxy behavior. Node validates HTTP header syntax. Local request/response tests cover ordinary headers, `constructor`, and attempted `__proto__` headers. Upstream connection errors now return fixed text in both copies. |
| 30-34 | The flagged destinations are chosen by local scripts/configuration; HTTP response bodies become file contents, not remotely selected destination paths. Saving evaluation results or fetching dashboard dependencies is intentional. This is not a general path-traversal fix or a claim that downloaded code is trustworthy; these optional scripts remain unchanged. |
| 35-38, 40-42 | Optional upstream evaluation scripts use predictable temporary paths without exclusive creation. This is a real local symlink/clobber risk on shared temporary directories. They are not called by setup or the supported runtime and remain unchanged. Do not run them with sensitive data or elevated privileges; use an isolated disposable environment for research. |
| 39 | The optional evaluation client uses a UUID filename, reducing guessing risk, but does not explicitly request exclusive/private file creation. This remains a confidentiality/temporary-file hardening gap outside the supported path. |
| 43-44 | RTK's explicit trust-list command prints filter paths, trust dates, and content SHA-256 digests. The reviewed values are trust metadata, not passwords or authentication tokens. These findings were assessed as intentional local CLI output; they were not dismissed automatically. |

## Verification and limits

- One [CI run](https://github.com/AlehcksGit/claude-chatgpt-token-stack/actions/runs/33428564944)
  passed its Windows/Linux/macOS, Node-version, provenance, RTK/audit, and
  reproducible-release jobs on `3035081`.
- One [CodeQL run](https://github.com/AlehcksGit/claude-chatgpt-token-stack/actions/runs/33428567628)
  analyzed Actions, JavaScript/TypeScript, and Rust on that same commit. A green
  workflow means analysis completed; it does not mean there were no findings.
- The subsequent security-source changes passed all 1,209 pxpipe tests locally,
  TypeScript checking, build/version smoke checks, monitor access-control tests,
  and warpd process-identity tests. New regressions exercise 500,000-character
  adversarial input in a worker with a deadline and both proxy-header copies.
- To honor the maintainer's request to limit Actions usage, the platform matrix
  and CodeQL were not rerun after these follow-up changes. GitHub's alert state
  therefore describes the scanned commit, not a verified final zero-alert state.
  Actions were restored to disabled before the final push and merge.
- No fresh Windows VM/UAC/MSI installation, physical ARM64, live model A/B,
  concurrent-filesystem attack test, or upstream npm package modification was
  performed. See [the release audit](RELEASE-AUDIT-0.6.3.md) for other limits.
