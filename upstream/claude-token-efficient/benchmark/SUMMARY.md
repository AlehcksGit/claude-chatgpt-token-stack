# CLAUDE.md automated benchmark - three-model results

Harness: `benchmark/run.py`. Engine: `claude -p --output-format json` over OAuth.
Each prompt runs in a fresh `/tmp` dir (baseline = empty dir, treatment = repo `CLAUDE.md` copied in).
`--setting-sources project` blocks global settings/hooks. N=5 per cell.
Metric: mean output tokens per prompt (word count in parens).

Raw per-run data: `benchmark/raw-{haiku,sonnet,opus}.jsonl`. Per-model tables: `benchmark/report-*.md`.

## Total output tokens, baseline to CLAUDE.md (current minimal profile)

| Model  | All 5 prompts | T1-T3,T5 only (excl. T4 format test) | Cost (base to file) |
|--------|---------------|--------------------------------------|---------------------|
| haiku  | 2266 to 2254 **-1%**  | 1742 to 1706 **-2%**  | $0.0585 to $0.0596 |
| sonnet | 1856 to 1524 **-18%** | 1350 to 1200 **-11%** | $0.1609 to $0.1599 |
| opus   | 1888 to 1799 **-5%**  | 1187 to 1102 **-7%**  | $0.3850 to $0.3570 |

T4 ("Generate a prompt...") is a format test, not a length test. The rules push it toward structured output which can add tokens. Excluding it is the fairer length comparison and matches BENCHMARK.md's 63% average.

## Aggressive variant: `profiles/CLAUDE.compressed.md`

Measured separately with the same harness, N=5 per cell:

| Model  | All 5 prompts | Cost (base to file) |
|--------|---------------|---------------------|
| haiku  | 2212 to 1726 **-22%** | $0.0677 to $0.0589 |
| sonnet | 1745 to 1182 **-32%** | $0.1646 to $0.1605 |
| opus   | 1936 to 727 **-62%**  | $0.3997 to $0.3451 |

The compressed profile drops fabrication and re-read guards in exchange for shorter output. Use when token cost dominates and the workload is low-risk.

## Findings (directional, single-session means, output varies run-to-run)

1. **The published 63% reduction does not reproduce on the current minimal CLAUDE.md.**
   Real effect ranges from ~-2% (haiku) to -11% (opus, excl. T4). It does reproduce with `profiles/CLAUDE.compressed.md` on opus (-62%).

2. **Effect scales with the model's default verbosity.** Opus, the chattiest baseline, has the most to trim. Haiku barely moves on the minimal profile.

3. **Words drop more consistently than tokens.** Markdown and structure tokens partly offset word savings, so word-count benchmarks overstate the token (cost) win.

4. **On short prompts the minimal profile is roughly cost-neutral.** Per-turn input overhead cancels output saving. Net savings need high output volume to offset the persistent input cost.

## Caveats

- N=5, single session, no statistical controls. Directional signal only.
- Measures one-shot Q&A prompts, not agentic/coding loops (see Issue #1 for that).
- Reproduce: `python3 benchmark/run.py -n 5 --model {haiku,sonnet,opus}`.
- This file covers tokens. For behavior and correctness see `SEMANTIC.md`.
