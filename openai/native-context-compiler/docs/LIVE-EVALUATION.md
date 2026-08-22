# Paired native evaluation boundary

> The whole-turn bridge procedures are historical/opt-in diagnostics in 0.6.2.
> The supported installer keeps Lean disabled, installs only the non-blocking
> turn-budget UserPromptSubmit handler, and does not set `CODEX_CLI_PATH`.

Live A/B turns are opt-in. Local fixture preparation and compilation make no
model call.

There are two separate evaluators:

- `hook-eval` measures complete-turn input change from automatic PostToolUse
  replacement and uses a hidden canary plus exact-evidence gate.
- `live-eval --lean` measures complete-turn history/capability reduction in the
  Lean engine used by the seamless bridge and uses an exact-answer schema.

## Required preflight

- Other clients using the subscription are explicitly confirmed idle.
- Authentication is ChatGPT-managed on Pro or an eligible higher-tier
  workspace subscription.
- Rate-limit telemetry is complete, no paid credits or usage-billed limit is
  active, and configured headroom remains.
- Each arm uses a new ephemeral, read-only, network-denied thread in a fresh
  temporary directory.
- Model fallback is disabled. Model, effort, service tier, prompt, schema, and
  answer scoring are identical.

## Arms

- **Baseline:** original synthetic history with ordinary Codex capability
  context.
- **Optimized:** locally compiled history plus the answer-only lean capability
  profile.

Order is randomized and recorded. Per-turn usage comes only from
`thread/tokenUsage/updated.tokenUsage.last`; local estimates are never used as
native totals. Any tool, command, file, approval, MCP, web, hook, plugin,
reroute, subagent, malformed telemetry, timeout, or quality failure invalidates
the full run.

## Run

```powershell
npm run hook-eval -- --model gpt-5.6-sol --effort low --claude-idle
npm run live-eval -- --model gpt-5.6-sol --effort xhigh --claude-idle --lean
npm run live-eval -- --model gpt-5.6-sol --effort xhigh --claude-idle --lean --noise-turns 18 --noise-repeat 150
```

The hook evaluator uses a disposable local 2,000-line fixture and two fresh
ephemeral turns. It runs exactly one fixture command per arm and invalidates
the result unless the control sees the canary, the optimized arm cannot see
it, the hook is observed, exact evidence round-trips, and native input falls.
It records sanitized counters only.
The evaluator uses `--dangerously-bypass-hook-trust` only for its disposable
optimized invocation. This makes the test reproducible before approval; it is
not evidence that the persistent user hook has been trusted. Verify `/hooks`
separately.

## Passing results — 2026-08-21

The automatic hook A/B reduced native input from 41,925 to 30,789 tokens
(**26.56%**) while hiding the canary from the optimized model and retaining
the exact result received by `PostToolUse` locally.

| Metric | Medium baseline | Medium lean | Long baseline | Long lean |
|---|---:|---:|---:|---:|
| Local history tokens | 15,104 | 1,980 | 47,234 | 324 |
| Native input tokens | 27,646 | 10,275 | 59,776 | 8,679 |
| Complete turn tokens | 27,718 | 10,393 | 59,905 | 8,778 |
| Exact-answer quality | perfect | perfect | perfect | perfect |

Complete-turn reduction was **62.50%** on the medium fixture and **85.35%** on
the long fixture. The exact four identifiers were preserved in both arms.
Account preflight reported a Pro plan, 13% maximum window usage, and no paid
credits.

The result demonstrates the scaling law, not a universal percentage: fixed
Codex context dominates short tasks, while long conversations contain more
history that can be safely removed.

## Installed bridge smoke test

After installing from the source archive and trusting all four hooks, a release
candidate must also pass one normal app-server text turn through the compiled
launcher. The observed client stream must contain a standard final
`agentMessage`, contain no displayed Lean hook event, and report a completed
turn. Restart the app-server and verify `thread/read` still includes that
message. Run a non-text fixture and confirm it bypasses Lean.
