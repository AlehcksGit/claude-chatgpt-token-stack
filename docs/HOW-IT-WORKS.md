# How version 0.6 works

> **0.6.2 supported mode:** normal local Work turns stay on native Codex. Four
> lightweight hooks and a managed rules block operate locally. The synchronous
> Lean/app-server bridge and `CODEX_CLI_PATH` override remain disabled.

The Claude and OpenAI paths are independent. Installing only the OpenAI side
does not edit or restart Claude, pxpipe, warpd, the shared monitor, or a Claude
project.

## Claude path

Claude keeps its established three-part stack:

1. `CLAUDE.md` guidance reduces unnecessary narration.
2. RTK rewrites supported shell commands so repetitive CLI and MCP-adjacent
   output is smaller.
3. pxpipe/warpd compresses supported image traffic on Claude's configured path.

## ChatGPT Work/Codex path

Users continue typing in the normal local Work composer:

```text
UserPromptSubmit -> routine turn-budget context, or explicit-detail preservation
managed AGENTS.md policy
PreToolUse       -> RTK rewrite when supported
host tool call   -> normal Codex execution
PostToolUse      -> small result unchanged, or bounded reversible receipt
SessionStart     -> restore the short policy after host compaction
```

The turn budget is developer context, not a proxy. It never blocks a turn,
reroutes traffic, calls another model, or stores prompt text. Routine requests
get concise progress and final-answer budgets. Requests that explicitly ask for
a deep dive, audit, tutorial, exhaustive treatment, or step-by-step detail keep
the requested depth. Disable or re-enable it with `ncc budget off` and
`ncc budget on`.

For oversized supported tool results, the exact result visible at the
`PostToolUse` boundary is stored locally under a content-addressed evidence
handle. `ncc evidence-find` and `ncc evidence-slice` recover bounded portions
from a line-oriented output view, even when Codex wrapped the result in JSON;
`ncc evidence-get` returns the exact full stored value. If Codex truncated output
before the hook event, a downstream hook cannot recover the missing bytes.

Every hook fails open on malformed input, disabled settings, timeout, missing
RTK, or local processing errors.

## Live-state reporting

Installation, historical verification, and current activity are separate. The
monitor calls the Codex stack **live** only after non-probe hook activity within
the last 15 minutes. Older measurements appear as **verified · idle**, and
installer self-tests never count as normal-use activity. `SessionStart` runs
only after host compaction, so three recently observed events can represent a
fully healthy four-hook installation. Codex `/hooks` is the trust ground truth
and must report Active 4 and Review 0.

## Why ChatGPT Work does not use pxpipe

ChatGPT subscription authentication is owned by the app. Provider proxying
would change that boundary and can require separately billed API usage. The
supported OpenAI stack therefore uses native local Codex hooks only. pxpipe
stays on Claude.

## Measurement boundaries

- Receipt telemetry compares the original hook-visible result with its receipt.
- Native hook A/B measures a complete Codex turn and checks a hidden canary.
- The verified 2,000-line receipt A/B saved 11,136 input tokens, or 26.56%, on
  that workload.
- The turn budget is operationally tested but does not yet have a defensible
  savings percentage. It must be evaluated separately before making a claim.
- The disabled Lean research path measured 62.50% and 85.35% on two fixtures,
  but its nested synchronous turn caused unacceptable latency.

These are workload-specific token measurements, not universal billing,
subscription-quota, latency, or quality guarantees.

## Historical research path

The source retains the whole-turn Lean compiler and app-server bridge for audit
and controlled experiments. Version 0.6.2 does not install its launcher, set
`CODEX_CLI_PATH`, or enable `leanBridge`. `ncc lean` remains a manual diagnostic.
