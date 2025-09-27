# Seeded catalog reference

`query_forge.experiments.catalog(seed=17)` constructs the tables used by the CLI and saved comparisons: accounts, events, marks, a duplicate/NULL fixture, and an empty table. Schemas and rows are immutable typed snapshots built through `Table`.

To use another in-memory catalog, construct `Table(name, schema, rows)` values and pass them to `Engine`. This directory documents the saved workload; it is not an automatic catalog-file loader. The SQL statement and actual scan/analysis counters are preserved under `explain/`.
