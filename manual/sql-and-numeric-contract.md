# Grammar, plans, optimizer, and execution invariants

## Documented grammar

```text
query := SELECT item (, item)* FROM relation
         ([INNER] JOIN relation ON equijoin (AND equijoin)*)*
         [WHERE boolean] [GROUP BY column (, column)*] [LIMIT integer] [;]
item := column [AS identifier] | * | aggregate [AS identifier]
aggregate := COUNT(*) | (COUNT|SUM|AVG|MIN|MAX)(column)
boolean := conjunction (OR conjunction)*
conjunction := predicate (AND predicate)*
predicate := NOT predicate | (boolean) | scalar comparison scalar
             | scalar IS [NOT] NULL
scalar := column | signed_integer | finite_decimal | quoted_string | NULL
```

Binding resolves aliases and column types before execution. Every ON conjunction connects its new relation to an earlier relation; only column equijoins are accepted. Numeric comparisons allow INTEGER/REAL compatibility, while text/numeric affinity conversions are rejected. Types and rows are copied into immutable table snapshots. The supported limits are six joined relations, 128 expanded output columns, 16 group keys, expression nesting 32, 64 boolean operators, 2,048 tokens, and 16,384 SQL characters. The boolean-operator cap also bounds left-associated expression and filter-plan depth. Input tables, output/intermediate rows, batches, and cell sizes have explicit bounds; these do not replace host memory or CPU controls.

## Relational plan

Typed immutable nodes are `Scan`, `Filter`, `Join`, `Group`, `Project`, and `Limit`. Bound columns carry qualifier, name, and type. Every node's output fields are explicit. Projection pushdown retains the union of selected, grouped, predicate, and join-key columns. COUNT(*) still scans row cardinality even if no cells are materialized. Only complete single-relation WHERE conjuncts are pushed; cross-relation OR expressions remain above joins. Limit is never pushed through filters, joins, or aggregation.

The reference planner preserves the SQL join sequence and performs nested loops. The optimizer partitions a relation subset into connected left/right subplans, considers crossing equality edges, and minimizes its additive cost. For relation subsets S:

```text
best[S] = argmin over connected partitions L union R = S:
          cost(best[L]) + cost(best[R]) + rows(L) + rows(R) + estimated_join_rows
estimated_join_rows ~= rows(L)*rows(R) / max(NDV(left_key), NDV(right_key))
```

Null fractions and additional equality keys reduce the estimate. Base equality selectivity uses distinct counts, ranges use a fixed heuristic, and OR/AND assume independence. Estimates can be wrong with correlation/skew; optimal means minimum within this **estimated** model, not guaranteed minimum runtime. The exhaustive bounded bushy search is O(3^n) in partitions and O(2^n) in retained subplans, with n<=6. Ties and representative statistics use stable ordering. The estimated smaller side is built into a hash table.

## SQL NULL and bag semantics

Comparisons with NULL return UNKNOWN, including NULL=NULL. NOT preserves UNKNOWN; FALSE AND UNKNOWN is FALSE; TRUE OR UNKNOWN is TRUE. Filters retain exactly TRUE. Hash joins skip any key tuple containing NULL. Matching buckets hold lists, preserving duplicate cross products. Nested loops independently check the same SQL equality condition.

Grouping uses NULL as a common key, which is deliberately different from NULL equality in a join. COUNT(*) counts every row, COUNT(column) skips NULL, and other aggregates skip NULL and return NULL for no contributing values. Ungrouped empty aggregates produce one initialized group; explicit grouped empty input produces none.

### Numeric order-stability certificate

Join reordering also reorders aggregate inputs. A plain floating sum can therefore produce materially different answers, and checking only the final integer sum can hide an overflowing intermediate. This engine uses exact accumulators with a conservative **admission certificate**, not a larger comparison tolerance.

INTEGER SUM retains exact Python-integer total, positive subtotal P, and negative subtotal N. It accepts only `P <= 2^63-1` and `N >= -2^63`. Every possible partial sum then lies in int64 bounds, so accepted queries cannot exhibit SQLite's order-dependent intermediate overflow. Final cancellation does not rescue an uncertified input.

For REAL SUM and all AVG, inputs are converted to binary64 (matching AVG's approximate arithmetic), then decomposed exactly as `n_i * 2^e_i`. The accumulator uses the finest nonzero binary grid `e=min(e_i)` and stores exact integer total T and absolute subtotal A:

```text
T = sum(n_i * 2^(e_i-e))
A = sum(abs(n_i * 2^(e_i-e)))
accept only A <= 2^53 and finite ldexp(A,e)
```

Every possible partial sum has a scaled integer magnitude at most A, hence it is exactly representable in binary64 on this grid; requiring the absolute bound to remain finite also excludes overflowing intermediate sums that later cancel. Any addition order therefore agrees with the exact total; AVG divides that total by its non-NULL count. The certificate and result are permutation-invariant. Large shared powers of two are normalized rather than rejected merely for large magnitude. Exponents and accumulator bit lengths are bounded by finite binary64 inputs and the row budget.

This is deliberately conservative: `1e16,-1e16,1` fails the binary certificate, MAXINT/-MAXINT repeated three times fails the integer certificate, and even some benign decimal sequences can fail. Such queries raise `QueryError` in both plan modes; the engine does not claim arbitrary finite SQLite aggregate compatibility. Filters, projections, MIN/MAX, and COUNT do not need this additive certificate. Differential tolerances remain for benign representation differences, not for hiding uncertified cancellation.

## Batch operators and work

Scans materialize only required cells into batches. Filters, projections, and limits transform child batches; hash joins and grouping consume batches while maintaining bounded materialized state and emit batches. Hash join expected time is O(build+probe+matches), memory O(build). Nested loops perform O(left*right) pair checks. Grouping is expected O(rows*aggregate_count) with O(groups*state_width) memory. No external spill, indexes, SIMD, or distributed execution is implemented.

Work counters count scanned rows, materialized cells, predicate applications, nested pairs, hash build/probe rows, emitted join rows, aggregate inputs, emitted batches, and peak stored hash rows. These are different operations, not interchangeable CPU cycles. Eager catalog statistics have their own `catalog_analysis_cells` count and are reusable; the execution comparison does not pretend statistics are free.

## Differential oracle and failure boundary

SQLite is used only in experiments/tests. Typed schemas and parameterized inserts construct an isolated in-memory oracle with `query_only=ON`. The engine itself interprets bound plans and never delegates unsupported SQL. Exact duplicate-aware bags are compared without limits; LIMIT checks cardinality and bag membership because no ORDER BY is supported. A deterministic ordering or SQLite physical join order is not promised.

Unsupported grammar/types, ambiguous references, uncertified numeric aggregation, nonfinite results, excessive plans/rows, and invalid UTF-8 fail explicitly. The catalog and host process remain trusted. This research engine is read-only but is not a substitute for database authorization, query cancellation, or an operating-system sandbox.
