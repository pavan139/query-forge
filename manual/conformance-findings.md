# Review and executed checks

The compiler, type binder, optimizer, batch operators, and independent nested-loop path were reviewed as an executable database-engine experiment. SQLite is an external differential oracle used by conformance/experiments, not a fallback for unsupported core queries.

## Correctness evidence

The suite passes **21 tests**, containing **75 seeded corpus queries** checked in both optimized and reference modes, plus **80 query/catalog scenarios across 20 random seeds**, again checked in both modes. Cases include duplicate and NULL join keys, composite keys, empty relations, global/grouped aggregates, nullable values, nested boolean expressions, escaping/comments, and limits. Bags preserve multiplicity.

Independent assertions cover every AND/OR combination over TRUE/FALSE/UNKNOWN; COUNT skips NULL, NULL groups form one group, NULL=NULL is UNKNOWN, and empty-input aggregate conventions match SQLite. Positive duplicate joins must produce their full cross product. Tests check bounded batches, actual pushdown work, deterministic EXPLAIN/cost search, output budgets, immutable catalog snapshots, and int64 SUM overflow.

Cross-review reproduced a material numeric defect: with REAL values `1e16,-1e16,1` and four duplicate join partners, hash and nested-loop orders returned different SUM/AVG values. MAXINT/-MAXINT with three duplicate partners could return zero in one plan and overflow in the other. Plain accumulators were replaced by exact integer/common-binary-grid accumulators with order-stability admission certificates. Both original cases now fail explicitly in both plans; a bounded cancellation variant is accepted and matches SQLite. Thirty shuffled accumulator trials verify invariant results/certificates. A finite-final/infinite-intermediate power-of-two case also verifies the absolute-range guard. No tolerance was enlarged to conceal the issue. [DESIGN](sql-and-numeric-contract.md) defines the narrower accepted aggregate domain.

Invalid inputs cover ambiguous/unknown columns, aliases, cross-type coercions, unsupported joins/functions/syntax, stacked statements, malformed comments/strings, invalid UTF-8, parser nesting/token/operator budgets, nonfinite data, wrong schema types, and excessive limits. A 64-boolean-operator bound was added to prevent long left-associated expressions from bypassing the parenthesis-depth cap.

## Targeted mutation checks

`python tools/review_mutations.py` introduces three regressions in temporary copies: treating NULL comparisons as TRUE, retaining only one matching hash-bucket row, and counting NULL aggregate inputs. All three are killed by the final suite; the evidence was regenerated after the numeric fix. [mutation-results.json](mutation-results.json) retains failure evidence. This is a focused spot check, not exhaustive mutation testing.

Executed commands:

```bash
PYTHONPATH=src python -m unittest discover -s conformance -v
python -m query_forge demo --output explain/demo.json
python -m query_forge evaluate --output explain/evaluation.json
python tools/review_mutations.py
```

Ruff checks/formatting pass. The runtime and tests require only Python's standard library. No downloads, network service, model inference, or training was used.

## Limits and interpretation

Without ORDER BY, limited row choice is unspecified; checks therefore validate limited cardinality and duplicate-aware inclusion in the full SQLite result rather than claiming a particular physical ordering. Affinity conversions, arbitrary SQLite grammar, nonfinite results, and uncertified additive aggregates are rejected or outside the subset. The certificate is conservative and can reject valid SQLite queries. Cost estimates assume simple selectivities and can fail on skew/correlation; no optimal-runtime guarantee follows from DP search. No native vectorization, spilling, indexes, cancellation, durability, distributed execution, production memory isolation, or PostgreSQL compatibility was implemented.
