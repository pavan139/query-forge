# Executed query-engine experiments

Reproduce:

```bash
python -m query_forge demo --output explain/demo.json
python -m query_forge evaluate --output explain/evaluation.json
```

The fixed seed is 17. The [differential report](../explain/evaluation.json) records **75/75 queries passing** for both optimized and nested-loop reference plans. The corpus covers filters, equijoins and composite keys, NULL/duplicate/empty inputs, grouped/global aggregates, and LIMIT. Limited queries use the documented cardinality/membership criterion; other queries require complete bag equality.

The [actual demo report](../explain/demo.json) joins 80 accounts, 1,200 events, and four marks, filters marks/events, then groups results. Both plans return two groups containing 28 contributing rows in total.

| Executed work | Nested-loop reference | Optimized hash/DP plan |
| --- | ---: | ---: |
| Scanned rows | 1,284 | 1,284 |
| Materialized cells | 5,132 | 2,568 |
| Predicate applications | 99 | 1,204 |
| Nested-loop pairs | 100,644 | 0 |
| Hash build rows | 0 | 31 |
| Hash probes | 0 | 805 |
| Intermediate joined rows | 1,218 | 56 |
| Aggregate input rows | 28 | 28 |

Moving predicates earlier increases their application count while reducing join work. Cells fall because scans materialize only fields needed downstream. Hash probes and nested pairs have different costs; no wall-clock speedup is claimed from their ratio.

Catalog analysis separately reads **5,150 cells**, including an unused small table. Those statistics are eagerly built once by this Engine and reused by both plan modes. They are not hidden query execution or free oracle selectivities. The cost model uses NDV/null fractions and heuristics, not measured filter outcomes.

The suite adds 20 random catalogs with NULLs/duplicates and four query templates each. Cross-review cancellation cases are now explicit aggregate-domain regressions: REAL `1e16,-1e16,1` with four duplicate join partners and INTEGER MAXINT/-MAXINT with three partners are consistently rejected by both plans. A bounded REAL cancellation variant is accepted and matches SQLite. Exact order-stability certificates, rather than wider tolerances, enforce the accepted numeric domain; some valid SQLite decimal aggregates are conservatively rejected.

Targeted NULL/multiplicity/COUNT mutations were all killed, with evidence regenerated against the final numeric implementation and 21-test suite; see [mutation-results.json](mutation-results.json). These finite experiments are regression evidence for the documented subset. Large/skewed workloads, native/SIMD execution, production latency, arbitrary finite SQLite aggregation, PostgreSQL equivalence, external spill, and distributed behavior remain unmeasured or unsupported.
