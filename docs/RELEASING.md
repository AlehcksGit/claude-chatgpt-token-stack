# Releasing 0.6.x

> **0.6.3 change:** release verification must confirm that `CODEX_CLI_PATH` is
> restored, Lean is disabled, and four lightweight hooks remain installed.

Release from a clean reviewed copy, never from a live installation directory.
The archive is source-only and all public claims must retain their measurement
boundary.

## Required checks

From the repository root:

```powershell
Push-Location .\openai\native-context-compiler
npm ci
npm test
npm run benchmark
npm pack --dry-run
Pop-Location

.\tests\claude-windows\run-tests.ps1
.\tools\verify-vendored-sources.ps1
.\tools\test-release-policy.ps1
```

The native hook and Lean A/B evaluations are opt-in live checks. Run them only
with other subscription clients idle, an explicit model and effort, isolated
temporary state, and all invalidation gates enabled. Never replace a failed
or missing live result with a tokenizer estimate.

```powershell
npm run hook-eval -- --model <explicit-model> --effort low --claude-idle
npm run live-eval -- --model <explicit-model> --effort xhigh --claude-idle --lean
```

## Build

```powershell
.\tools\build-release.ps1 -OutputDirectory C:\path\to\release-ready
```

Inspect every ZIP entry before publication. Reject the release if it contains
credentials, logs, receipts, evidence, databases, archives, executables,
DLLs, native modules, fonts, images, or prebuilt runtimes. Verify both SHA-256
sidecars and retain the generated CycloneDX SBOM.

On Windows, also install from the built source archive into a clean test user
profile. Verify that `CODEX_CLI_PATH` is absent or restored, `ncc status`
reports Lean disabled and the turn budget enabled, `/hooks` lists four reviewed
groups, a routine UserPromptSubmit returns only `additionalContext`, and an
explicit detail fixture remains uncapped. Verify the previous environment value
remains restored.

After the routine prompt, verify `ncc status` and the local dashboard report a
recent real `UserPromptSubmit` event. Run one native shell tool and verify
PreToolUse/PostToolUse are recent. Installer probes must be marked as probes,
excluded from usage totals, and must never make an idle stack appear live.
`SessionStart` is not required until an actual host compaction occurs.

## Public notes

The release page must state:

- local Work/Codex only; ordinary Chat is not covered;
- ChatGPT Pro or an eligible higher-tier workspace subscription is assumed;
- no API key, provider proxy, usage-billed API call, or added model call is used;
- native hooks require one-time user review and may break on future versions;
- 26.56% is a complete-turn canary result for one large output, while 62.50%
  and 85.35% are guarded Lean whole-turn fixtures, not universal guarantees;
- the archive is source-only and may not work on every system.

Do not publish a release while any test, provenance check, archive inspection,
or documentation claim is unresolved.
