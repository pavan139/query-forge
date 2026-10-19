# SQL Quest — Content Authoring Guide

SQL Quest teaches **one learner** with **no coding experience** (she finds coding hard) all the way to
**advanced SQL developer**. Everything runs in her browser on real **PostgreSQL 18** (PGlite).
The course is **practical first**: every idea is shown with a runnable example and immediately practised.

Content lives in YAML:

| What | Where |
|---|---|
| A module (lessons + test pool + optional project) | `content/modules/mNN-slug.yaml` |
| Practice challenges | `content/challenges/<name>.yaml` |
| Glossary terms (one file per module) | `content/glossary/mNN.yaml` |
| Datasets (read-only for authors) | `public/datasets/<id>.sql`, documented in `content/DATASETS.md` |

Type definitions: `src/content/types.ts`. Schema: `scripts/content-schema.mjs`.

## Validate as you go (mandatory)

```bash
node scripts/build-content.mjs --check                          # schema + id checks for all content
node scripts/validate-content.mjs content/modules/m05-aggregation.yaml            # runs every SQL
node scripts/validate-content.mjs content/modules/m05-aggregation.yaml --verbose  # also prints results
```

`validate-content` runs each example, each exercise solution (and checks it against itself, checks that the
starter code does NOT already pass), each predict/quiz query, each fill-in (with every accepted answer), each
parsons puzzle (lines joined in order) and each stepper stage — on a fresh copy of the dataset, exactly
like the app. **Zero errors is required. Fix warnings unless you have a reason.** Use `--verbose` to
confirm that the right option of every `predict` question is truly correct — never guess a row count or value.

## How the app behaves (write content that fits this)

- **Every Run starts from the original dataset** (examples, exercises, predicts, steppers). So each example
  must be self-contained: if it needs a table, create it in the same example. Nothing carries over between steps.
- **Exercise checking** compares the *result* of the learner's SQL with the result of `solution`, so any
  correct query passes (no text matching). Rules:
  - Row order is ignored unless `ordered: true`. Use `ordered: true` only when the prompt explicitly asks for
    an order — and then make the order total (add a tie-breaker, e.g. "then by name") so it is unambiguous.
  - Column names are ignored unless `columnNames: true` (use it when the lesson is about aliases or the prompt
    demands specific names). Columns are matched by name if names match, otherwise by position — so **the prompt
    must state the columns and their order**, e.g. "Show each product's `name` and `price`".
  - Numbers match when equal to 2 decimal places, so `ROUND` isn't enforced — but still tell her how to round.
  - A midnight timestamp equals a date.
  - The last statement that returns rows is the answer. For INSERT/UPDATE/DELETE/DDL tasks set `check:` to a
    query that inspects the resulting state (e.g. `SELECT * FROM products ORDER BY product_id`); the check
    runs after both the solution and the learner's SQL. For DDL you can query `information_schema.columns`,
    or make `check:` multi-statement (e.g. insert a test row then select) — the last result is compared.
  - `setup:` is hidden SQL run before both (e.g. create a table she then alters).
- **Never depend on today's date** (`CURRENT_DATE`, `NOW()`) in graded answers: use fixed dates from the data.
  Examples may demonstrate `CURRENT_DATE` but say the result will differ.
- **Avoid ties with LIMIT** in graded tasks: "top 3 most expensive" must not have a tie at position 3 (check
  with `--verbose`), or ask for a tie-breaker.
- Keep results readable: usually ≤ 50 rows for exercises (≤ 1000 hard limit).
- Never use `random()`, `now()`, `clock_timestamp()` in solutions.
- Available extensions (must `CREATE EXTENSION IF NOT EXISTS ...` in the same SQL): `tablefunc` (crosstab), `pg_trgm`.

## Pedagogy rules (the most important part)

1. **She is a beginner who finds coding hard.** Short paragraphs (2–4 sentences). Plain English first, then
   syntax. Define every term the first time (and add it to the glossary if it is a key term). Friendly,
   encouraging, never condescending. Use "you".
2. **One new idea at a time.** Each lesson introduces 1–3 related ideas. Build on earlier lessons only.
   Do not use syntax she hasn't learned yet (check the curriculum order) — except in clearly-marked previews.
3. **Practical first.** Pattern for every idea: tiny explanation → runnable `example` (with `after:` explaining
   the result) → `exercise` that is almost the same → harder `exercise` that combines with earlier ideas.
   Start each lesson with a real-world scenario ("Your manager asks…").
4. **Lots of examples.** Every lesson: **3–6 examples, 4–8 exercises, 2–4 other graded steps** (quiz, predict,
   fill, parsons). Later/advanced lessons can be longer. Aim for ~15–25 steps per lesson.
5. **Analogies and visuals.** Use `> [!ANALOGY]` callouts (spreadsheets, filing cabinets, recipe cards...).
   Use `viz` steps where they help (see below). Use `stepper` to build complex queries clause by clause.
6. **Common mistakes.** Every lesson has at least one `> [!MISTAKE]` callout and ideally an `example` with
   `expectError: true` that shows the error and how to fix it, or a "fix the bug" exercise (put the broken
   query in `starter:`).
7. **Hints are progressive** (2–4 hints): 1) nudge about the idea, 2) which clause/function to use,
   3) a near-complete skeleton with blanks like `SELECT ___ FROM customers WHERE ___;`.
8. **Explanations after success** (`explanation:`) say *why* it works and mention an alternative or pitfall.
9. Exercises ramp in difficulty (`difficulty: 1|2|3`). Last 1–2 exercises in a lesson should be a stretch.
10. Real-world flavour: `> [!REAL-WORLD]` callouts about how analysts/developers use this at work.
11. SQL style in all solutions/examples: UPPERCASE keywords, lowercase identifiers, one clause per line,
    4-space indents for continuation, trailing semicolons. Example:
    ```sql
    SELECT name, price
    FROM menu_items
    WHERE price > 5
    ORDER BY price DESC;
    ```

## Markdown

Standard Markdown (bold, lists, tables, `inline code`, fenced ```sql blocks) plus callouts:

```
> [!TIP]
> Keywords aren't case-sensitive, but writing them in CAPITALS makes queries easier to read.
```
Callout kinds: `TIP`, `NOTE`, `WARNING`, `MISTAKE`, `ANALOGY`, `REAL-WORLD`.

## Step types (YAML)

Use YAML block scalars (`|`) for any multi-line text or SQL. Quote strings that contain `: ` or start with
special characters. IDs: lowercase, digits, dashes, **globally unique**. Convention:
`<lesson-id>-e1` (exercise), `-q1` (quiz), `-p1` (predict), `-f1` (fill), `-o1` (parsons/order);
test pool items `<module-id>-t01`…; project tasks `<module-id>-proj-1`…

```yaml
- type: read
  title: What is a table?            # optional
  md: |
    A **table** is like a spreadsheet...

- type: example
  title: Your first query
  md: Press **Run** to see every item on the menu.
  sql: |
    SELECT *
    FROM menu_items;
  after: |
    Each row is one menu item; each column is one piece of information about it.
  # dataset: shop         # optional override (default: lesson → module dataset)
  # expectError: true     # when the example deliberately shows an error

- type: exercise
  id: m01-l01-e1
  title: Just the names          # optional
  prompt: |
    Show the `name` and `price` of every menu item.
  starter: |
    SELECT
    FROM menu_items;
  solution: |
    SELECT name, price
    FROM menu_items;
  hints:
    - You need to list two columns after SELECT.
    - Separate column names with a comma.
    - "SELECT name, ___ FROM menu_items;"
  explanation: |
    The columns appear in the order you list them.
  difficulty: 1
  # ordered: true  columnNames: true  setup: ...  check: ...  allowEmpty: true

- type: quiz
  id: m01-l01-q1
  question: Which keyword chooses the **columns** you want to see?
  options: [FROM, SELECT, WHERE, TABLE]
  answer: 1                      # index; use a list [0, 2] for multi-select
  explanation: SELECT lists columns; FROM says which table.
  # sql: optional query shown with the question

- type: predict
  id: m01-l01-p1
  question: How many rows will this return?
  sql: |
    SELECT DISTINCT category
    FROM menu_items;
  options: ["32", "6", "1", "An error"]
  answer: 1
  explanation: DISTINCT removes duplicates, leaving one row per category.
  # expectError: true when the correct option is the error

- type: fill
  id: m01-l01-f1
  prompt: Complete the query to show all columns from `customers`.
  template: |
    SELECT ___
    FROM ___;
  answers:                        # one list of accepted answers per ___ (case-insensitive, whitespace-insensitive)
    - ["*"]
    - ["customers"]
  explanation: "`*` means every column."

- type: parsons
  id: m01-l01-o1
  prompt: Put the lines in the right order to list vegan items, cheapest first.
  lines:                          # in the CORRECT order; the app shuffles them
    - SELECT name, price
    - FROM menu_items
    - WHERE is_vegan = true
    - ORDER BY price;
  distractors:                    # optional wrong lines that must be left out
    - HAVING is_vegan = true

- type: viz
  viz: join                       # see "Visualizers" below
  title: See how INNER JOIN matches rows
  md: Click each join type and watch which rows survive.
  config: { ... }

- type: stepper
  title: Building the report step by step
  md: Each stage adds one clause. Click through and run each one.
  stages:
    - label: FROM
      md: Start with all orders.
      sql: |
        SELECT * FROM orders;
    - label: WHERE
      md: Keep only delivered orders.
      sql: |
        SELECT * FROM orders WHERE status = 'delivered';
```

## Visualizers (`viz` steps)

All configs are optional — omit `config` to use the built-in demo data. Tables in configs are tiny (3–8 rows).

- `join` — two tables, join-type buttons, Venn diagram, row-matching lines, live result.
  ```yaml
  config:
    left:  { name: customers, columns: [id, name], rows: [[1, Ana], [2, Ben], [3, Chen]] }
    right: { name: orders, columns: [order_id, customer_id, total], rows: [[10, 1, 25], [11, 1, 8], [12, 4, 40]] }
    on: [id, customer_id]           # left column, right column
    types: [inner, left, right, full, cross]   # optional subset; first one is selected initially
  ```
- `groupby` — rows get coloured by group then collapse into one row per group with the aggregate.
  ```yaml
  config:
    table: { name: orders, columns: [customer, amount], rows: [[Ana, 10], [Ben, 5], [Ana, 7]] }
    groupBy: customer
    aggregates: [count, sum, avg, min, max]    # which buttons to show
    column: amount                              # column aggregated
  ```
- `window` — partitions coloured, click a row to see its window frame; switch functions.
  ```yaml
  config:
    table: { name: sales, columns: [region, month, amount], rows: [[East, 1, 100], [East, 2, 80], [West, 1, 50]] }
    partitionBy: region       # optional
    orderBy: month
    value: amount
    functions: [row_number, rank, dense_rank, running_sum, moving_avg_3, lag, lead]
  ```
- `execution-order` — interactive diagram of the logical order FROM → JOIN → WHERE → GROUP BY → HAVING →
  SELECT → DISTINCT → ORDER BY → LIMIT. Optional `config: { highlight: [WHERE, HAVING] }`.
- `null-logic` — interactive three-valued logic (TRUE/FALSE/NULL) truth tables. No config.
- `set-ops` — two lists, Venn diagram, UNION / UNION ALL / INTERSECT / EXCEPT results.
  ```yaml
  config: { a: { name: cafe_customers, values: [Ana, Ben, Chen, Ana] }, b: { name: shop_customers, values: [Ben, Dee] } }
  ```
- `index` — animated full-table scan vs B-tree index lookup with comparison counts.
  `config: { rows: 1000 }` optional.
- `transaction` — two-session timeline you step through. `config: { scenario: <name> }` where name is one of
  `commit-rollback`, `dirty-read`, `non-repeatable-read`, `phantom-read`, `lost-update`, `deadlock`,
  `select-for-update`.

## Lesson & module skeleton

```yaml
id: m01
order: 1
title: SELECT — Picking Your Data
subtitle: Ask the database for exactly the columns you need
icon: "🔎"
level: beginner                 # beginner | intermediate | advanced | expert
description: |
  Learn to read data from a table...
dataset: cafe                   # default dataset for every lesson
lessons:
  - id: m01-l01
    title: Your first SELECT
    summary: Read every row and column from a table.
    minutes: 12
    # dataset: shop             # optional override
    steps: [ ... ]
    cheatsheet:                 # 2–4 key snippets that go into the Reference page
      - title: All columns
        sql: SELECT * FROM table_name;
        note: "* means every column"
testPool:                       # 20–30 NEW questions (never reuse lesson steps) for weekly/monthly tests
  - type: exercise
    id: m01-t01
    lesson: m01-l01             # which lesson it tests
    difficulty: 1               # 1 easy, 2 medium, 3 hard
    prompt: ...
    solution: ...
    hints: [...]
  - type: quiz
    id: m01-t02
    lesson: m01-l02
    difficulty: 2
    ...
project:                        # optional: realistic multi-task case study at the end of the module
  id: m01-proj
  title: The Café Menu Audit
  icon: "☕"
  dataset: cafe
  md: |
    Scenario text...
  tasks:                        # 5–8 exercise steps (type: exercise) building on each other
    - type: exercise
      id: m01-proj-1
      ...
```

Test pool mix: ~40% exercises (write a query), ~25% quiz, ~15% predict, ~10% fill, ~10% parsons; cover every
lesson; difficulties spread 1/2/3. Test items should be *new* problems, not copies of lesson steps.

## Challenges file

```yaml
challenges:
  - id: ch-shop-001
    title: Big spenders
    difficulty: easy            # easy | medium | hard | expert
    dataset: shop
    module: m05                 # module after which she has the skills to solve it
    tags: [aggregation, group-by, having]
    prompt: |
      ...
    solution: |
      ...
    hints: [..., ..., ...]
    explanation: |
      ...
    # ordered, columnNames, setup, check, starter, allowEmpty as for exercises
```

## Glossary file (`content/glossary/mNN.yaml`)

Add the 5–15 key terms your module introduces (plain-English definitions, one short example). Duplicated terms
across modules are merged (first one wins), so focus on your module's own terms.

```yaml
glossary:
  - term: Primary key
    definition: A column (or set of columns) whose value uniquely identifies each row.
    example: "customer_id INTEGER PRIMARY KEY"
    module: m06
```
