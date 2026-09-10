# Distributing the engine and its plans

Start with a query text and the typed catalog it uses. Include both plan modes, their result bags, and separate execution/analysis counters when publishing a comparison. The catalog reference in `catalogs/` points to the seeded generator; the CLI does not load arbitrary SQL catalog files from that directory.

```bash
python -m pip install -e . -r requirements-dev.txt
python tools/check_engine.py --require-lint --wheel
python -m query_forge demo --output artifacts/plan-comparison.json
```

The checker tests the wheel outside the source tree. Inspect the [check results](check-results.md), then verify that the saved comparison still states the LIMIT and numeric admission rules. A wheel containing a broader parser but an older contract would be misleading even if its simple demo passed.

For a source archive or repository upload, retain `manual/`, `conformance/`, `catalogs/`, and `explain/` with the package and license. Use a repository URL you own when configuring a remote. CI calls `tools/check_engine.py`; its output remains `reports/verification.json` so comparison tooling can find it without knowing the source layout.
