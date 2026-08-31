# Migration to 0.6

Version 0.6.3 keeps normal Work traffic on native Codex. It disables the
automatic Lean/app-server bridge and installs four low-latency hooks for a
routine turn budget, RTK, receipts/evidence, and post-compaction guidance.
It does not restore the retired API/provider proxy architecture.

| Retired state | 0.6 replacement |
|---|---|
| Codex pxpipe/provider routing | Native Codex lifecycle hooks |
| `codex-px` network launchers and provider proxy | Native Codex hooks; normal Work composer |
| Prompt-only RTK convention | Native `PreToolUse` RTK rewrite |
| Advisory plugin | Managed AGENTS.md block + hooks |
| Unbounded output in model context | PostToolUse receipt + local evidence |
| Separate Lean-only workflow | Disabled research path plus manual diagnostics and guarded A/B |

Migration backs up and removes only exact project-owned legacy entries. It
preserves unrelated hooks, Codex settings, plugins, models, user-authored
AGENTS.md content, authentication, and local tasks.

No legacy API-key transport, provider proxy, usage-billed request, or hidden
summarizer call is used by the supported path. ChatGPT subscription
authentication and model execution remain owned by Codex.

After installation, restart ChatGPT/Codex and review `/hooks`. Trust is tied to
the exact four hook definitions, so a later hook update requires review again.
