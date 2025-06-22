"""SQL lexer, recursive-descent parser and immutable typed expression nodes."""

from __future__ import annotations

from dataclasses import dataclass
import math
import re


class QueryError(ValueError):
    pass


@dataclass(frozen=True)
class Token:
    kind: str
    value: str
    offset: int


def lex(sql: str) -> list[Token]:
    if not isinstance(sql, str) or len(sql) > 16384:
        raise QueryError("SQL must be a string of at most 16384 characters")
    try:
        sql.encode("utf-8")
    except UnicodeEncodeError as error:
        raise QueryError("SQL must be valid UTF-8") from error
    result = []
    position = 0
    while position < len(sql):
        char = sql[position]
        if char in " \t\r\n\f":
            position += 1
            continue
        if sql.startswith("--", position):
            position = sql.find("\n", position)
            if position < 0:
                position = len(sql)
            continue
        if sql.startswith("/*", position):
            end = sql.find("*/", position + 2)
            if end < 0:
                raise QueryError("unterminated comment")
            position = end + 2
            continue
        start = position
        if char == "'":
            position += 1
            value = ""
            while position < len(sql):
                if sql[position] == "'":
                    if position + 1 < len(sql) and sql[position + 1] == "'":
                        value += "'"
                        position += 2
                    else:
                        position += 1
                        break
                else:
                    value += sql[position]
                    position += 1
            else:
                raise QueryError("unterminated string literal")
            result.append(Token("STRING", value, start))
        elif match := re.match(r"-?[0-9]+(?:\.[0-9]+)?", sql[position:]):
            value = match.group()
            position += len(value)
            result.append(Token("NUMBER", value, start))
        elif match := re.match(r"[A-Za-z_][A-Za-z_0-9]*", sql[position:]):
            value = match.group().lower()
            position += len(value)
            result.append(Token("IDENT", value, start))
        else:
            operator = sql[position : position + 2]
            if operator in {"<=", ">=", "!=", "<>"}:
                position += 2
            elif char in "(),.*;=<>":
                operator = char
                position += 1
            else:
                raise QueryError(f"unsupported character at offset {position}")
            result.append(Token(operator, operator, start))
        if len(result) > 2048:
            raise QueryError("SQL token budget exceeded")
    result.append(Token("EOF", "", position))
    return result


@dataclass(frozen=True)
class Column:
    qualifier: str | None
    name: str
    dtype: str | None = None

    @property
    def key(self):
        return f"{self.qualifier}.{self.name}"


@dataclass(frozen=True)
class Literal:
    value: int | float | str | None


@dataclass(frozen=True)
class Expr:
    op: str
    args: tuple


@dataclass(frozen=True)
class Aggregate:
    function: str
    argument: Column | None


@dataclass(frozen=True)
class SelectItem:
    expression: Column | Aggregate | str
    alias: str | None = None


@dataclass(frozen=True)
class Relation:
    table: str
    alias: str


@dataclass(frozen=True)
class Query:
    items: tuple[SelectItem, ...]
    relations: tuple[Relation, ...]
    joins: tuple[Expr, ...]
    where: Expr | None = None
    group: tuple[Column, ...] = ()
    limit: int | None = None


RESERVED = {
    "select",
    "from",
    "join",
    "inner",
    "on",
    "where",
    "group",
    "by",
    "limit",
    "as",
    "and",
    "or",
    "not",
    "is",
    "null",
    "order",
    "having",
    "union",
    "left",
    "right",
    "outer",
    "distinct",
}
FUNCTIONS = {"count", "sum", "avg", "min", "max"}


class Parser:
    def __init__(self, sql):
        self.tokens = lex(sql)
        if sum(token.kind == "IDENT" and token.value in {"and", "or", "not"} for token in self.tokens) > 64:
            raise QueryError("boolean operator budget exceeded")
        self.index = 0

    def at(self, value):
        token = self.tokens[self.index]
        return token.kind == value or token.value == value

    def take(self, value):
        if self.at(value):
            token = self.tokens[self.index]
            self.index += 1
            return token
        return None

    def need(self, value):
        token = self.take(value)
        if token is None:
            raise QueryError(f"expected {value} at offset {self.tokens[self.index].offset}")
        return token

    def identifier(self):
        token = self.need("IDENT")
        if token.value in RESERVED:
            raise QueryError("reserved keyword cannot be an identifier")
        return token.value

    def column(self):
        first = self.identifier()
        return Column(first, self.identifier()) if self.take(".") else Column(None, first)

    def relation(self):
        table = self.identifier()
        if self.take("as"):
            alias = self.identifier()
        elif self.at("IDENT") and self.tokens[self.index].value not in RESERVED:
            alias = self.identifier()
        else:
            alias = table
        return Relation(table, alias)

    def item(self):
        if self.take("*"):
            return SelectItem("*")
        if self.at("IDENT") and self.tokens[self.index].value in FUNCTIONS and self.tokens[self.index + 1].kind == "(":
            function = self.identifier()
            self.need("(")
            if self.take("*"):
                if function != "count":
                    raise QueryError("only COUNT accepts star")
                argument = None
            else:
                argument = self.column()
            self.need(")")
            expression = Aggregate(function, argument)
        else:
            expression = self.column()
        alias = self.identifier() if self.take("as") else None
        return SelectItem(expression, alias)

    def operand(self):
        if self.take("null"):
            return Literal(None)
        if token := self.take("NUMBER"):
            value = float(token.value) if "." in token.value else int(token.value)
            if (
                isinstance(value, float)
                and not math.isfinite(value)
                or type(value) is int
                and not -(2**63) <= value < 2**63
            ):
                raise QueryError("numeric literal outside finite/int64 contract")
            return Literal(value)
        if token := self.take("STRING"):
            return Literal(token.value)
        return self.column()

    def boolean(self, depth=0):
        value = self.conjunction(depth)
        while self.take("or"):
            value = Expr("or", (value, self.conjunction(depth)))
        return value

    def conjunction(self, depth):
        value = self.predicate(depth)
        while self.take("and"):
            value = Expr("and", (value, self.predicate(depth)))
        return value

    def predicate(self, depth):
        if depth > 32:
            raise QueryError("expression nesting budget exceeded")
        if self.take("not"):
            return Expr("not", (self.predicate(depth + 1),))
        if self.take("("):
            expression = self.boolean(depth + 1)
            self.need(")")
            return expression
        left = self.operand()
        if self.take("is"):
            negate = bool(self.take("not"))
            self.need("null")
            return Expr("is-not-null" if negate else "is-null", (left,))
        token = self.tokens[self.index]
        if token.kind not in {"=", "!=", "<>", "<", "<=", ">", ">="}:
            raise QueryError("predicate requires a supported comparison")
        self.index += 1
        return Expr(token.kind, (left, self.operand()))

    def query(self):
        self.need("select")
        items = [self.item()]
        while self.take(","):
            items.append(self.item())
        if len(items) > 128:
            raise QueryError("projection budget exceeded")
        self.need("from")
        relations = [self.relation()]
        joins = []
        while self.at("join") or self.at("inner"):
            self.take("inner")
            self.need("join")
            relations.append(self.relation())
            self.need("on")
            joins.append(self.boolean())
            if len(relations) > 6:
                raise QueryError("join-order search is limited to six relations")
        where = self.boolean() if self.take("where") else None
        group = []
        if self.take("group"):
            self.need("by")
            group.append(self.column())
            while self.take(","):
                group.append(self.column())
            if len(group) > 16:
                raise QueryError("GROUP BY key budget exceeded")
        limit = None
        if self.take("limit"):
            token = self.need("NUMBER")
            if not token.value.isdigit() or int(token.value) > 100000:
                raise QueryError("LIMIT must be an integer in 0..100000")
            limit = int(token.value)
        self.take(";")
        self.need("EOF")
        return Query(tuple(items), tuple(relations), tuple(joins), where, tuple(group), limit)


def parse(sql: str) -> Query:
    try:
        return Parser(sql).query()
    except QueryError:
        raise
    except (ValueError, RecursionError, OverflowError) as error:
        raise QueryError("query parser resource budget exceeded") from error


def columns(expression):
    if isinstance(expression, Column):
        return {expression}
    if isinstance(expression, Literal):
        return set()
    return set().union(*(columns(argument) for argument in expression.args))


def conjuncts(expression):
    if expression is None:
        return []
    if expression.op == "and":
        return conjuncts(expression.args[0]) + conjuncts(expression.args[1])
    return [expression]
