# Architecture

```mermaid
flowchart TD
  Q[SQL text] --> L[syntax.py bounded lexer]
  L --> A[Immutable query and expression AST]
  A --> B[engine.py type and name binder]
  B --> P[Predicate and projection pushdown]
  S[Catalog row NDV and NULL statistics] --> O[Connected bushy join DP]
  P --> O
  O --> H[Batch hash join and aggregate executor]
  B --> N[Reference nested-loop executor]
  H --> R[Rows and measured work]
  O --> X[EXPLAIN estimates and tree]
  R --> D[Duplicate-aware differential checks]
  N --> D
  E[Isolated SQLite oracle] --> D
```

`syntax.py` lexes/parses a documented read-only SQL subset. `engine.py` binds typed columns, builds immutable relational nodes, searches join orders, and exchanges bounded batches. Scan projection controls actual materialized cells; hash buckets preserve duplicates and exclude NULL join keys. Grouping implements separate SQL aggregate/NULL rules.

SUM/AVG use exact integer/common-binary-grid accumulators and conservative order-independence certificates. Inputs that can produce overflow or rounding dependent on physical join order are rejected consistently; arbitrary finite SQLite aggregate compatibility is not claimed.

`experiments.py` constructs seeded catalogs, invokes both plan modes, and compares results with SQLite. SQLite is never a core execution fallback. EXPLAIN estimates are heuristic; work counters describe actual execution, and catalog analysis work is reported separately.

See [DESIGN](sql-and-numeric-contract.md) for grammar, DP cost equations, NULL semantics, operator complexity and limits; [REVIEW](conformance-findings.md) and [EXPERIMENTS](plan-work-counts.md) contain executed evidence.
