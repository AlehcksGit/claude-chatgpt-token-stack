# Semantic evaluation — did the rules change behavior without losing signal?

Per cell: % of runs exhibiting each marker (lower is better for unwanted traits), and judge correctness. Evaluated on captured responses; N=5 runs/cell.

Marker legend: pre=preamble, syc=sycophancy, close=closing fluff, ai='as an AI', em=em-dash, sq=smart-quotes. acc/comp/key = judge accurate/complete/key-point.


## haiku

| Test | Cond | pre | syc | close | ai | em | sq | acc | comp | key |
|---|---|---|---|---|---|---|---|---|---|---|
| T1-async | baseline | 0% | 0% | 0% | 0% | 80% | 0% | 100% | 100% | 100% |
|  | CLAUDE.md | 0% | 0% | 0% | 0% | 20% | 0% | 100% | 100% | 100% |
| T2-review | baseline | 0% | 0% | 0% | 0% | 0% | 0% | 100% | 100% | 100% |
|  | CLAUDE.md | 0% | 0% | 0% | 0% | 40% | 0% | 100% | 100% | 100% |
| T3-rest | baseline | 0% | 0% | 0% | 0% | 100% | 0% | 100% | 100% | 100% |
|  | CLAUDE.md | 0% | 0% | 0% | 0% | 20% | 0% | 100% | 100% | 100% |
| T4-prompt | baseline | 0% | 0% | 40% | 0% | 100% | 0% | 100% | 100% | 20% |
|  | CLAUDE.md | 0% | 0% | 0% | 0% | 100% | 0% | 100% | 100% | 0% |
| T5-halluc | baseline | 0% | 0% | 0% | 0% | 40% | 0% | 100% | 100% | 100% |
|  | CLAUDE.md | 0% | 0% | 0% | 0% | 0% | 0% | 100% | 100% | 100% |

## opus

| Test | Cond | pre | syc | close | ai | em | sq | acc | comp | key |
|---|---|---|---|---|---|---|---|---|---|---|
| T1-async | baseline | 0% | 0% | 0% | 0% | 100% | 0% | 100% | 100% | 100% |
|  | CLAUDE.md | 0% | 0% | 0% | 0% | 60% | 0% | 100% | 100% | 100% |
| T2-review | baseline | 0% | 0% | 0% | 0% | 0% | 0% | 100% | 100% | 100% |
|  | CLAUDE.md | 0% | 0% | 0% | 0% | 0% | 0% | 100% | 100% | 100% |
| T3-rest | baseline | 0% | 0% | 0% | 0% | 100% | 0% | 100% | 100% | 100% |
|  | CLAUDE.md | 0% | 0% | 0% | 0% | 40% | 0% | 100% | 100% | 100% |
| T4-prompt | baseline | 0% | 0% | 0% | 0% | 100% | 0% | 100% | 100% | 0% |
|  | CLAUDE.md | 0% | 0% | 0% | 0% | 100% | 0% | 100% | 100% | 0% |
| T5-halluc | baseline | 0% | 0% | 0% | 0% | 0% | 0% | 100% | 100% | 100% |
|  | CLAUDE.md | 0% | 0% | 0% | 0% | 0% | 0% | 100% | 100% | 100% |

## sonnet

| Test | Cond | pre | syc | close | ai | em | sq | acc | comp | key |
|---|---|---|---|---|---|---|---|---|---|---|
| T1-async | baseline | 0% | 0% | 0% | 0% | 100% | 0% | 100% | 100% | 100% |
|  | CLAUDE.md | 0% | 0% | 0% | 0% | 80% | 0% | 100% | 100% | 100% |
| T2-review | baseline | 0% | 0% | 0% | 0% | 20% | 0% | 100% | 100% | 100% |
|  | CLAUDE.md | 0% | 0% | 0% | 0% | 0% | 0% | 100% | 100% | 100% |
| T3-rest | baseline | 0% | 0% | 0% | 0% | 100% | 0% | 100% | 100% | 100% |
|  | CLAUDE.md | 0% | 0% | 0% | 0% | 60% | 0% | 100% | 100% | 100% |
| T4-prompt | baseline | 0% | 0% | 80% | 0% | 100% | 0% | 100% | 100% | 0% |
|  | CLAUDE.md | 0% | 0% | 100% | 0% | 100% | 0% | 100% | 100% | 0% |
| T5-halluc | baseline | 0% | 0% | 0% | 0% | 0% | 0% | 100% | 100% | 100% |
|  | CLAUDE.md | 0% | 0% | 0% | 0% | 0% | 0% | 100% | 100% | 100% |

## Reading it

- The file's stated targets are: concise, **no sycophantic openers**, **no closing fluff**. It does NOT contain rules about em-dash, 'as an AI', or multi-version format — so changes there (or lack of) are incidental.
- A real win = unwanted-marker % drops baseline→CLAUDE.md while **key-point stays ~100%** (correction/bug/explanation preserved = zero signal loss).