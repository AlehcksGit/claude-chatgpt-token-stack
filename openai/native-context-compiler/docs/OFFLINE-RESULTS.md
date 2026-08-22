# Offline and native results — 2026-08-21

> Whole-turn Lean and seamless-bridge results below document the retired 0.6.0
> experiment. Version 0.6.2 disables that path because its latency outweighed
> the measured token reduction during normal interactive use.

## Automatic native PostToolUse A/B

The controlled canary run used Codex 0.149.0, `gpt-5.6-sol`, low reasoning
effort, identical prompts, and a deterministic 2,000-line Bash result. A
random hidden canary at line 1777 tested whether the model actually received
the original output.

| Metric | Control | Native receipt |
|---|---:|---:|
| Complete-turn input tokens | 41,925 | 30,789 |
| Canary answer | exact | unavailable |
| Exact PostToolUse input retained | n/a | yes |

The optimized arm saved **11,136 input tokens (26.56%)**. The missing canary
proves the raw result was not model-visible, while local evidence recovery
still returned the original lines 0 through 1999.

Codex's client event output displayed the raw command output in both arms.
That display is not model input. A second experiment using `continue: false`
failed: the model recovered the canary and used more input tokens, so version
0.6 uses `decision: "block"` only.

## Reproducible deterministic compiler benchmark

```powershell
npm test
npm run benchmark
```

Result for the 91-request long-agent fixture:

| Metric | Baseline | Compiled |
|---|---:|---:|
| Cumulative local `o200k_base` tokens | 22,212,463 | 933,680 |
| Average per request | 244,093 | 10,260 |
| Largest compiled request | — | 11,815 / 12,000 |
| Reduction | — | **95.80%** |

All budget, tool-pair, latest-user-item, and evidence round-trip gates passed.
This is a deterministic compiler measurement, not native model usage.

## Guarded whole-turn Lean A/B

The evaluator compared ordinary Codex context and raw history with locally
compiled history plus capability pruning. Both arms used `gpt-5.6-sol` at
`xhigh`, the same final prompt/schema, fresh read-only network-denied tasks,
randomized order, and exact-answer scoring.

| Metric | Medium control | Medium Lean | Long control | Long Lean |
|---|---:|---:|---:|---:|
| Local history tokens | 15,104 | 1,980 | 47,234 | 324 |
| Native input tokens | 27,646 | 10,275 | 59,776 | 8,679 |
| Complete turn tokens | 27,718 | 10,393 | 59,905 | 8,778 |
| Exact answer | PASS | PASS | PASS | PASS |

Complete-turn savings were **62.50%** on the medium fixture and **85.35%** on
the long fixture. The long optimized arm saved 51,127 complete-turn tokens.

## Earlier compiler-only native result

An earlier guarded A/B at low effort reduced native input from 26,012 to
14,148 tokens (**45.61%**) with identical exact JSON answers. It isolated
history compilation without the full long-fixture capability reduction.

## What the results establish

- Native PostToolUse replacement can reduce a large model-visible tool result
  in a normal Work/Codex flow without an added model call.
- The Lean path can exceed 80% for sufficiently long removable
  history while preserving the tested exact answer.
- Exact local evidence makes receipt replacement reversible.

## Seamless bridge integration result

A source-built launcher and app-server compatibility bridge completed an
eligible normal text turn through `UserPromptSubmit`. The client received a
standard `agentMessage` with `phase: "final_answer"`, received no hook card,
and `turn/completed` contained the final item. After terminating that Codex
process and starting another, `thread/read` still contained the answer. Hook
telemetry recorded the Lean turn and zero outer-model tokens.

This validates transport, display, and local persistence. It does not turn the
experimental compatibility layer into a supported ChatGPT extension API.

## What the results do not establish

- The percentages are not universal and do not promise billing or quota
  reduction. Short turns and small outputs may save little.
- Synthetic canary and history fixtures are not a representative coding-task
  quality suite.
- The compatibility bridge makes Lean automatic for eligible local Work text
  turns, but ordinary Chat and cloud tasks remain outside its scope.
- Direct Work attachments and other non-text items bypass Lean and use native
  Work mode; no OpenAI-side image reduction is claimed.
- Future Codex versions may change these experimental integration semantics.
