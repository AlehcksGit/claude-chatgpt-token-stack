# Claude–ChatGPT Token Stack

Local tooling that makes Claude Code and ChatGPT Codex subscriptions go further by stripping input the models never needed to read. Windows only, source-available, runs entirely on your machine. Current release: 0.6.2 (see [CHANGELOG.md](CHANGELOG.md)).

## The problem

Coding agents spend most of your usage cap on *input* tokens, and a lot of that input is junk: hundreds of lines of build noise from one shell command, a 2,000-line tool result the model quotes three lines from, narration nobody asked for. You pay for all of it.

## What this stack does

It sits locally between the apps and the models and removes that waste before it is sent.

- **Same workflow.** You keep typing in Claude Code and the normal local Codex Work composer. No new UI, no new service.
- **Nothing leaves your machine differently.** It uses your existing subscription session. No API key, no usage-billed API requests, no third-party endpoints.
- **Fails open.** If any component cannot process a call, the model receives the original command or result unchanged.

## Measured savings

| What | Result |
|---|---|
| Oversized Codex tool result replaced by a receipt (native Codex 0.149.0 A/B, same model, same task) | **11,136 input tokens saved (26.56%)** — 41,925 vs 30,789 |
| Shell output rewritten by RTK | up to 90% of the command output the agent reads |

The receipt A/B is proof the *model* received the smaller input; the client can still display the raw output, and the exact original result is retained locally and recoverable. RTK's figure is per-command output, not your total bill. A retired whole-turn experiment measured 62.50–85.35% savings but added unacceptable latency; it ships as research data only and is never installed or enabled. Full data: [openai/native-context-compiler/docs/OFFLINE-RESULTS.md](openai/native-context-compiler/docs/OFFLINE-RESULTS.md).

## How it works

**Claude side**

- **RTK** (Rust CLI proxy) rewrites supported shell commands so the agent reads a filtered result instead of raw output.
- **pxpipe** (local proxy, with its `warpd` helper) re-renders bulky conversation context into compact images on the way to the API; the model still reads everything.
- A token-efficient `CLAUDE.md` rule set keeps responses short.

**ChatGPT/Codex side** — four native Codex hooks, none of which starts another model turn:

1. `PreToolUse` routes supported shell commands through RTK; unsupported commands pass through unchanged.
2. `PostToolUse` replaces oversized model-visible results with a short deterministic receipt and stores the exact original locally. `ncc evidence-find` and `ncc evidence-slice` pull back only the lines the task needs; `ncc evidence-get` recovers everything.
3. `UserPromptSubmit` adds a small per-turn budget for routine answers. Explicit requests for depth, tutorials, audits, or exhaustive detail are not capped.
4. `SessionStart` (matching `compact`) restores the concise operating policy after Codex compacts a long task.

A short managed block in `~/.codex/AGENTS.md` trims narration and preserves high-value state. EvidenceVault is exact from the `PostToolUse` boundary onward; bytes Codex truncated before that event cannot be recovered. Monitor telemetry is sanitized: it reports rewrites and reductions without exposing prompts, commands, answer bodies, session IDs, or evidence content.

## Requirements and scope

- Windows 10/11, Node.js 22.7+ or 24.x, ChatGPT/Codex desktop or CLI (plus the normal Claude prerequisites for the Claude side).
- The OpenAI side covers local **Work** tasks on ChatGPT Pro or an eligible higher-tier workspace subscription. Ordinary Chat conversations, remote/cloud tasks, and API-key usage are not covered. The model and reasoning effort you pick in the app are preserved.
- Running only the OpenAI installer does not modify or restart Claude, pxpipe, warpd, or the shared monitor.

## Install

```powershell
.\setup.cmd install-all      # both sides
.\setup.cmd install-openai   # OpenAI side only
```

Then restart ChatGPT/Codex, open `/hooks`, review the four Native Context Compiler hooks, and trust them once. This one-time review is deliberate: the installer never silently approves executable hooks, and Codex invalidates trust if a hook definition changes. For fresh normal tasks `/hooks` must show **Active 4, Review 0**.

The installer preserves unrelated hooks, model settings, plugins, and user-authored AGENTS.md content, and backs up files before changing project-owned sections. The guarded `hook-eval` A/B runs in disposable homes via Codex's explicit one-invocation trust bypass and does not approve the installed hooks.

## Commands

```powershell
ncc status
ncc settings
ncc budget on|off|status
ncc evidence-find <handle> "pattern"
ncc evidence-slice <handle> --start-line 120 --lines 60
ncc benchmark
```

`ncc settings` prints the editable local settings path (RTK, receipt compaction, and the turn budget can be controlled independently). An opt-in guarded hook A/B is available from the compiler source directory when other subscription clients are idle: `npm run hook-eval -- --model <your-codex-model> --effort low --claude-idle`.

## Local monitors (loopback only)

| Address | Purpose |
|---|---|
| `http://127.0.0.1:47821/` | Claude pxpipe |
| `http://127.0.0.1:47822/healthz` | Claude warpd health |
| `http://127.0.0.1:47823/` | Combined Claude + Codex monitor |
| `http://127.0.0.1:47831/` | Codex Work dashboard |

47831 is never a model proxy. On the Codex cards, **installed** means the hook definitions exist, **live** means a real non-probe hook fired in the last 15 minutes, and **verified · idle** means past measurements prove it worked but not that it is firing now. Seeing three of four events is normal; `SessionStart` only fires after a compact. `/hooks` remains the authoritative trust view.

## Limitations

- The whole-turn Lean/app-server bridge is disabled; its `CODEX_CLI_PATH` override is removed and normal Work turns stay native.
- Codex 0.149 may show a blocked/failed wrapper when `PostToolUse` replaces a result. The command already ran; only the oversized output was replaced, and the receipt states the real exit status.
- This release is **source-only**: no compiled executables, DLLs, native modules, fonts, images, or prebuilt runtime bundles. Review the source, hooks, and settings before trusting executable hooks.

## Uninstall

```powershell
.\setup.cmd uninstall-openai
```

Restores the previous user-level `CODEX_CLI_PATH`, removes only project-owned hook groups and the managed AGENTS.md block, and preserves local sessions, evidence, settings, and sanitized metrics unless `-RemoveData` is used.

## License and docs

Source-available for personal use under the Claude-ChatGPT Token Stack Personal Use License 1.0 — see [LICENSE](LICENSE) for exact terms. Deeper docs: [docs/HOW-IT-WORKS.md](docs/HOW-IT-WORKS.md), [docs/SECURITY-MODEL.md](docs/SECURITY-MODEL.md), [docs/PERSONALIZATION.md](docs/PERSONALIZATION.md).
