# Native Context Compiler 0.6.3

Native Context Compiler reduces supported local ChatGPT Work/Codex tool output
while keeping normal turns on OpenAI's native path. It adds no API key or
usage-billed API request.

The Windows stack combines:

- a small managed `AGENTS.md` operating policy;
- `PreToolUse` RTK rewriting for supported shell commands;
- `PostToolUse` replacement of oversized results with reversible receipts;
- exact local evidence plus bounded search and line retrieval;
- a non-blocking `UserPromptSubmit` turn budget for routine answers;
- `SessionStart` policy reinforcement after compaction;
- sanitized native-hook and whole-turn measurement.

Unsupported or failed processing passes through unchanged. The synchronous
whole-turn Lean bridge is disabled and its launcher is not compiled or
registered by the supported installer.

## Develop and verify

```powershell
npm ci
npm test
npm run benchmark
npm pack --dry-run
```

Install the reviewed package on Windows:

```powershell
.\install-all.cmd
ncc --version
ncc status
```

Restart ChatGPT/Codex, open `/hooks`, review the four Native Context Compiler
groups, and trust them once. Codex owns this approval; the installer does not
silently grant executable-hook trust.

`ncc status` separates configured hooks from runtime activity. `liveObserved`
means a real, non-probe invocation occurred within the last 15 minutes;
`observed` is retained history. Installer probes are identified and excluded
from reduction totals. `SessionStart` is normally idle until Codex compacts a
task. The authoritative approval check remains `/hooks`: Active 4, Review 0.

The installer removes obsolete project-owned Codex provider/launcher state,
preserves unrelated hooks and user guidance, restores any prior
`CODEX_CLI_PATH`, installs the four lightweight hooks, and writes recoverable
backups.

## Normal Work use

Continue using local Work tasks normally. All prompts use native Work mode;
there is no nested whole-turn model call.

Large supported tool results become small receipts after the command completes.
Prefer bounded recovery:

```powershell
ncc evidence-find <handle> "pattern"
ncc evidence-slice <handle> --start-line 120 --lines 60
ncc evidence-get <handle>
```

`evidence-get` returns the complete original and should be reserved for cases
where the whole result is genuinely needed.

Editable settings:

```powershell
ncc settings
ncc status
ncc budget on
ncc budget off
ncc budget status
```

RTK rewriting, receipt replacement, and the routine turn budget can be controlled independently.
`leanBridge.enabled` remains false in the supported configuration; manual Lean
diagnostics remain available with `ncc lean`.

## Verified measurements

A controlled Codex 0.149.0 hook A/B used the same model, effort, prompt,
2,000-line result, and hidden canary:

| Arm | Complete-turn input tokens | Canary visible |
|---|---:|---|
| Control | 41,925 | yes |
| Native receipt | 30,789 | no |
| Difference | **11,136 saved (26.56%)** | exact hook input retained locally |

The now-disabled whole-turn Lean experiment measured:

| Fixture | Baseline | Lean | Saved |
|---|---:|---:|---:|
| Medium history | 27,718 | 10,393 | **62.50%** |
| Long history | 59,905 | 8,778 | **85.35%** |

The disabled desktop bridge was also tested end to end: a normal app-server turn returned
the Lean result as a standard final assistant item, emitted no visible hook card,
survived a process restart, and recorded zero outer-model tokens. These results
establish specific workload boundaries, not universal savings, billing
reduction, or subscription-quota guarantees.

## Scope and warning

- Local ChatGPT Work/Codex tasks with ChatGPT Pro or an eligible higher-tier
  workspace subscription.
- Ordinary Chat, cloud tasks, and API-key usage are not covered.
- Images, skills, plugins, and other non-text inputs bypass Lean; pxpipe remains
  on Claude.
- The routine turn budget adds developer context only. It never blocks a turn,
  reroutes traffic, stores prompt text, or starts a second model call.
- Evidence, reply persistence, and metrics remain local under
  `%LOCALAPPDATA%\NativeContextCompiler`.
- The disabled desktop bridge is retained as experimental research code, not a
  supported ChatGPT extension API.

See [architecture](docs/ARCHITECTURE.md), [live evaluation](docs/LIVE-EVALUATION.md),
and [results](docs/OFFLINE-RESULTS.md).
