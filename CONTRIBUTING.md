# Extending the compiler

Add a SQL feature through the lexer/parser, binder, plan rules, and interpreter in that order. Put both accepted and rejected forms in `conformance/`; an unknown construct should not fall through to another execution engine. Compare bags with SQLite, including NULLs, duplicates, empty input, and ambiguous references.

A rewrite must preserve every required predicate, grouping field, and join key. Add a case where dropping one of them would change the result. Work-count comparisons should keep catalog analysis separate and name the actual operations being counted rather than treating all counters as equivalent CPU work.

Read the [numeric contract](manual/sql-and-numeric-contract.md) before touching SUM or AVG. Keep the cancellation and overflow refusals, permutation tests, and bounded accepted cases. Increasing comparison tolerances is not a fix for an order-dependent answer. LIMIT tests should check admissible cardinality and multiplicity unless ordering is added as a real language feature.

```bash
PYTHONPATH=src python -m unittest discover -s conformance -v
python tools/review_mutations.py
```

Update the grammar and saved EXPLAIN record with any supported-language change. The [distribution notes](manual/distributing-the-engine.md) describe the wheel and CLI checks used before sharing a revision.
