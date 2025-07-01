"""Typed plans, dynamic-programming join order and bounded batch execution."""

from __future__ import annotations

from dataclasses import asdict, dataclass, replace
import math
import re

from .syntax import Aggregate, Column, Expr, Literal, Query, QueryError, SelectItem, columns, conjuncts, parse

IDENT = re.compile(r"[a-z_][a-z_0-9]*\Z")
NUMERIC = {"INTEGER", "REAL"}


@dataclass(frozen=True, init=False)
class Table:
    name: str
    columns: tuple[tuple[str, str], ...]
    rows: tuple[tuple, ...]

    def __init__(self, name, columns, rows):
        try:
            schema = tuple(columns.items()) if isinstance(columns, dict) else tuple(columns)
        except TypeError as error:
            raise QueryError("schema must be column/type pairs") from error
        if any(
            not isinstance(entry, (tuple, list)) or len(entry) != 2 or not isinstance(entry[0], str) for entry in schema
        ):
            raise QueryError("schema must be named column/type pairs")
        if (
            not isinstance(name, str)
            or not IDENT.fullmatch(name)
            or not 1 <= len(schema) <= 64
            or len({entry[0] for entry in schema}) != len(schema)
        ):
            raise QueryError("invalid table/schema")
        if any(
            not isinstance(key, str)
            or not IDENT.fullmatch(key)
            or not isinstance(dtype, str)
            or dtype not in {"INTEGER", "REAL", "TEXT"}
            for key, dtype in schema
        ):
            raise QueryError("invalid column name or type")
        materialized = []
        for row in rows:
            if not isinstance(row, (tuple, list)) or len(row) != len(schema):
                raise QueryError("row width does not match schema")
            converted = []
            for value, (_, dtype) in zip(row, schema):
                if value is None:
                    converted.append(None)
                elif dtype == "INTEGER" and type(value) is int and -(2**63) <= value < 2**63:
                    converted.append(value)
                elif dtype == "REAL" and type(value) in {int, float}:
                    try:
                        number = float(value)
                    except OverflowError as error:
                        raise QueryError("REAL value overflows finite contract") from error
                    if not math.isfinite(number):
                        raise QueryError("REAL value must be finite")
                    converted.append(number)
                elif dtype == "TEXT" and isinstance(value, str):
                    try:
                        size = len(value.encode("utf-8"))
                    except UnicodeEncodeError as error:
                        raise QueryError("TEXT must be valid UTF-8") from error
                    if size > 4096:
                        raise QueryError("TEXT cell byte budget exceeded")
                    converted.append(value)
                else:
                    raise QueryError("cell violates declared finite/int64 schema")
            materialized.append(tuple(converted))
            if len(materialized) > 100000:
                raise QueryError("input table row budget exceeded")
        object.__setattr__(self, "name", name)
        object.__setattr__(self, "columns", schema)
        object.__setattr__(self, "rows", tuple(materialized))


@dataclass(frozen=True)
class Scan:
    table: Table
    alias: str
    projected: tuple[str, ...]
    estimated: float
    cost: float


@dataclass(frozen=True)
class Filter:
    child: object
    predicate: Expr
    estimated: float
    cost: float


@dataclass(frozen=True)
class Join:
    left: object
    right: object
    keys: tuple[tuple[Column, Column], ...]
    algorithm: str
    build: str
    estimated: float
    cost: float


@dataclass(frozen=True)
class Group:
    child: object
    keys: tuple[Column, ...]
    items: tuple[SelectItem, ...]


@dataclass(frozen=True)
class Project:
    child: object
    items: tuple[SelectItem, ...]


@dataclass(frozen=True)
class Limit:
    child: object
    count: int


@dataclass
class Work:
    scanned_rows: int = 0
    materialized_cells: int = 0
    predicate_evaluations: int = 0
    nested_pairs: int = 0
    hash_build_rows: int = 0
    hash_probes: int = 0
    joined_rows: int = 0
    aggregate_rows: int = 0
    emitted_batches: int = 0
    peak_hash_rows: int = 0


@dataclass
class NumericAccumulator:
    """Exact accumulation plus a conservative order-independence certificate.

    INTEGER SUM accepts only when positive/negative subtotals cannot overflow
    in any order. Floating SUM/AVG use an exact common binary grid and accept
    only if its absolute subtotal fits 53 bits, certifying exact IEEE additions.
    """

    integer: bool
    total: int = 0
    positive: int = 0
    negative: int = 0
    absolute: int = 0
    exponent: int | None = None
    count: int = 0

    def add(self, value):
        self.count += 1
        if self.integer:
            self.total += value
            self.positive += max(value, 0)
            self.negative += min(value, 0)
            return
        numerator, denominator = float(value).as_integer_ratio()
        if numerator == 0:
            return
        trailing = (abs(numerator) & -abs(numerator)).bit_length() - 1
        numerator >>= trailing
        exponent = trailing - (denominator.bit_length() - 1)
        if self.exponent is None:
            self.exponent = exponent
        elif exponent < self.exponent:
            self.total <<= self.exponent - exponent
            self.absolute <<= self.exponent - exponent
            self.exponent = exponent
        numerator <<= exponent - self.exponent
        self.total += numerator
        self.absolute += abs(numerator)

    def finish(self, *, average=False):
        if self.integer:
            if self.positive >= 2**63 or self.negative < -(2**63):
                raise QueryError("INTEGER SUM lacks an order-stable int64 certificate")
            return self.total
        if self.absolute > 2**53:
            raise QueryError("floating SUM/AVG lacks an order-stable binary64 certificate")
        try:
            bound = math.ldexp(float(self.absolute), self.exponent or 0)
            value = math.ldexp(float(self.total), self.exponent or 0)
        except OverflowError as error:
            raise QueryError("floating SUM/AVG lacks an order-stable finite-range certificate") from error
        if not math.isfinite(bound):
            raise QueryError("floating SUM/AVG lacks an order-stable finite-range certificate")
        return value / self.count if average else value


def aliases(plan):
    if isinstance(plan, Scan):
        return {plan.alias}
    if isinstance(plan, Join):
        return aliases(plan.left) | aliases(plan.right)
    return aliases(plan.child)


def signature(plan):
    if isinstance(plan, Scan):
        return plan.alias
    if isinstance(plan, Join):
        return "(" + signature(plan.left) + "," + signature(plan.right) + ")"
    return signature(plan.child)


def scalar(value, row):
    return row[value.key] if isinstance(value, Column) else value.value


def truth(expression: Expr, row):
    op = expression.op
    if op == "not":
        value = truth(expression.args[0], row)
        return None if value is None else not value
    if op in {"and", "or"}:
        left, right = (truth(argument, row) for argument in expression.args)
        if op == "and":
            return False if left is False or right is False else (None if left is None or right is None else True)
        return True if left is True or right is True else (None if left is None or right is None else False)
    left = scalar(expression.args[0], row)
    if op == "is-null":
        return left is None
    if op == "is-not-null":
        return left is not None
    right = scalar(expression.args[1], row)
    if left is None or right is None:
        return None
    return {
        "=": lambda: left == right,
        "!=": lambda: left != right,
        "<>": lambda: left != right,
        "<": lambda: left < right,
        "<=": lambda: left <= right,
        ">": lambda: left > right,
        ">=": lambda: left >= right,
    }[op]()


class Engine:
    def __init__(self, tables, *, batch_size=64, max_output=100000):
        if (
            type(batch_size) is not int
            or not 1 <= batch_size <= 4096
            or type(max_output) is not int
            or not 1 <= max_output <= 1000000
        ):
            raise QueryError("invalid execution budgets")
        values = tuple(tables)
        if (
            not values
            or any(not isinstance(table, Table) for table in values)
            or len({table.name for table in values}) != len(values)
        ):
            raise QueryError("catalog requires uniquely named typed tables")
        self.tables = {table.name: table for table in values}
        self.batch_size, self.max_output = batch_size, max_output
        self.statistics = {}
        self.analysis_cells = 0
        for table in values:
            for index, (column, _) in enumerate(table.columns):
                cells = [row[index] for row in table.rows]
                self.statistics[(table.name, column)] = {
                    "ndv": len(set(value for value in cells if value is not None)),
                    "nulls": sum(value is None for value in cells),
                    "rows": len(cells),
                }
                self.analysis_cells += len(cells)

    def bind(self, query: Query):
        relations = {relation.alias: relation for relation in query.relations}
        if len(relations) != len(query.relations) or any(
            relation.table not in self.tables for relation in query.relations
        ):
            raise QueryError("unknown table or duplicate relation alias")
        schemas = {alias: dict(self.tables[relation.table].columns) for alias, relation in relations.items()}

        def bind_column(column):
            candidates = [
                alias
                for alias, schema in schemas.items()
                if column.name in schema and (column.qualifier is None or column.qualifier == alias)
            ]
            if len(candidates) != 1:
                raise QueryError("unknown or ambiguous column")
            alias = candidates[0]
            return Column(alias, column.name, schemas[alias][column.name])

        def bind_expr(expression):
            if isinstance(expression, Column):
                return bind_column(expression)
            if isinstance(expression, Literal):
                return expression
            bound = Expr(expression.op, tuple(bind_expr(value) for value in expression.args))
            if expression.op in {"=", "!=", "<>", "<", "<=", ">", ">="}:

                def dtype(value):
                    if isinstance(value, Column):
                        return value.dtype
                    return (
                        None
                        if value.value is None
                        else (
                            "TEXT"
                            if isinstance(value.value, str)
                            else "REAL"
                            if isinstance(value.value, float)
                            else "INTEGER"
                        )
                    )

                left, right = (dtype(value) for value in bound.args)
                if left and right and left != right and not {left, right} <= NUMERIC:
                    raise QueryError("cross-type affinity coercions are outside this typed subset")
            return bound

        items = []
        for item in query.items:
            if item.expression == "*":
                items.extend(
                    SelectItem(Column(alias, name, dtype))
                    for alias, schema in schemas.items()
                    for name, dtype in schema.items()
                )
            elif isinstance(item.expression, Aggregate):
                aggregate = item.expression
                argument = bind_column(aggregate.argument) if aggregate.argument else None
                if aggregate.function in {"sum", "avg"} and argument.dtype not in NUMERIC:
                    raise QueryError("SUM/AVG require numeric columns")
                items.append(replace(item, expression=Aggregate(aggregate.function, argument)))
            else:
                items.append(replace(item, expression=bind_column(item.expression)))
        group = tuple(bind_column(value) for value in query.group)
        if len(items) > 128:
            raise QueryError("expanded projection budget exceeded")
        aggregated = bool(group) or any(isinstance(item.expression, Aggregate) for item in items)
        if aggregated and any(isinstance(item.expression, Column) and item.expression not in group for item in items):
            raise QueryError("nonaggregate output must appear in GROUP BY")
        joins = tuple(bind_expr(value) for value in query.joins)
        available = {query.relations[0].alias}
        for relation, join in zip(query.relations[1:], joins):
            previous = set(available)
            available.add(relation.alias)
            for predicate in conjuncts(join):
                if predicate.op != "=" or not all(isinstance(value, Column) for value in predicate.args):
                    raise QueryError("JOIN ON supports conjunctions of column equijoins")
                left, right = predicate.args
                if (
                    left.qualifier == right.qualifier
                    or not {left.qualifier, right.qualifier} <= available
                    or relation.alias not in {left.qualifier, right.qualifier}
                    or not {left.qualifier, right.qualifier} & previous
                ):
                    raise QueryError("each JOIN condition must connect its new relation to an earlier relation")
        return Query(
            tuple(items), query.relations, joins, bind_expr(query.where) if query.where else None, group, query.limit
        )

    def _selectivity(self, expression, relations):
        if expression.op in {"and", "or"}:
            left, right = (self._selectivity(value, relations) for value in expression.args)
            return left * right if expression.op == "and" else left + right - left * right
        if expression.op == "not":
            return 1 - self._selectivity(expression.args[0], relations)
        column = next(iter(sorted(columns(expression), key=lambda value: value.key)), None)
        if column is None:
            return float(truth(expression, {}) is True)
        stats = self.statistics[(relations[column.qualifier].table, column.name)]
        nonnull = 1 - stats["nulls"] / max(1, stats["rows"])
        if expression.op == "is-null":
            return 1 - nonnull
        if expression.op == "is-not-null":
            return nonnull
        return nonnull / max(1, stats["ndv"]) if expression.op == "=" else 0.33

    def compile(self, sql: str, *, optimize=True):
        query = self.bind(parse(sql))
        relations = {relation.alias: relation for relation in query.relations}
        required = {alias: set() for alias in relations}
        for item in query.items:
            expression = item.expression
            column = expression.argument if isinstance(expression, Aggregate) else expression
            if isinstance(column, Column):
                required[column.qualifier].add(column.name)
        for column in query.group:
            required[column.qualifier].add(column.name)
        for expression in (*query.joins, *((query.where,) if query.where else ())):
            for column in columns(expression):
                required[column.qualifier].add(column.name)
        pushed = {alias: [] for alias in relations}
        residual = []
        for predicate in conjuncts(query.where):
            referenced = {column.qualifier for column in columns(predicate)}
            if optimize and len(referenced) <= 1:
                pushed[next(iter(referenced), query.relations[0].alias)].append(predicate)
            else:
                residual.append(predicate)
        leaves = {}
        for alias, relation in relations.items():
            table = self.tables[relation.table]
            projected = tuple(name for name, _ in table.columns if not optimize or name in required[alias])
            count = float(len(table.rows))
            plan = Scan(table, alias, projected, count, count * (1 + 0.05 * len(projected)))
            for predicate in pushed[alias]:
                estimate = plan.estimated * self._selectivity(predicate, relations)
                plan = Filter(plan, predicate, estimate, plan.cost + plan.estimated)
            leaves[alias] = plan
        predicates = [predicate for join in query.joins for predicate in conjuncts(join)]

        def join_plan(left, right, algorithm):
            crossing = []
            for predicate in predicates:
                first, second = predicate.args
                if first.qualifier in aliases(left) and second.qualifier in aliases(right):
                    crossing.append((first, second))
                elif second.qualifier in aliases(left) and first.qualifier in aliases(right):
                    crossing.append((second, first))
            if not crossing:
                return None
            estimate = left.estimated * right.estimated
            for first, second in crossing:
                a = self.statistics[(relations[first.qualifier].table, first.name)]
                b = self.statistics[(relations[second.qualifier].table, second.name)]
                estimate *= (
                    (1 - a["nulls"] / max(1, a["rows"]))
                    * (1 - b["nulls"] / max(1, b["rows"]))
                    / max(1, a["ndv"], b["ndv"])
                )
            cost = (
                left.cost
                + right.cost
                + (left.estimated + right.estimated if algorithm == "hash" else left.estimated * right.estimated)
                + estimate
            )
            return Join(
                left,
                right,
                tuple(crossing),
                algorithm,
                "left" if left.estimated <= right.estimated else "right",
                estimate,
                cost,
            )

        if optimize and len(leaves) > 1:
            names = tuple(leaves)
            best = {1 << index: leaves[name] for index, name in enumerate(names)}
            for mask in range(1, 1 << len(names)):
                if mask in best:
                    continue
                subset = (mask - 1) & mask
                while subset:
                    other = mask ^ subset
                    if subset in best and other in best:
                        candidate = join_plan(best[subset], best[other], "hash")
                        if candidate and (
                            mask not in best
                            or (candidate.cost, signature(candidate)) < (best[mask].cost, signature(best[mask]))
                        ):
                            best[mask] = candidate
                    subset = (subset - 1) & mask
            if (1 << len(names)) - 1 not in best:
                raise QueryError("join graph is disconnected")
            plan = best[(1 << len(names)) - 1]
        else:
            plan = leaves[query.relations[0].alias]
            for relation in query.relations[1:]:
                plan = join_plan(plan, leaves[relation.alias], "nested")
                if plan is None:
                    raise QueryError("join graph is disconnected")
        for predicate in residual:
            plan = Filter(plan, predicate, plan.estimated * 0.33, plan.cost + plan.estimated)
        if query.group or any(isinstance(item.expression, Aggregate) for item in query.items):
            plan = Group(plan, query.group, query.items)
        plan = Project(plan, query.items)
        if query.limit is not None:
            plan = Limit(plan, query.limit)
        return query, plan

    def _run(self, plan, work):
        size = self.batch_size
        if isinstance(plan, Scan):
            positions = [
                (name, next(index for index, entry in enumerate(plan.table.columns) if entry[0] == name))
                for name in plan.projected
            ]
            for start in range(0, len(plan.table.rows), size):
                source = plan.table.rows[start : start + size]
                work.scanned_rows += len(source)
                work.materialized_cells += len(source) * len(positions)
                work.emitted_batches += 1
                yield [{f"{plan.alias}.{name}": row[index] for name, index in positions} for row in source]
        elif isinstance(plan, Filter):
            for batch in self._run(plan.child, work):
                work.predicate_evaluations += len(batch)
                filtered = [row for row in batch if truth(plan.predicate, row) is True]
                if filtered:
                    work.emitted_batches += 1
                    yield filtered
        elif isinstance(plan, Join):
            output = []
            emitted = 0
            if plan.algorithm == "nested":
                right_rows = [row for batch in self._run(plan.right, work) for row in batch]
                for batch in self._run(plan.left, work):
                    for left in batch:
                        for right in right_rows:
                            work.nested_pairs += 1
                            if all(
                                left[a.key] is not None and right[b.key] is not None and left[a.key] == right[b.key]
                                for a, b in plan.keys
                            ):
                                output.append({**left, **right})
                                work.joined_rows += 1
                                emitted += 1
                                if emitted > self.max_output:
                                    raise QueryError("join output budget exceeded")
                                if len(output) == size:
                                    work.emitted_batches += 1
                                    yield output
                                    output = []
            else:
                build_left = plan.build == "left"
                build, probe = (plan.left, plan.right) if build_left else (plan.right, plan.left)
                build_keys = [a if build_left else b for a, b in plan.keys]
                probe_keys = [b if build_left else a for a, b in plan.keys]
                buckets = {}
                stored = 0
                for batch in self._run(build, work):
                    for row in batch:
                        work.hash_build_rows += 1
                        key = tuple(row[column.key] for column in build_keys)
                        if None not in key:
                            buckets.setdefault(key, []).append(row)
                            stored += 1
                work.peak_hash_rows = max(work.peak_hash_rows, stored)
                for batch in self._run(probe, work):
                    for row in batch:
                        key = tuple(row[column.key] for column in probe_keys)
                        if None in key:
                            continue
                        work.hash_probes += 1
                        for matching in buckets.get(key, ()):
                            output.append({**matching, **row})
                            emitted += 1
                            work.joined_rows += 1
                            if emitted > self.max_output:
                                raise QueryError("join output budget exceeded")
                            if len(output) == size:
                                work.emitted_batches += 1
                                yield output
                                output = []
            if output:
                work.emitted_batches += 1
                yield output
        elif isinstance(plan, Group):
            groups = {(): [None] * len(plan.items)} if not plan.keys else {}
            for batch in self._run(plan.child, work):
                for row in batch:
                    work.aggregate_rows += 1
                    key = tuple(row[column.key] for column in plan.keys)
                    state = groups.setdefault(key, [None] * len(plan.items))
                    if len(groups) > self.max_output:
                        raise QueryError("group count budget exceeded")
                    for index, item in enumerate(plan.items):
                        aggregate = item.expression
                        if not isinstance(aggregate, Aggregate):
                            continue
                        value = row[aggregate.argument.key] if aggregate.argument else 1
                        function = aggregate.function
                        if function == "count":
                            state[index] = (state[index] or 0) + (value is not None)
                        elif value is not None:
                            if function in {"sum", "avg"}:
                                if state[index] is None:
                                    state[index] = NumericAccumulator(
                                        function == "sum" and aggregate.argument.dtype == "INTEGER"
                                    )
                                state[index].add(value)
                            else:
                                state[index] = (
                                    value
                                    if state[index] is None
                                    else (min(state[index], value) if function == "min" else max(state[index], value))
                                )
            output = []
            for key, state in groups.items():
                row = {column.key: value for column, value in zip(plan.keys, key)}
                for index, item in enumerate(plan.items):
                    if isinstance(item.expression, Aggregate):
                        function = item.expression.function
                        value = state[index]
                        row[f"agg{index}"] = (
                            (value or 0)
                            if function == "count"
                            else (
                                value.finish(average=function == "avg")
                                if function in {"sum", "avg"} and value is not None
                                else value
                            )
                        )
                        if isinstance(row[f"agg{index}"], float) and not math.isfinite(row[f"agg{index}"]):
                            raise QueryError("aggregate exceeds finite result contract")
                output.append(row)
                if len(output) == size:
                    work.emitted_batches += 1
                    yield output
                    output = []
            if output:
                work.emitted_batches += 1
                yield output
        elif isinstance(plan, Project):
            for batch in self._run(plan.child, work):
                work.emitted_batches += 1
                yield [
                    {
                        f"out{index}": row[f"agg{index}"]
                        if isinstance(item.expression, Aggregate)
                        else row[item.expression.key]
                        for index, item in enumerate(plan.items)
                    }
                    for row in batch
                ]
        elif isinstance(plan, Limit):
            remaining = plan.count
            if remaining == 0:
                return
            for batch in self._run(plan.child, work):
                output = batch[:remaining]
                work.emitted_batches += 1
                yield output
                remaining -= len(output)
                if remaining == 0:
                    break
        else:
            raise QueryError("unknown physical operator")

    def execute(self, sql, *, optimize=True):
        query, plan = self.compile(sql, optimize=optimize)
        work = Work()
        rows = []
        for batch in self._run(plan, work):
            rows.extend(tuple(row[f"out{index}"] for index in range(len(query.items))) for row in batch)
            if len(rows) > self.max_output:
                raise QueryError("result output budget exceeded")
        labels = [
            item.alias
            or (
                item.expression.key
                if isinstance(item.expression, Column)
                else item.expression.function.upper()
                + "("
                + (item.expression.argument.key if item.expression.argument else "*")
                + ")"
            )
            for item in query.items
        ]
        return {
            "columns": labels,
            "rows": rows,
            "work": asdict(work),
            "plan": self.explain_plan(plan),
            "catalog_analysis_cells": self.analysis_cells,
        }

    def explain(self, sql, *, optimize=True):
        _, plan = self.compile(sql, optimize=optimize)
        return self.explain_plan(plan)

    def explain_plan(self, plan):
        result = {"operator": type(plan).__name__, "relations": sorted(aliases(plan))}
        if isinstance(plan, Scan):
            result.update(table=plan.table.name, alias=plan.alias, projected=list(plan.projected))
        elif isinstance(plan, Join):
            result.update(
                algorithm=plan.algorithm,
                build=plan.build,
                keys=[[a.key, b.key] for a, b in plan.keys],
                children=[self.explain_plan(plan.left), self.explain_plan(plan.right)],
            )
        else:
            result["child"] = self.explain_plan(plan.child)
            if isinstance(plan, Filter):
                result["predicate"] = repr(plan.predicate)
            elif isinstance(plan, Group):
                result["group_keys"] = [column.key for column in plan.keys]
            elif isinstance(plan, Limit):
                result["count"] = plan.count
        if hasattr(plan, "estimated"):
            result.update(estimated_rows=round(plan.estimated, 4), estimated_cost=round(plan.cost, 4))
        return result
