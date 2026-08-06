# Compiler check results

The conformance suite has 21 tests. It includes 75 seeded SQLite comparisons in both execution modes, 20 random catalogs with four query templates each, complete three-valued truth tables, duplicate joins, empty aggregates, bounded batches, and numeric order-stability refusals. Run `python -m unittest discover -s conformance -v`.

See [reports/verification.json](../reports/verification.json) for current counts, skips, source/configuration digest, formatting, wheel, and cold-install CLI results. `tools/check_engine.py` refreshes that record. The [conformance findings](conformance-findings.md) describe the cancellation defect that led to the current numeric certificates, and [plan-work counts](plan-work-counts.md) preserve the actual comparison.

A SQLite match uses the documented subset and LIMIT criterion. It is not a compatibility claim for arbitrary SQL or uncertified floating aggregation.
