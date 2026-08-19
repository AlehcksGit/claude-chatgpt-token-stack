# CLAUDE.md benchmark (directional)

- model: `opus`  runs/cell: 5
- metric: mean output tokens per prompt (word count in parens)
- baseline condition: `baseline` (no CLAUDE.md)

| Prompt | baseline | CLAUDE.md |
|---|---|---|
| T1-async | 617 (256w) | 579 (242w) -6% |
| T2-review | 96 (38w) | 77 (28w) -19% |
| T3-rest | 404 (159w) | 387 (151w) -4% |
| T4-prompt | 702 (300w) | 697 (295w) -1% |
| T5-halluc | 70 (35w) | 59 (31w) -16% |
| **total tok** | **1888** | **1799** **-5%** |

- baseline total cost: $0.3850
- CLAUDE.md total cost: $0.3570

> Directional only: single-session means, output varies run-to-run. Negative % = fewer output tokens than baseline.