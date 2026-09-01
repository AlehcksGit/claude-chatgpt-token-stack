# Native architecture

> **0.6.4 supported runtime:** native Codex plus UserPromptSubmit, PreToolUse,
> PostToolUse, and SessionStart. The launcher and app-server bridge are retained
> only as disabled research code.

## Automatic local Work path

```text
Codex Work task
  -> UserPromptSubmit
       -> routine prompt: short response/progress budget in additionalContext
       -> explicit detail request: preserve requested depth
       -> never block, reroute, or start another model
  -> managed AGENTS.md policy
  -> PreToolUse Bash hook
       -> RTK rewrite when supported
       -> original input on unsupported/error/timeout
  -> host executes the command or tool
  -> PostToolUse hook
       -> original small result, or
       -> deterministic receipt + content-addressed EvidenceVault object
  -> bounded evidence search/slice when needed
  -> SessionStart(source=compact) restores the short policy after compaction
```

Codex remains the owner of model execution, authentication, model selection,
reasoning effort, sandboxing, and subscription usage. The supported path opens
no model proxy, includes no API-key transport, and adds no model call.

The installer creates four exact project-owned hook groups plus a marked
`AGENTS.md` block. Reinstallation is idempotent. Uninstallation removes only
those entries, restores any previous user-level `CODEX_CLI_PATH`, and preserves
unrelated hooks and user-authored guidance.

## Turn-budget semantics

The UserPromptSubmit hook returns only documented `additionalContext`. It never
returns a blocking decision in supported mode. The context asks Codex to batch
independent checks, avoid repeated raw output and play-by-play narration, and
keep routine answers bounded. Explicit requests for a deep dive, exhaustive
review, tutorial, audit, or detailed steps are classified as detailed and are
not given the routine final-answer cap.

Metrics record the classification and configured limits, not prompt text.

## PostToolUse replacement semantics

For supported oversized results, the hook returns `decision: "block"` with a
replacement reason containing the receipt. Codex 0.149 uses that reason as the
model-visible tool response. The command has already run; the decision replaces
the result, not command execution. A client can still display the raw completed
command output even though a hidden-canary A/B proved the optimized model did
not receive it.

## Evidence and telemetry invariants

Each replaced hook-visible output is stored exactly once under a SHA-256 handle.
The receipt contains bounded metadata and recovery commands. Search and slice
use a line-oriented output view for wrapped JSON and return only requested
lines; full recovery returns the byte-exact stored hook value.

Telemetry records counts, sizes, filter names, event health, command-family
fingerprints, and evaluation verdicts. It excludes prompt text, command text,
answers, credentials, and evidence content.

## Disabled whole-turn research

The deterministic history compiler, Lean session runner, and app-server bridge
remain for controlled research. Version 0.6.4 does not install or register the
bridge, does not set `CODEX_CLI_PATH`, and keeps `leanBridge.enabled` false. The
path is excluded from normal local Work because its synchronous nested turn
added unacceptable latency.
