# CLAUDE.md benchmark (directional)

- model: `haiku`  runs/cell: 5
- metric: mean output tokens per prompt (word count in parens)
- baseline condition: `baseline` (no CLAUDE.md)

| Prompt | baseline | CLAUDE.md |
|---|---|---|
| T1-async | 669 (274w) | 658 (256w) -2% |
| T2-review | 387 (65w) | 371 (47w) -4% |
| T3-rest | 419 (195w) | 440 (179w) +5% |
| T4-prompt | 523 (261w) | 549 (238w) +5% |
| T5-halluc | 267 (45w) | 237 (34w) -11% |
| **total tok** | **2266** | **2254** **-1%** |

- baseline total cost: $0.0585
- CLAUDE.md total cost: $0.0596

> Directional only: single-session means, output varies run-to-run. Negative % = fewer output tokens than baseline.