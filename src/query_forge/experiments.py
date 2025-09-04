"""Differential SQLite oracle and deterministic operator-work experiments."""

from __future__ import annotations

import math
import random
import sqlite3

from .engine import Engine, Table
from .syntax import lex, parse

DEMO_SQL = """SELECT a.segment, COUNT(*) AS n, SUM(e.value) AS total
FROM accounts a JOIN events e ON a.id=e.account_id
JOIN marks m ON e.account_id=m.account_id
WHERE m.tag='keep' AND e.value>=10 GROUP BY a.segment"""


def catalog(seed=17):
    rng = random.Random(seed)
    return [
        Table(
            "accounts",
            {"id": "INTEGER", "segment": "TEXT", "unused": "TEXT", "extra": "INTEGER"},
            [(i, None if i % 13 == 0 else ("red" if i % 2 else "blue"), "unused-payload", i * 3) for i in range(80)],
        ),
        Table(
            "events",
            {"account_id": "INTEGER", "value": "REAL", "label": "TEXT", "unused": "TEXT"},
            [
                (
                    None if i % 31 == 0 else i % 80,
                    None if i % 7 == 0 else float(rng.randrange(-10, 60)),
                    "a'b" if i % 9 == 0 else "plain",
                    "payload",
                )
                for i in range(1200)
            ],
        ),
        Table(
            "marks",
            {"account_id": "INTEGER", "tag": "TEXT", "unused": "TEXT"},
            [(0, "keep", "x"), (7, "drop", "x"), (13, "keep", "x"), (42, "keep", "x")],
        ),
        Table(
            "dups",
            {"k": "INTEGER", "label": "TEXT", "v": "INTEGER"},
            [(None, None, None), (1, "a", 2), (1, "a", 2), (1, None, 3), (2, "b", None), (2, "b", -3)],
        ),
        Table("empty", {"id": "INTEGER", "v": "REAL"}, []),
    ]


def sqlite_rows(tables, sql):
    connection = sqlite3.connect(":memory:")
    try:
        for table in tables:
            schema = ",".join(f'"{name}" {dtype}' for name, dtype in table.columns)
            connection.execute(f'CREATE TABLE "{table.name}" ({schema})')
            connection.executemany(
                f'INSERT INTO "{table.name}" VALUES({",".join("?" for _ in table.columns)})', table.rows
            )
        connection.execute("PRAGMA query_only=ON")
        return connection.execute(sql).fetchall()
    finally:
        connection.close()


def rows_equal(left, right):
    return len(left) == len(right) and all(
        (a == b)
        or (type(a) in {int, float} and type(b) in {int, float} and math.isclose(a, b, rel_tol=1e-10, abs_tol=1e-9))
        for a, b in zip(left, right)
    )


def bag_subset(left, right):
    available = list(right)
    for row in left:
        index = next((index for index, candidate in enumerate(available) if rows_equal(row, candidate)), None)
        if index is None:
            return False
        available.pop(index)
    return True


def equivalent_to_sqlite(tables, sql, rows):
    query = parse(sql)
    if query.limit is None:
        expected = sqlite_rows(tables, sql)
        return len(rows) == len(expected) and bag_subset(rows, expected)
    # SQL does not define row order without ORDER BY. Validate LIMIT cardinality
    # and duplicate-aware membership against the complete SQLite result instead
    # of pretending its optimizer's arbitrary row choice is specified semantics.
    limit_token = next(token for token in lex(sql) if token.kind == "IDENT" and token.value == "limit")
    expected = sqlite_rows(tables, sql[: limit_token.offset])
    return len(rows) == min(query.limit, len(expected)) and bag_subset(rows, expected)


def cases(seed=17):
    queries = [
        DEMO_SQL,
        "SELECT COUNT(*),COUNT(value),SUM(value),AVG(value),MIN(value),MAX(value) FROM events",
        "SELECT segment,COUNT(*) FROM accounts GROUP BY segment",
        "SELECT k,COUNT(*),COUNT(v),SUM(v),AVG(v),MIN(v),MAX(v) FROM dups GROUP BY k",
        "SELECT COUNT(*),SUM(v),AVG(v),MIN(v),MAX(v) FROM empty",
        "SELECT id FROM empty WHERE id IS NULL",
        "SELECT a.k,a.label,b.v FROM dups a JOIN dups b ON a.k=b.k",
        "SELECT a.k,b.v FROM dups a JOIN dups b ON a.k=b.k AND a.label=b.label",
        "SELECT k FROM dups WHERE NOT (v=2 OR v IS NULL)",
        "SELECT k FROM dups WHERE v=NULL OR v IS NULL",
        "SELECT label FROM events WHERE label='a''b' LIMIT 3",
        "SELECT COUNT(*) FROM events WHERE value IS NULL AND value=1",
        "SELECT * FROM dups LIMIT 0",
        "SELECT COUNT(*) FROM empty JOIN dups ON empty.id=dups.k",
        "SELECT k FROM dups GROUP BY k LIMIT 2",
    ]
    rng = random.Random(seed)
    for index in range(60):
        threshold = rng.randrange(-10, 60)
        op = rng.choice(("=", "!=", "<", "<=", ">", ">="))
        template = index % 6
        if template == 0:
            query = f"SELECT account_id,value FROM events WHERE value {op} {threshold} AND account_id IS NOT NULL LIMIT {rng.randrange(8)}"
        elif template == 1:
            query = f"SELECT a.segment,COUNT(e.value),SUM(e.value) FROM accounts a JOIN events e ON a.id=e.account_id WHERE e.value {op} {threshold} GROUP BY a.segment"
        elif template == 2:
            query = f"SELECT COUNT(*) FROM events WHERE NOT (value {op} {threshold}) OR value IS NULL"
        elif template == 3:
            query = f"SELECT k,label FROM dups WHERE v IS NULL OR (v {op} {threshold} AND NOT k IS NULL)"
        elif template == 4:
            query = f"SELECT account_id,MIN(value),MAX(value),AVG(value) FROM events WHERE value {op} {threshold} GROUP BY account_id LIMIT 4"
        else:
            query = f"SELECT COUNT(*),SUM(e.value) FROM marks m JOIN events e ON m.account_id=e.account_id JOIN accounts a ON a.id=e.account_id WHERE e.value {op} {threshold} AND (m.tag='keep' OR a.segment IS NULL)"
        queries.append(query)
    return queries


def demo():
    tables = catalog()
    engine = Engine(tables, batch_size=32)
    optimized = engine.execute(DEMO_SQL)
    reference = engine.execute(DEMO_SQL, optimize=False)
    return {
        "experiment": "actual typed SQL plan and operator work",
        "sql": DEMO_SQL,
        "optimized": optimized,
        "reference": reference,
        "matches_sqlite": equivalent_to_sqlite(tables, DEMO_SQL, optimized["rows"]),
        "metric_scope": "Work counts are executed operators; catalog-analysis cells are reported separately. No elapsed-time or production-scale speedup claim.",
    }


def evaluate(seed=17):
    tables = catalog(seed)
    engine = Engine(tables, batch_size=31)
    rows = []
    for index, sql in enumerate(cases(seed)):
        optimized = engine.execute(sql)
        reference = engine.execute(sql, optimize=False)
        rows.append(
            {
                "id": index,
                "sql": sql,
                "optimized_matches_sqlite": equivalent_to_sqlite(tables, sql, optimized["rows"]),
                "reference_matches_sqlite": equivalent_to_sqlite(tables, sql, reference["rows"]),
                "rows": len(optimized["rows"]),
                "optimized_work": optimized["work"],
                "reference_work": reference["work"],
            }
        )
    return {
        "experiment": "seeded differential SQLite and reference-plan correctness",
        "seed": seed,
        "case_count": len(rows),
        "passed": sum(row["optimized_matches_sqlite"] and row["reference_matches_sqlite"] for row in rows),
        "cases": rows,
        "limits": [
            "SQL subset uses typed comparisons and finite/int64 values; SQLite affinity coercions and arbitrary SQL are unsupported.",
            "Without ORDER BY, LIMIT is checked for cardinality and duplicate-aware membership, not an unspecified row order.",
            "Fixed synthetic cases do not establish correctness for all queries or production database performance.",
        ],
    }
