from collections import Counter
import random
import unittest

from query_forge import Engine, QueryError, Table, parse
from query_forge.engine import NumericAccumulator, Work, truth
from query_forge.experiments import DEMO_SQL, bag_subset, catalog, equivalent_to_sqlite, evaluate, sqlite_rows
from query_forge.syntax import Expr, Literal, lex


class ParserAndBindingTests(unittest.TestCase):
    def setUp(self):
        self.engine = Engine(catalog())

    def test_string_escaping_comments_and_case_insensitive_keywords(self):
        sql = "SeLeCt label FROM events -- comment\n WHERE label='a''b' /* safe */ LIMIT 2;"
        result = self.engine.execute(sql)
        self.assertEqual(result["rows"], [("a'b",), ("a'b",)])
        self.assertEqual(next(token.value for token in lex(sql) if token.kind == "STRING"), "a'b")

    def test_unsupported_or_stacked_sql_is_rejected(self):
        invalid = [
            "DROP TABLE events",
            "SELECT label FROM events; DROP TABLE events",
            "SELECT DISTINCT label FROM events",
            "SELECT label FROM events ORDER BY label",
            "SELECT 1 FROM events",
            "SELECT SUM(*) FROM events",
            "SELECT label FROM events LIMIT -1",
            "SELECT label FROM events LIMIT 1.5",
            "SELECT label FROM events WHERE label LIKE 'x'",
            "SELECT label FROM events /*",
            "SELECT label FROM events WHERE label='unterminated",
            "SELECT label FROM events WHERE label='\ud800'",
        ]
        for sql in invalid:
            with self.subTest(sql=sql[:40]), self.assertRaises(QueryError):
                self.engine.execute(sql)

    def test_ambiguous_unknown_and_cross_type_references_rejected(self):
        invalid = [
            "SELECT missing FROM events",
            "SELECT v FROM unknown",
            "SELECT k FROM dups a JOIN dups b ON a.k=b.k",
            "SELECT a.k FROM dups a JOIN dups a ON a.k=a.k",
            "SELECT k FROM dups WHERE k='1'",
            "SELECT SUM(label) FROM dups",
            "SELECT label,COUNT(*) FROM dups",
            "SELECT label FROM dups a JOIN dups b ON a.k<b.k",
            "SELECT a.k FROM dups a JOIN dups b ON a.k=a.k",
        ]
        for sql in invalid:
            with self.subTest(sql=sql), self.assertRaises(QueryError):
                self.engine.execute(sql)

    def test_parser_resource_limits(self):
        with self.assertRaisesRegex(QueryError, "boolean operator budget"):
            parse("SELECT k FROM dups WHERE " + " OR ".join(["k=1"] * 67))
        for sql in (
            " " * 16385,
            "SELECT k FROM dups WHERE " + "NOT " * 34 + "k=1",
            "SELECT k FROM dups LIMIT 100001",
            "SELECT k FROM dups WHERE k=" + "9" * 5000,
        ):
            with self.assertRaises(QueryError):
                parse(sql)

    def test_typed_catalog_is_an_immutable_snapshot(self):
        source = [[1], [2]]
        table = Table("t", {"v": "INTEGER"}, source)
        source[0][0] = 99
        source.append([3])
        self.assertEqual(Engine([table]).execute("SELECT v FROM t")["rows"], [(1,), (2,)])
        for columns, rows in (
            ({"v": "INTEGER"}, [[True]]),
            ({"v": "REAL"}, [[float("nan")]]),
            ({"v": "REAL"}, [[10**500]]),
            ({"v": "TEXT"}, [["\ud800"]]),
            ((("v",),), [[1]]),
        ):
            with self.subTest(columns=columns), self.assertRaises(QueryError):
                Table("t", columns, rows)


class ThreeValuedAndAggregateTests(unittest.TestCase):
    def test_float_cancellation_domain_is_explicit_and_plan_independent(self):
        for values, accepted in (([1e16, -1e16, 1.0], False), ([2.0**30, -(2.0**30), 1.0], True)):
            tables = [
                Table("a", {"k": "INTEGER", "v": "REAL"}, [(1, value) for value in values]),
                Table("b", {"k": "INTEGER"}, [(1,)] * 4),
            ]
            engine = Engine(tables)
            for function in ("SUM", "AVG"):
                sql = f"SELECT {function}(a.v) FROM a JOIN b ON a.k=b.k"
                for optimized in (True, False):
                    if accepted:
                        self.assertEqual(engine.execute(sql, optimize=optimized)["rows"], sqlite_rows(tables, sql))
                    else:
                        with self.assertRaisesRegex(QueryError, "order-stable binary64"):
                            engine.execute(sql, optimize=optimized)

    def test_integer_cancellation_cannot_hide_intermediate_overflow(self):
        tables = [
            Table("a", {"k": "INTEGER", "v": "INTEGER"}, [(1, 2**63 - 1), (1, -(2**63 - 1))]),
            Table("b", {"k": "INTEGER"}, [(1,)] * 3),
        ]
        for optimized in (True, False):
            with self.assertRaisesRegex(QueryError, "order-stable int64"):
                Engine(tables).execute("SELECT SUM(a.v) FROM a JOIN b ON a.k=b.k", optimize=optimized)

    def test_exact_accumulator_certificate_is_permutation_invariant(self):
        rng = random.Random(91)
        for _ in range(30):
            values = [1.5, -2.25, 3.125, 0.0, 7.0]
            rng.shuffle(values)
            accumulator = NumericAccumulator(False)
            for value in values:
                accumulator.add(value)
            self.assertEqual(accumulator.finish(), 9.375)
            values = [1e16, -1e16, 1.0]
            rng.shuffle(values)
            accumulator = NumericAccumulator(False)
            for value in values:
                accumulator.add(value)
            with self.assertRaises(QueryError):
                accumulator.finish()
        accumulator = NumericAccumulator(False)
        for value in (2.0**1023, 2.0**1023, -(2.0**1023)):
            accumulator.add(value)
        with self.assertRaisesRegex(QueryError, "finite-range certificate"):
            accumulator.finish()

    def test_complete_three_valued_truth_tables(self):
        values = [
            Expr("=", (Literal(1), Literal(1))),
            Expr("=", (Literal(1), Literal(2))),
            Expr("=", (Literal(1), Literal(None))),
        ]
        expected_and = [[True, False, None], [False, False, False], [None, False, None]]
        expected_or = [[True, True, True], [True, False, None], [True, None, None]]
        for i, left in enumerate(values):
            for j, right in enumerate(values):
                self.assertIs(truth(Expr("and", (left, right)), {}), expected_and[i][j])
                self.assertIs(truth(Expr("or", (left, right)), {}), expected_or[i][j])
        self.assertIsNone(truth(Expr("not", (values[2],)), {}))

    def test_nulls_group_together_and_count_skips_nulls(self):
        tables = [Table("t", {"k": "INTEGER", "v": "INTEGER"}, [(None, None), (None, 2), (1, None), (1, 3)])]
        engine = Engine(tables, batch_size=1)
        sql = "SELECT k,COUNT(*),COUNT(v),SUM(v),AVG(v),MIN(v),MAX(v) FROM t GROUP BY k"
        self.assertTrue(equivalent_to_sqlite(tables, sql, engine.execute(sql)["rows"]))
        self.assertIn((None, 2, 1, 2, 2.0, 2, 2), engine.execute(sql)["rows"])

    def test_empty_and_all_null_aggregate_contract(self):
        for rows in ([], [(None,), (None,)]):
            table = Table("t", {"v": "INTEGER"}, rows)
            engine = Engine([table])
            result = engine.execute("SELECT COUNT(*),COUNT(v),SUM(v),AVG(v),MIN(v),MAX(v) FROM t")["rows"]
            self.assertEqual(result, [(len(rows), 0, None, None, None, None)])
            self.assertEqual(
                engine.execute("SELECT v,COUNT(*) FROM t GROUP BY v")["rows"], [] if not rows else [(None, len(rows))]
            )

    def test_integer_sum_overflow_is_an_error_not_wrapping(self):
        engine = Engine([Table("t", {"v": "INTEGER"}, [(2**63 - 1,), (1,)])])
        with self.assertRaises(QueryError):
            engine.execute("SELECT SUM(v) FROM t")
        self.assertEqual(engine.execute("SELECT COUNT(*) FROM t")["rows"], [(2,)])

    def test_null_comparison_is_unknown_even_when_both_null(self):
        tables = [Table("t", {"v": "INTEGER"}, [(None,), (1,), (2,)])]
        engine = Engine(tables)
        for predicate in ("v=NULL", "v!=NULL", "NOT v=NULL"):
            self.assertEqual(engine.execute("SELECT v FROM t WHERE " + predicate)["rows"], [])


class PhysicalOperatorTests(unittest.TestCase):
    def test_hash_join_duplicates_and_null_never_matches_null(self):
        tables = [
            Table("a", {"k": "INTEGER"}, [(1,), (1,), (None,)]),
            Table("b", {"k": "INTEGER"}, [(1,), (1,), (1,), (None,)]),
        ]
        engine = Engine(tables, batch_size=2)
        sql = "SELECT a.k,b.k FROM a JOIN b ON a.k=b.k"
        self.assertEqual(Counter(engine.execute(sql)["rows"]), Counter({(1, 1): 6}))
        self.assertEqual(engine.execute(sql)["rows"], engine.execute(sql, optimize=False)["rows"])

    def test_pushdowns_reduce_actual_cells_and_join_work(self):
        engine = Engine(catalog(), batch_size=17)
        optimized = engine.execute(DEMO_SQL)
        reference = engine.execute(DEMO_SQL, optimize=False)
        self.assertEqual(Counter(optimized["rows"]), Counter(reference["rows"]))
        self.assertLess(optimized["work"]["materialized_cells"], reference["work"]["materialized_cells"])
        self.assertEqual(optimized["work"]["nested_pairs"], 0)
        self.assertGreater(reference["work"]["nested_pairs"], optimized["work"]["hash_probes"] * 10)
        self.assertGreater(optimized["catalog_analysis_cells"], 0)

    def test_bushy_cost_search_is_deterministic_and_visible(self):
        engine = Engine(catalog())
        first = engine.explain(DEMO_SQL)
        self.assertEqual(first, engine.explain(DEMO_SQL))
        self.assertIn("hash", str(first))
        self.assertIn("estimated_cost", str(first))
        self.assertIn("projected", str(first))

    def test_every_operator_emits_bounded_batches(self):
        for optimized in (True, False):
            for size in (1, 7, 64):
                engine = Engine(catalog(), batch_size=size)
                _, plan = engine.compile(DEMO_SQL, optimize=optimized)
                for batch in engine._run(plan, Work()):
                    self.assertGreater(len(batch), 0)
                    self.assertLessEqual(len(batch), size)

    def test_limit_without_order_has_valid_cardinality_and_membership(self):
        tables = catalog()
        engine = Engine(tables, batch_size=3)
        sql = "SELECT a.k,b.v FROM dups a JOIN dups b ON a.k=b.k LIMIT 5"
        for optimized in (True, False):
            result = engine.execute(sql, optimize=optimized)
            self.assertTrue(equivalent_to_sqlite(tables, sql, result["rows"]))
        zero = engine.execute("SELECT COUNT(*) FROM events LIMIT 0")
        self.assertEqual(zero["rows"], [])
        self.assertEqual(zero["work"]["scanned_rows"], 0)

    def test_output_and_group_budgets_fail_explicitly(self):
        tables = [Table("a", {"k": "INTEGER"}, [(1,)] * 4), Table("b", {"k": "INTEGER"}, [(1,)] * 4)]
        for optimized in (True, False):
            with self.assertRaisesRegex(QueryError, "budget"):
                Engine(tables, max_output=10).execute("SELECT a.k FROM a JOIN b ON a.k=b.k", optimize=optimized)


class DifferentialTests(unittest.TestCase):
    def test_documented_corpus_both_plans_match_sqlite(self):
        result = evaluate()
        self.assertEqual(result["case_count"], 75)
        self.assertEqual(result["passed"], 75)

    def test_random_null_duplicate_join_and_group_properties(self):
        for seed in range(20):
            rng = random.Random(seed)
            tables = [
                Table(
                    "a",
                    {"k": "INTEGER", "v": "INTEGER"},
                    [(rng.choice([None, 0, 1, 2]), rng.choice([None, -1, 0, 3])) for _ in range(rng.randrange(9))],
                ),
                Table(
                    "b",
                    {"k": "INTEGER", "w": "INTEGER"},
                    [(rng.choice([None, 0, 1, 2]), rng.choice([None, 0, 2])) for _ in range(rng.randrange(9))],
                ),
            ]
            engine = Engine(tables, batch_size=1 + seed % 4)
            queries = [
                "SELECT a.k,b.w FROM a JOIN b ON a.k=b.k",
                "SELECT a.k,COUNT(*),SUM(a.v),AVG(b.w) FROM a JOIN b ON a.k=b.k GROUP BY a.k",
                "SELECT k,COUNT(v),SUM(v) FROM a WHERE NOT (v=0 OR k IS NULL) GROUP BY k",
                "SELECT COUNT(*),SUM(a.v) FROM a JOIN b ON a.k=b.k WHERE b.w IS NULL OR a.v>0",
            ]
            for sql in queries:
                expected = sqlite_rows(tables, sql)
                for optimized in (True, False):
                    actual = engine.execute(sql, optimize=optimized)["rows"]
                    self.assertEqual(len(actual), len(expected))
                    self.assertTrue(bag_subset(actual, expected), (seed, sql, actual, expected))


if __name__ == "__main__":
    unittest.main()
