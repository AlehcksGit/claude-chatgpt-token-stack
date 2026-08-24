# How version 0.6 works

> **0.6.2 supported mode:** normal local Work turns stay on native Codex. Four
> lightweight hooks and a managed rules block operate locally. The synchronous
> Lean/app-server bridge and `CODEX_CLI_PATH` override remain disabled.

The Claude and OpenAI paths are independent. Installing only the OpenAI side
does not edit or restart Claude, pxpipe, warpd, the shared monitor, or a Claude
project.

## Claude path

Claude keeps its established three-part stack. The layers are complementary,
not three competing ways to measure the same tokens:

1. `CLAUDE.md` guidance reduces Claude's avoidable output: preambles,
   play-by-play narration, repeated summaries, speculative extras, and closing
   fluff. It also asks Claude to inspect the relevant files, make focused
   changes, and validate before declaring completion. User requests for depth
   override the concise default.
2. RTK reduces supported shell and MCP-adjacent output before Claude reads it.
   Search results are grouped, diffs and logs are condensed, and test runners
   keep failures while collapsing repetitive passing output. Unsupported
   commands pass through normally.
3. pxpipe/warpd reduces eligible dense request context before it reaches the
   provider. pxpipe selects a model-specific render profile, wraps dense bulk
   context into PNG pages plus a bounded factsheet, and forwards the native
   request. A profitability gate leaves sparse prose as text. Unsupported
   models and ineligible content pass through unchanged.

The rules target output tokens, RTK targets tool-result input, and pxpipe
targets resent request context. Their individual percentages cannot be added.
The useful combined result depends on the task's mix of conversation, tools,
and generated prose.

### Claude evidence and trade-offs

- The pinned pxpipe documentation shows a real render of about 48,000 dense
  characters at roughly 2,700 image tokens versus 25,000 text tokens. Its
  Claude Code measurements commonly reduce eligible resent request context by
  about 60-70%, but cache behavior and workload density change the result.
- pxpipe's quality probes cover arithmetic, gist, state tracking, false recall,
  dense identifiers, and real software tasks. Image rendering is still lossy:
  exact hashes, IDs, secrets, and other byte-critical values must stay text or
  use a pass-through model.
- RTK reports up to 90% reduction in supported command output. Its absolute
  token estimate is bytes divided by four, so the percentage is useful while
  the displayed token count is approximate. Command-output reduction is not a
  claim about an entire bill or subscription limit.
- The pinned `claude-token-efficient` N=5 benchmark found modest output-token
  changes for its minimal rules and larger changes for its aggressive profile.
  Rules also add input on every turn, so concise guidance pays off most on
  output-heavy work. The stack's default file extends the upstream minimal
  rules and is not identical to either tested profile.

The exact upstream sources and receipts are vendored under `upstream/`. Pinned
revisions and integration changes are listed in `VENDORED_SOURCES.json`; the
original project links and licenses are retained in `NOTICE.md`.

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
