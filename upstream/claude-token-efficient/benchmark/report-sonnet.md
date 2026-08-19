# CLAUDE.md benchmark (directional)

- model: `sonnet`  runs/cell: 5
- metric: mean output tokens per prompt (word count in parens)
- baseline condition: `baseline` (no CLAUDE.md)

| Prompt | baseline | CLAUDE.md |
|---|---|---|
| T1-async | 584 (266w) | 573 (274w) -2% |
| T2-review | 260 (80w) | 213 (70w) -18% |
| T3-rest | 394 (210w) | 315 (185w) -20% |
| T4-prompt | 507 (265w) | 324 (205w) -36% |
| T5-halluc | 112 (29w) | 99 (25w) -11% |
| **total tok** | **1856** | **1524** **-18%** |

- baseline total cost: $0.1609
- CLAUDE.md total cost: $0.1599

> Directional only: single-session means, output varies run-to-run. Negative % = fewer output tokens than baseline.