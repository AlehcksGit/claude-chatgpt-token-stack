# Claude-ChatGPT Token Stack

Use Claude Code and local ChatGPT Work/Codex as usual, while a local stack trims oversized context, noisy command output, and unnecessary narration before they consume more of your usage limit.

Claude gets three complementary layers: concise project guidance, RTK command-output filtering, and pxpipe image-based context compression. ChatGPT Work/Codex gets four native hooks for the same general goal without proxying its subscription traffic.

> **License:** source is provided for individual personal use. Read [LICENSE](LICENSE) before installing, redistributing, or adapting it.

The complete Claude + ChatGPT/Codex setup is Windows-first. Linux and macOS include tested Claude-side install/uninstall lifecycle scripts; the OpenAI Work/Codex integration remains Windows-only in 0.6.2.

**Current release: 0.6.2** - see [CHANGELOG.md](CHANGELOG.md).

## Why this exists

Coding agents repeatedly send and read far more than the useful part of a task:

- hundreds of lines of build noise from one shell command
- a 2,000-line tool result the model quotes three lines from
- play-by-play narration, repeated explanations, and closing filler nobody asked for

Those costs compound through a long work session. This project reduces them at the source while keeping the normal apps and subscription sign-in.

## What this stack does

It adds local reduction at the points each app safely exposes.

- **Same workflow.** You keep typing in Claude Code and the normal local Codex Work composer. Local dashboards and background helpers do not replace either app.
- **Same subscriptions.** No API key, separately billed model request, project account, or project telemetry is added.
- **Provider-specific paths.** Claude traffic passes through local pxpipe/warpd before reaching its configured provider. Codex traffic stays native and is reduced through hooks.
- **Fails open.** Unsupported or failed rewrites pass through unchanged. Codex receipts retain exact hook-visible evidence; pxpipe's dense image rendering is lossy and has separate precision safeguards and pass-through controls.

## The Claude stack

Claude keeps the original three-part design, with each layer handling a different kind of waste:

1. **Token-efficient `CLAUDE.md` guidance** keeps Claude focused: read the relevant files, make the smallest complete change, verify it, and report the result without a flattering preamble, constant narration, repeated summary, or speculative extras. Explicit requests for a deep explanation still win.
2. **RTK** intercepts supported shell commands and gives Claude a compact, useful view: grouped search hits, reduced diffs, failures instead of thousands of passing-test lines, and concise Git output. Unsupported commands pass through normally.
3. **pxpipe + warpd** convert eligible dense context - such as system instructions, tool documentation, old history, code, and JSON - into compact PNG pages that Claude reads through its vision channel. A profitability gate leaves sparse prose as text, recent content stays readable in its safer native form, and unsupported models pass through unchanged.

Together, the layers reduce Claude's own output, the command output fed back into it, and the bulky request context sent on later turns. Their percentages must not be added together; the combined result depends on the workload and how much traffic reaches each layer.

### What the original projects measured

| What | Result |
|---|---|
| pxpipe dense-context example | about 48,000 characters rendered as roughly **2,700 image tokens instead of 25,000 text tokens** |
| pxpipe real-client request reduction | commonly **about 60-70%** on Claude Code's eligible resent context; workload and cache behavior matter |
| RTK supported shell output | up to **90% less command output** read by the agent; estimated token counts, not total subscription usage |
| `claude-token-efficient` minimal rules, length-focused prompts | directional N=5 means of **2%, 11%, and 7% fewer output tokens** on Haiku, Sonnet, and Opus |
| `claude-token-efficient` aggressive profile, all five prompts | directional N=5 means of **22%, 32%, and 62% fewer output tokens** on Haiku, Sonnet, and Opus |

These are upstream component measurements, not a promise that every session will match them. This stack's default `CLAUDE.md` extends the upstream minimal rules, so its behavior is not identical to either benchmark profile. pxpipe is intentionally lossy for dense image-rendered text: exact IDs, hashes, secrets, or other byte-critical values should remain text or use a pass-through model. The upstream evaluation and receipts are included under [`upstream/`](upstream/) so the claims can be inspected and reproduced.

## The ChatGPT Work/Codex stack

ChatGPT subscription traffic cannot be safely redirected through the Claude proxy path without changing the app's authentication boundary. The OpenAI side therefore stays native and uses four Codex hooks:

1. `PreToolUse` routes supported shell commands through RTK.
2. `PostToolUse` replaces oversized results with a compact receipt while retaining exact local evidence.
3. `UserPromptSubmit` asks for lean routine responses while preserving explicit requests for depth.
4. `SessionStart` restores the short operating policy after context compaction.

### What this repository measured

| What | Result |
|---|---|
| Oversized Codex tool result replaced by a receipt (native Codex 0.149.0 A/B, same model, same task) | **11,136 input tokens saved (26.56%)** - 41,925 vs 30,789 |

- The receipt A/B proves the *model* received the smaller input; the client can still display the raw output, and the exact original is retained locally.
- A retired whole-turn experiment measured 62.50-85.35% savings but added unacceptable latency; it ships as research data only and is never installed or enabled. Full data: [openai/native-context-compiler/docs/OFFLINE-RESULTS.md](openai/native-context-compiler/docs/OFFLINE-RESULTS.md).

## Quick start

```powershell
.\setup.cmd                  # guided menu
.\setup.cmd install-all      # Claude + ChatGPT Work/Codex
.\setup.cmd install-claude   # Claude only
.\setup.cmd install-openai   # ChatGPT Work/Codex only
.\setup.cmd status           # status for both sides
```

After installation:

- **Claude:** run `pxpipe-ctl doctor`, then open `http://127.0.0.1:47821/`. The doctor checks the rules, RTK, pxpipe, warpd, settings, and managed startup. Restart Claude if it was already open.
- **ChatGPT Work/Codex:** restart the app, open `/hooks`, review the four Native Context Compiler hooks, and trust them once. In a fresh task `/hooks` must show **Active 4, Review 0**.

The installers preserve unrelated Claude settings, Codex hooks, model choices, plugins, and user-authored rule content. Every managed change has an ownership receipt and baseline backup so each side can be removed independently.

On Linux or macOS, `./install.sh` and `./uninstall.sh` provide the tested Claude-only lifecycle. The OpenAI side remains Windows-only in 0.6.2.

## Local, reversible, and inspectable

The stack has no remote account of its own, no API key, and no usage-billed model loop. It uses the subscription sessions already owned by Claude Code and ChatGPT Work/Codex. Components fail open: if a supported rewrite cannot run, the original command or result continues unchanged.

On Codex, `ncc evidence-find` and `ncc evidence-slice` retrieve only the needed lines from a replaced result; `ncc evidence-get` recovers the full hook-visible value. On Claude, the pxpipe dashboard shows each eligible text-to-image transformation, estimated savings, model support, and the kill switch.

A short managed block in `~/.codex/AGENTS.md` trims narration and preserves high-value state. EvidenceVault is exact from the `PostToolUse` boundary onward; bytes Codex truncated before that event cannot be recovered. Monitor telemetry is sanitized: it reports rewrites and reductions without exposing prompts, commands, answer bodies, session IDs, or evidence content.

## Everyday controls

**Whole stack**

```powershell
.\setup.cmd status
.\setup.cmd install-claude|install-openai|install-all
.\setup.cmd uninstall-claude|uninstall-openai|uninstall-all
```

**Claude**

```powershell
pxpipe-ctl status
pxpipe-ctl doctor
pxpipe-ctl start|stop|restart
pxpipe-ctl dashboard
pxpipe-ctl models show|add|remove|all|off|reset
pxpipe-ctl config list|get|set|unset
pxpipe-ctl autostart on|off|status
```

The default Claude rules are balanced for coding work. Advanced users can run `powershell -File .\install.ps1 -Profile <default|compressed|coding|analysis|agents>` to select an upstream rules profile during Claude installation. The more aggressive profiles trade explanation and safeguards for shorter output.

**ChatGPT Work/Codex**

```powershell
ncc status
ncc settings
ncc budget on|off|status
ncc evidence-find <handle> "pattern"
ncc evidence-slice <handle> --start-line 120 --lines 60
ncc benchmark
```

`ncc settings` prints the editable OpenAI-side settings path. RTK routing, receipt compaction, and the turn budget can be controlled independently. An opt-in guarded hook A/B is available from the compiler source directory when other subscription clients are idle: `npm run hook-eval -- --model <your-codex-model> --effort low --claude-idle`.

## Requirements and scope

- Full stack: Windows 10/11, Node.js 22.7+ or 24.x, ChatGPT/Codex desktop or CLI, plus the normal Claude prerequisites when installing that side.
- Claude-only Unix path: Linux or macOS with Bash, Node.js, and the normal Claude prerequisites, using `install.sh` and `uninstall.sh`.
- The OpenAI side covers local **Work** tasks on ChatGPT Pro or an eligible higher-tier workspace subscription. Ordinary Chat conversations, remote/cloud tasks, and API-key usage are not covered. The model and reasoning effort you pick in the app are preserved.
- Running only the OpenAI installer does not modify or restart Claude, pxpipe, warpd, or the shared monitor.
- Running only the Claude installer does not add Codex hooks, change `AGENTS.md`, or alter OpenAI-local settings.

## Local monitors (loopback only)

| Address | Purpose |
|---|---|
| `http://127.0.0.1:47821/` | Claude pxpipe |
| `http://127.0.0.1:47822/healthz` | Claude warpd health |
| `http://127.0.0.1:47823/` | Combined Claude + Codex monitor |
| `http://127.0.0.1:47831/` | Codex Work dashboard |

The Claude dashboard at 47821 shows model scope, transformations, token estimates, and its kill switch. The combined monitor at 47823 reports both independently so one side being offline does not imply the other is broken.

Port 47831 is never a model proxy. On the Codex cards, **installed** means the hook definitions exist, **live** means a real non-probe hook fired in the last 15 minutes, and **verified - idle** means past measurements prove it worked but not that it is firing now. Seeing three of four events is normal; `SessionStart` only fires after a compact. `/hooks` remains the authoritative Codex trust view.

## Limitations

- The whole-turn Lean/app-server bridge is disabled; its `CODEX_CLI_PATH` override is removed and normal Work turns stay native.
- Codex 0.149 may show a blocked/failed wrapper when `PostToolUse` replaces a result. The command already ran; only the oversized output was replaced, and the receipt states the real exit status.
- This release is **source-only**: no compiled executables, DLLs, native modules, fonts, images, or prebuilt runtime bundles. Review the source, hooks, and settings before trusting executable hooks.

## Uninstall or remove one side

```powershell
.\setup.cmd uninstall-all       # remove both integrations
.\setup.cmd uninstall-claude    # leave ChatGPT Work/Codex installed
.\setup.cmd uninstall-openai    # leave Claude installed
```

All three are receipt-driven and preserve later user edits.

- **Claude uninstall** stops project-owned pxpipe/warpd processes and startup tasks, restores the previous Claude rules and settings, and removes only files owned by this installer. RTK, pxpipe, and `~/.pxpipe` data are preserved by default.
- **OpenAI uninstall** restores the previous user-level `CODEX_CLI_PATH`, removes only project-owned hook groups and the managed `AGENTS.md` block, and preserves local sessions, evidence, settings, and sanitized metrics by default.
- Add `-RemoveTools` to a setup uninstall command to remove shared dependencies only when their receipts prove this stack installed them and the other side no longer needs them. Use `.\uninstall-openai.ps1 -RemoveData` only when you also want the retained Codex evidence and metrics deleted.

## Original projects and credit

This repository integrates and adapts three independent projects whose documentation and licenses remain included:

- [pxpipe](https://github.com/teamchong/pxpipe) by teamchong - local image-based context compression
- [RTK](https://github.com/rtk-ai/rtk) by rtk-ai - compact shell output for coding agents
- [claude-token-efficient](https://github.com/drona23/claude-token-efficient) by drona23 - concise Claude behavior rules and reproducible benchmarks

Exact pinned revisions, local adaptations, and licenses are recorded in [VENDORED_SOURCES.json](VENDORED_SOURCES.json) and [NOTICE.md](NOTICE.md). Upstream benchmark claims above remain theirs; the 26.56% Codex receipt A/B is this repository's measurement.

## License, docs, contact

Source-available for personal use under the Claude-ChatGPT Token Stack Personal Use License 1.0 - see [LICENSE](LICENSE) for exact terms.

Deeper docs: [docs/HOW-IT-WORKS.md](docs/HOW-IT-WORKS.md), [docs/SECURITY-MODEL.md](docs/SECURITY-MODEL.md), [docs/PERSONALIZATION.md](docs/PERSONALIZATION.md).

Questions or bug reports: [open a GitHub issue](https://github.com/AlehcksGit/claude-chatgpt-token-stack/issues).
