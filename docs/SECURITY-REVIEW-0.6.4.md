# Security review 0.6.4

This review covers the Token Stack integration, its Windows and Unix lifecycle,
the installed pxpipe 0.13.2 runtime, optional evaluation utilities, and the
Native Context Compiler. It records concrete controls and known limits; it is
not a claim that the software is risk-free.

## Runtime supply chain

The installers accept only `pxpipe-proxy@0.13.2` with npm registry integrity
`sha512-utMkpkWAjgQyldB62ebWrTFKhTmMKTiwXIktqbHxLixrtgw/g+r9/0nzG2Vz1prKSvH2Q7x9JNrG4LwEmlHQ+g==`.
They download with scripts disabled, verify the archive's SHA-512 digest and
member paths, and install the verified local archive with a nested dependency
layout. A mismatch fails before the package is trusted.

The runtime verifier then checks:

- the exact pxpipe package name, version, and package manifest hash;
- an aggregate hash, file count, and byte count for every unchanged package
  file outside `node_modules`;
- exact before/after hashes for the ten files created or changed by the runtime
  patch;
- the identity and complete 1,348-file tree of `gpt-tokenizer@3.4.0`, including
  its aggregate hash and byte count.

Only a fully patched runtime with the reviewed dependency tree can start.
Windows and Unix controllers repeat verification on every invocation. The
patcher is itself a managed file with a hard-coded SHA-256 in each installer and
controller. Existing unrelated global pxpipe installations are preserved and
rejected unless they already match the complete hardened state. A legacy
installer-owned 0.6.3 package is replaced through the verified archive path.

## Runtime fixes

Version 0.6.4 applies the reviewed source fixes to the npm runtime actually
executed by the controller. They replace unbounded regular-expression parsing
of model-controlled text with linear scans, forward headers as flat name/value
pairs without computed properties, return fixed upstream failure text, and
prevent credentials from appearing
in startup diagnostics.

OAuth token, export, monitor, and lifecycle reads now open the file first and
validate the open descriptor against the path. They reject links, non-regular
files, multiple hard links, oversized inputs, short reads, and identity or size
changes during the read. The last known valid OAuth token remains available
when a concurrent replacement is incomplete. On Windows, descriptor identities
are compared with later descriptor identities and path identities with later
path identities because Node.js 22 on Windows Server 2025 can report different
IDs across those two APIs.

Optional evaluation tools create random private directories and exclusive
files, contain output paths, cap HTTP response bodies, and use atomic private
writes. The UI vendor script permits only the reviewed HTTPS URL and checks
fixed SHA-256 values before publishing either asset.

## Installation and removal

Windows setup installs official Node.js 24.19.0 LTS plus npm when Node is absent.
The x64 and ARM64 MSI URLs and SHA-256 values are pinned, the downloaded MSI is
verified before execution, and an unsupported existing Node version is never
silently downgraded. Shared Node remains installed during Token Stack removal.
RTK and pxpipe ownership, manager identity, files, shims, runtime patch state,
and rollback intent are recorded before destructive work.

Removal compares the live state with the sealed receipt and preserves later
edits, changed package-manager state, shared tools needed by the sibling stack,
and unrelated global packages. Unix lifecycle files and Windows launcher files
are allowlisted and verified before use.

After a Unix supervisor has been verified and sent its single termination
signal, the controller permits three bounded identity retries while that same
launch exits and removes its receipt. It sends no additional signal during an
ambiguous transition and still fails closed if the receipt does not settle.

## Findings disposition

The 0.6.3 review found that several fixes existed only in vendored TypeScript
while the unmodified npm distribution still ran. That mismatch is closed by the
verified runtime patch and startup gate. Race-prone file reads, predictable
evaluation files, unbounded downloads, unchecked output destinations, and
unpinned UI downloads are also addressed in this release.

Forwarding syntactically valid upstream header names remains intentional proxy
behavior. Node validates names and upgrade values, and flat name/value arrays
avoid computed object properties. The local corpus test opens a descriptor
before measuring and reads at most 8 MiB from that descriptor.

Two CodeQL result categories are classified rather than hidden. The optional
evaluation helper intentionally writes bounded provider responses only to
private, contained evaluation artifacts; those files are data and are never
executed. RTK's explicit `trust --list` command intentionally prints the
user-requested trusted filter path and SHA-256 to its terminal; neither value is
a credential or an application log. RTK's signed winget identity, upstream
source, and receipt rules are unchanged.

## Remaining limits

- A process already running as the same user can alter controllers, patchers,
  receipts, and packages together. The integrity checks detect accidental or
  partial drift; they are not an operating-system sandbox or signed-code trust
  boundary.
- Windows parent directories do not provide an atomic directory sandbox across
  every filesystem operation. Reparse-point checks and descriptor checks reduce
  exposure, but a hostile same-user process remains outside the supported trust
  model.
- The user's fresh Windows x64 system confirms normal installation and runtime
  behavior after Node was installed manually. The automatic real MSI elevation
  path and physical ARM64 hardware are covered by isolated orchestration and
  architecture-selection tests, not a second physical-machine run.
- Tests do not send provider requests or inspect private prompts. Optional
  experimental evaluations remain outside the supported always-on path.
- A registry or package-manager outage can prevent installation. Verification
  fails closed rather than selecting another version or dependency tree.

Validation evidence is recorded in [the 0.6.4 release audit](RELEASE-AUDIT-0.6.4.md).
