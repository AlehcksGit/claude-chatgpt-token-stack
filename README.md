# Claude–ChatGPT Token Stack 0.6.2

A local, source-available token-reduction stack for Claude and ChatGPT Work/Codex on Windows.

- **Claude:** the established CLAUDE.md + RTK + pxpipe/warpd image path is unchanged.
- **ChatGPT Work/Codex:** normal Work tasks stay on the native OpenAI path. Four lightweight hooks reduce supported command output, oversized tool results, and routine response verbosity without starting another model turn.
- **No workflow switch:** after installation, hook trust, and one app restart, users keep typing in the normal local Work composer.

## Scope and cost

The OpenAI side targets local **Work** tasks for users with ChatGPT Pro or an eligible higher-tier workspace subscription. Ordinary Chat conversations, remote/cloud tasks, and API-key usage are not covered. It uses the existing subscription session, adds no API key or usage-billed API request, and preserves the model and reasoning effort selected in the app when Codex exposes them.

Version 0.6.2 does not modify or restart Claude, pxpipe, warpd, the shared monitor, or the Claude/UE5 workflow when only the OpenAI installer is run.

## What the automatic Work stack does

1. A short managed block in `~/.codex/AGENTS.md` reduces unnecessary narration and preserves high-value state.
2. A native `PreToolUse` hook asks RTK to rewrite supported shell commands. Unsupported commands pass through unchanged.
3. A native `PostToolUse` hook replaces oversized model-visible results with deterministic receipts while storing the exact result received by the hook locally.
4. `ncc evidence-find` and `ncc evidence-slice` recover only the needed evidence. Full recovery remains available with `ncc evidence-get`.
5. A non-blocking `UserPromptSubmit` hook adds a small per-turn budget for routine answers. Explicit requests for depth, tutorials, audits, or exhaustive detail are not capped.
6. A `SessionStart` hook matching `compact` restores the concise operating policy after Codex compacts a long task.

EvidenceVault is exact from the `PostToolUse` boundary onward. If Codex has
already truncated a process result before emitting that event, bytes omitted by
Codex cannot be recovered by a downstream hook.
Sanitized monitor telemetry reports rewrites, receipt-level reductions, and historical guarded A/B results without exposing prompts, commands, answer bodies, session IDs, or evidence content. Installer probes are labeled and excluded from normal-use totals.

The hooks fail open. If RTK or the compiler cannot process a call, Codex receives the original command or result.

## Measured results

A native Codex 0.149.0 canary A/B used the same `gpt-5.6-sol` model, low reasoning effort, and a 2,000-line tool result:

| Arm | Native input tokens | Hidden canary visible to model |
|---|---:|---|
| Control | 41,925 | yes |
| Automatic PostToolUse receipt | 30,789 | no |
| Difference | **11,136 saved (26.56%)** | exact hook input retained locally |

This proves the hook replaced the model-visible result. Client event streams can still display the completed command's raw output; that display is not proof that the model received it.

The now-disabled whole-turn Lean experiment measured:

| Fixture | Control total | Lean total | Saved | Quality gate |
|---|---:|---:|---:|---|
| Medium history | 27,718 | 10,393 | 62.50% | exact |
| Long history | 59,905 | 8,778 | 85.35% | exact |

The whole-turn experiment is retained only as research data because its synchronous nested model turn caused unacceptable latency. Version 0.6.2 does not enable it or install its launcher. The new turn budget adds no model call and has not yet been assigned a savings percentage; its effect must be measured separately from the receipt A/B.

## Install

Requirements: Windows 10/11, Node.js 22.7+ or 24.x, ChatGPT/Codex desktop or CLI, and the normal Claude prerequisites when installing the Claude side.

```powershell
.\setup.cmd install-all
```

OpenAI side only:

```powershell
.\setup.cmd install-openai
```

After installation, restart ChatGPT/Codex, open `/hooks`, review the four Native Context Compiler hooks, and trust them once. Codex owns hook approval and invalidates trust when a hook definition changes. Then use local Work tasks normally.

The guarded `hook-eval` uses Codex's explicit one-invocation trust bypass
inside disposable homes so it can test the hook code before approval. A
passing A/B does not approve the installed hook. `/hooks` must show **Active 4,
Review 0** for fresh normal tasks.

The installer preserves unrelated hooks, model settings, plugins, and user-authored AGENTS.md content. It backs up files before changing project-owned sections.

## Commands and settings

```powershell
ncc --version
ncc status
ncc settings
ncc budget on
ncc budget off
ncc budget status
ncc evidence-find <handle> "pattern"
ncc evidence-slice <handle> --start-line 120 --lines 60
ncc lean --prompt "your task"
ncc benchmark
```

From the Native Context Compiler source directory, an opt-in guarded native
hook A/B is available when every other subscription client is idle:

```powershell
npm run hook-eval -- --model <your-codex-model> --effort low --claude-idle
```

`ncc settings` prints the editable local settings path. RTK, receipt compaction, and the turn budget can be independently controlled there. `leanBridge.enabled` remains false in the supported low-latency configuration; `ncc lean` is retained only as a manual diagnostic.

The optional Personalization paragraph is in [docs/PERSONALIZATION.md](docs/PERSONALIZATION.md). The installer does not alter ChatGPT Personalization.

## Local monitors

| Address | Purpose |
|---|---|
| `http://127.0.0.1:47821/` | Claude pxpipe |
| `http://127.0.0.1:47822/healthz` | Claude warpd health |
| `http://127.0.0.1:47823/` | Combined Claude + Codex monitor |
| `http://127.0.0.1:47831/` | Focused Codex Work stack dashboard |

One hidden monitor process owns 47823 and 47831. All listeners bind to loopback; 47831 is never a model proxy. Tables scroll or wrap instead of running off the page.

The Codex cards distinguish three states: **installed** means the four hook definitions exist, **live** means a real non-probe hook was observed in the last 15 minutes, and **verified · idle** means retained measurements prove the feature worked previously but do not prove it is firing now. `SessionStart` is expected only after Codex compacts a task, so normal healthy activity commonly shows three of four events. `/hooks` remains the authoritative trust view and must show **Active 4, Review 0**.

## Important limitations

- The whole-turn Lean/app-server bridge is disabled and its `CODEX_CLI_PATH` override is removed. Normal Work turns remain native.
- Claude pxpipe image compression remains unchanged.
- Codex 0.149 may show a blocked/failed wrapper when `PostToolUse` replaces a result. The command already ran; only its oversized output was replaced. The receipt states the real exit status.
- Hook trust is a required one-time user review. The installer does not silently approve executable hooks.

## Public source release warning

The release archive is source-only: no compiled executables, DLLs, native modules, fonts, images, or prebuilt runtime bundles are included. The old experimental bridge source remains available for audit and research but is not compiled, installed, or registered by the 0.6.2 installer. Review the source, backups, hooks, and settings before trusting executable hooks.

See [docs/HOW-IT-WORKS.md](docs/HOW-IT-WORKS.md), [docs/SECURITY-MODEL.md](docs/SECURITY-MODEL.md), and [openai/native-context-compiler/docs/OFFLINE-RESULTS.md](openai/native-context-compiler/docs/OFFLINE-RESULTS.md).

## Uninstall

```powershell
.\setup.cmd uninstall-openai
```

The uninstaller restores the previous user-level `CODEX_CLI_PATH`, removes only project-owned hook groups and the managed AGENTS.md block, and preserves local sessions, bridge replies, evidence, settings, and sanitized metrics unless `-RemoveData` is explicitly used.
