# SQL Quest — Curriculum

21 modules, beginner → expert. PostgreSQL 18 dialect (differences to other databases are covered in m20).
Each lesson lists its key points; authors must cover them all and must not use syntax from later lessons
(except clearly-labelled previews). File: `content/modules/<id>-<slug>.yaml`.

Dataset ids: `cafe` (tiny café), `shop` (online store), `company` (HR), `movies` (streaming), `bank`,
`app` (fitness app analytics), `school`, `messy` (dirty data), `blank` (empty). See `content/DATASETS.md`.

---

## m00 — Welcome to SQL · `m00-welcome.yaml` · beginner · cafe
1. **m00-l01 What is a database?** — data in tables (rows = records, columns = fields), spreadsheet analogy,
   what SQL is ("asking questions"), relational idea preview, run first query `SELECT * FROM menu_items;`.
2. **m00-l02 Your SQL workspace** — editor, Run (Ctrl/Cmd+Enter), result grid, schema panel, hints, Check,
   "every run starts fresh so you can't break anything", reading result row counts, running a few given queries
   on each café table.
3. **m00-l03 Errors are your friends** — reading an error message, typos in table/column names, missing
   commas, semicolons, keywords case-insensitive vs data case-sensitive, fixing broken queries (fix-the-bug exercises).
4. **m00-l04 How databases think** — tables relate via ids (customer_id in orders), primary key idea, data types
   (text, number, date, boolean) in plain words, NULL = "unknown/missing", SQL keywords overview map of the course.
Project: none. Test pool: 20.

## m01 — SELECT: Picking Your Data · `m01-select.yaml` · beginner · cafe
1. **m01-l01 Choosing columns** — SELECT col1, col2; column order; SELECT * vs listing columns (why listing is better).
2. **m01-l02 Renaming with aliases** — AS, aliases with spaces in "double quotes", when quotes are needed.
3. **m01-l03 Calculations in SELECT** — arithmetic + - * /, price * quantity, operator precedence, parentheses,
   integer division gotcha (5/2 = 2) preview with 5/2.0.
4. **m01-l04 Text in SELECT** — string literals in 'single quotes', concatenation with ||, CONCAT, building labels.
5. **m01-l05 DISTINCT** — unique values, DISTINCT on multiple columns.
6. **m01-l06 LIMIT and peeking at data** — LIMIT n to preview, (ordering comes in m03; note that without ORDER BY
   the rows are in no guaranteed order), comments `--` and `/* */`, formatting readable SQL.
Project: "The Café Menu Board" (5–6 tasks). Test pool: 25.

## m02 — WHERE: Filtering Rows · `m02-where.yaml` · beginner · cafe
1. **m02-l01 Comparing numbers** — WHERE, =, <>, !=, <, >, <=, >=.
2. **m02-l02 Filtering text** — 'single quotes' vs "double quotes" (classic error), case sensitivity, comparing
   text alphabetically.
3. **m02-l03 Booleans and dates** — is_vegan = true / WHERE is_vegan, date literals '2024-11-01', comparing
   dates & timestamps.
4. **m02-l04 AND, OR, NOT** — combining conditions, precedence trap (AND before OR), parentheses.
5. **m02-l05 IN and BETWEEN** — lists of values, NOT IN, inclusive BETWEEN, BETWEEN with dates/timestamps trap.
6. **m02-l06 Pattern matching with LIKE** — %, _, ILIKE, NOT LIKE, escaping.
7. **m02-l07 NULL: the missing value** — IS NULL / IS NOT NULL, why `= NULL` doesn't work, three-valued logic
   (viz null-logic), NULL in NOT IN preview warning.
Project: "Café Detective" (6 tasks). Test pool: 30.

## m03 — Sorting & Paging · `m03-sorting.yaml` · beginner · cafe then shop
1. **m03-l01 ORDER BY** — ASC/DESC, sorting text/numbers/dates.
2. **m03-l02 Sorting by several columns** — tie-breakers, mixed directions.
3. **m03-l03 Sorting tricks** — NULLS FIRST/LAST, ordering by expressions and by aliases, by column position (and why to avoid it).
4. **m03-l04 Top-N and pagination** — ORDER BY + LIMIT, OFFSET for pages, FETCH FIRST n ROWS ONLY, ties (WITH TIES).
5. **m03-l05 Putting it together** — writing order SELECT…FROM…WHERE…ORDER BY…LIMIT vs execution order
   (viz execution-order), first look at the `shop` dataset; mixed practice.
Project: "Store Front Page" on shop (6 tasks). Test pool: 25.

## m04 — Functions: Text, Numbers, Dates, CASE · `m04-functions.yaml` · beginner→intermediate · shop
1. **m04-l01 Text functions** — UPPER, LOWER, INITCAP, LENGTH, TRIM, LEFT/RIGHT, SUBSTRING, REPLACE, POSITION,
   SPLIT_PART, CONCAT_WS, LPAD/RPAD.
2. **m04-l02 Number functions** — ROUND (and ROUND(x::numeric, 2) for float), CEIL, FLOOR, ABS, % / MOD,
   POWER, SQRT, integer division and casting fix, percentages.
3. **m04-l03 Dates & times I** — date vs timestamp, literals, EXTRACT / DATE_PART (year, month, dow), date
   arithmetic (date + 7, date - date), INTERVAL, AGE.
4. **m04-l04 Dates & times II** — DATE_TRUNC, TO_CHAR formatting, month names, first/last day of month,
   CURRENT_DATE/NOW (varies!).
5. **m04-l05 Converting types** — CAST and ::, text↔number↔date, TO_DATE/TO_NUMBER, typical cast errors.
6. **m04-l06 CASE WHEN** — simple and searched CASE, categorizing (price bands), CASE in ORDER BY.
7. **m04-l07 Handling NULLs** — COALESCE, NULLIF (safe division), NULL in arithmetic and concatenation,
   GREATEST/LEAST.
Project: "Customer Data Tidy-up" (6–7 tasks). Test pool: 30.

## m05 — Aggregation: Summarizing Data · `m05-aggregation.yaml` · intermediate · shop
1. **m05-l01 COUNT** — COUNT(*), COUNT(col) ignores NULLs, COUNT(DISTINCT col).
2. **m05-l02 SUM, AVG, MIN, MAX** — over whole tables and filtered rows, AVG with NULLs, rounding averages.
3. **m05-l03 GROUP BY** — one row per group (viz groupby), counting per category/status.
4. **m05-l04 Grouping by several columns & expressions** — GROUP BY year/month with DATE_TRUNC/EXTRACT, CASE buckets.
5. **m05-l05 HAVING** — filtering groups, WHERE vs HAVING (viz execution-order highlight).
6. **m05-l06 Conditional aggregation** — COUNT(*) FILTER (WHERE …), SUM(CASE WHEN …), pivot-style reports.
7. **m05-l07 STRING_AGG, ARRAY_AGG & friends** — STRING_AGG with ORDER BY, ARRAY_AGG, BOOL_AND/BOOL_OR.
8. **m05-l08 GROUP BY mistakes** — "must appear in the GROUP BY clause" error explained, grouping by PK,
   aggregates of aggregates, ordering by aggregates.
Project: "Monthly Sales Report" (7 tasks). Test pool: 30.

## m06 — JOINs: Combining Tables · `m06-joins.yaml` · intermediate · shop (company for self-join)
1. **m06-l01 Why many tables?** — keys (PK/FK), relationships one-to-many, reading the ER diagram, why not one big table.
2. **m06-l02 INNER JOIN** — ON condition, matching rows (viz join), joining orders to customers.
3. **m06-l03 Table aliases** — `o`, `c`, qualifying columns, "column reference is ambiguous" error, USING.
4. **m06-l04 LEFT JOIN** — keeping all rows, NULLs for no match, finding rows with no match (anti-join with IS NULL),
   filter in ON vs WHERE trap.
5. **m06-l05 RIGHT & FULL OUTER JOIN** — when to use, comparing two lists.
6. **m06-l06 Joining 3+ tables** — orders → order_items → products → categories, join path planning.
7. **m06-l07 Self joins** — employees and managers (company), comparing rows within a table.
8. **m06-l08 CROSS JOIN & non-equi joins** — every combination, ranges/bands joins (BETWEEN in ON).
9. **m06-l09 Joins + aggregation** — revenue per customer/category, the fan-out (double counting) trap and fixes,
   COUNT(DISTINCT).
Project: "ShopSmart Customer 360" (8 tasks). Test pool: 30.

## m07 — Subqueries · `m07-subqueries.yaml` · intermediate · shop, company
1. **m07-l01 Scalar subqueries** — above-average filters, subquery in SELECT.
2. **m07-l02 IN subqueries** — lists from another query, NOT IN and the NULL trap.
3. **m07-l03 EXISTS & NOT EXISTS** — semi/anti joins, why NOT EXISTS is NULL-safe.
4. **m07-l04 Correlated subqueries** — per-row subqueries (above their department's average), performance note.
5. **m07-l05 Subqueries in FROM** — derived tables, aggregating an aggregate (average orders per customer).
6. **m07-l06 ANY / ALL** — comparisons with sets.
7. **m07-l07 Subquery or JOIN?** — rewriting between forms, readability, choosing.
Project: "Product Performance Review" (6 tasks). Test pool: 25.

## m08 — Set Operations · `m08-set-operations.yaml` · intermediate · shop, school, cafe
1. **m08-l01 UNION & UNION ALL** — stacking results (viz set-ops), duplicates, column count/type rules.
2. **m08-l02 INTERSECT & EXCEPT** — in both / in one but not the other.
3. **m08-l03 Set operations in practice** — ORDER BY at the end, labelling sources with literals, comparing
   tables to find differences, combining reports.
Project: none. Test pool: 20.

## m09 — CTEs: Readable & Recursive Queries · `m09-ctes.yaml` · intermediate→advanced · shop, company
1. **m09-l01 WITH basics** — naming a subquery, readability, step-by-step thinking.
2. **m09-l02 Chaining CTEs** — multiple CTEs, building a pipeline, CTE referencing CTE.
3. **m09-l03 Refactoring with CTEs** — turning nested subqueries into CTEs, MATERIALIZED / NOT MATERIALIZED note.
4. **m09-l04 Recursive CTEs: counting** — WITH RECURSIVE, anchor + recursive part, number and date series, stop conditions
   (stepper of iterations), infinite-loop danger.
5. **m09-l05 Recursive hierarchies** — org chart (company.employees), depth, path strings, category tree (shop.categories),
   all reports under a manager.
6. **m09-l06 Graphs & cycles** — path arrays, cycle detection (CYCLE clause / NOT = ANY(path)), shortest paths on a
   small edges table created in the example.
Project: "Org Chart Explorer" (6 tasks, company). Test pool: 25.

## m10 — Window Functions I · `m10-window-functions.yaml` · advanced · company, shop
1. **m10-l01 OVER(): aggregates that keep rows** — SUM() OVER (), share of total, compare to GROUP BY (viz window).
2. **m10-l02 PARTITION BY** — per-group aggregates alongside rows (department average next to each salary).
3. **m10-l03 ROW_NUMBER, RANK, DENSE_RANK** — differences with ties.
4. **m10-l04 Top-N per group** — ranking inside a CTE/subquery then filtering, dedup with ROW_NUMBER.
5. **m10-l05 Running totals** — ORDER BY inside OVER, cumulative sums/counts, running totals per partition.
6. **m10-l06 LAG & LEAD** — previous/next row, change vs previous month, salary raises (salary_history), default values.
Project: "Salary & Sales Insights" (7 tasks). Test pool: 30.

## m11 — Window Functions II · `m11-window-functions-advanced.yaml` · advanced · bank, app, movies
1. **m11-l01 Window frames with ROWS** — ROWS BETWEEN n PRECEDING AND CURRENT ROW, moving averages, centered windows.
2. **m11-l02 RANGE & GROUPS frames** — default frame gotcha, RANGE with intervals (last 7 days), GROUPS, EXCLUDE.
3. **m11-l03 FIRST_VALUE, LAST_VALUE, NTH_VALUE** — the LAST_VALUE frame trap and fix.
4. **m11-l04 Distribution functions** — NTILE, PERCENT_RANK, CUME_DIST, PERCENTILE_CONT / PERCENTILE_DISC (WITHIN GROUP), median.
5. **m11-l05 Named windows & filtering** — WINDOW clause, multiple windows, filtering on window results via CTE (no QUALIFY in Postgres).
6. **m11-l06 Window functions in practice** — running balance per account, rank changes, percent of category total, mixing aggregates and windows (SUM(SUM(x)) OVER).
Project: "Streaming Trends" (movies, 7 tasks). Test pool: 25.

## m12 — Changing Data: INSERT, UPDATE, DELETE · `m12-modifying-data.yaml` · intermediate · shop, blank
1. **m12-l01 INSERT** — single and multi-row, column lists, defaults.
2. **m12-l02 INSERT … SELECT** — copying/archiving rows, CREATE TABLE AS.
3. **m12-l03 UPDATE** — SET, WHERE (the danger of forgetting it!), updating with expressions, UPDATE … FROM.
4. **m12-l04 DELETE & TRUNCATE** — DELETE WHERE, DELETE … USING, TRUNCATE, safety habits (SELECT first).
5. **m12-l05 RETURNING** — see what changed.
6. **m12-l06 UPSERT** — INSERT … ON CONFLICT DO NOTHING / DO UPDATE, EXCLUDED.
7. **m12-l07 MERGE** — synchronizing a staging table into a target (WHEN MATCHED / NOT MATCHED / NOT MATCHED BY SOURCE).
Project: "Inventory Day" (6 tasks, DML with check queries). Test pool: 25.

## m13 — Designing Databases: DDL & Modeling · `m13-ddl-design.yaml` · intermediate→advanced · blank
1. **m13-l01 CREATE TABLE & data types** — integer/bigint/numeric/text/varchar/boolean/date/timestamp/timestamptz/jsonb,
   choosing types, DROP TABLE.
2. **m13-l02 Constraints** — PRIMARY KEY, NOT NULL, UNIQUE, DEFAULT, CHECK; seeing violations (expectError examples).
3. **m13-l03 Foreign keys** — REFERENCES, ON DELETE CASCADE / SET NULL / RESTRICT, violations.
4. **m13-l04 ALTER TABLE** — add/drop/rename columns, change types (USING), add/drop constraints.
5. **m13-l05 Identity, sequences & generated columns** — GENERATED ALWAYS AS IDENTITY, SERIAL, sequences, GENERATED ALWAYS AS (expr) STORED, UUIDs (gen_random_uuid).
6. **m13-l06 Normalization** — 1NF, 2NF, 3NF with a bad spreadsheet-like table, fixing it by splitting tables; when to denormalize.
7. **m13-l07 Modeling relationships** — one-to-one, one-to-many, many-to-many junction tables, design a schema
   from requirements (library / school).
8. **m13-l08 Schemas, temp tables & comments** — CREATE SCHEMA, search_path, TEMP tables, COMMENT ON, naming conventions.
Project: "Build a Library Database" (8 tasks). Test pool: 25.

## m14 — Transactions & Concurrency · `m14-transactions.yaml` · advanced · bank
1. **m14-l01 BEGIN, COMMIT, ROLLBACK** — all-or-nothing money transfer (viz transaction commit-rollback).
2. **m14-l02 SAVEPOINT** — partial rollback, error handling in a transaction (failed transaction state).
3. **m14-l03 ACID in practice** — atomicity, consistency (constraints), isolation, durability explained with bank examples.
4. **m14-l04 Isolation levels & anomalies** — READ COMMITTED vs REPEATABLE READ vs SERIALIZABLE, dirty/non-repeatable/phantom
   reads, lost updates (viz transaction scenarios), SET TRANSACTION.
5. **m14-l05 Locks** — row locks, SELECT … FOR UPDATE / SKIP LOCKED (job queues), deadlocks (viz deadlock), advisory locks overview.
6. **m14-l06 Integrity patterns** — deferrable constraints, CHECK constraints for business rules, idempotent operations.
Note: the browser has one database session, so concurrency is taught with the `transaction` visualizer; single-session
syntax (BEGIN/SAVEPOINT/ROLLBACK, FOR UPDATE, SET TRANSACTION ISOLATION LEVEL) is practised for real.
Project: "Harbor Bank Transfers" (6 tasks). Test pool: 25.

## m15 — Views, Indexes & Performance · `m15-performance.yaml` · advanced · shop, app
1. **m15-l01 Views** — CREATE VIEW, using views, updatable views, CREATE OR REPLACE, DROP VIEW.
2. **m15-l02 Materialized views** — caching results, REFRESH MATERIALIZED VIEW, when to use.
3. **m15-l03 How indexes work** — phone-book analogy, B-tree (viz index), CREATE INDEX, unique indexes, cost of indexes.
4. **m15-l04 Reading EXPLAIN** — EXPLAIN, EXPLAIN ANALYZE, Seq Scan vs Index Scan vs Bitmap, costs/rows/time, finding the slow part.
5. **m15-l05 Smarter indexes** — composite (column order matters), partial, expression indexes, covering (INCLUDE), GIN for jsonb/arrays.
6. **m15-l06 Writing fast queries** — sargable predicates (no functions on indexed columns), avoid SELECT *, EXISTS vs IN,
   OR vs UNION, LIMIT early, pagination by keyset vs OFFSET.
7. **m15-l07 Joins under the hood** — nested loop, hash join, merge join; statistics and ANALYZE; VACUUM overview.
Exercises here can check plan-independent results; for "use the index" tasks use `check:` queries on `pg_indexes`.
Project: "Speed Up the Dashboard" (6 tasks). Test pool: 25.

## m16 — Advanced PostgreSQL Features · `m16-advanced-postgres.yaml` · advanced · app, movies, shop
1. **m16-l01 JSON basics** — json vs jsonb, ->, ->>, #>, #>>, casting extracted values, jsonb_build_object, to_jsonb.
2. **m16-l02 Querying JSONB** — @>, ?, jsonb_array_elements, jsonb_each, jsonb_agg, jsonb_object_agg, jsonb_set, JSON_TABLE overview, GIN index.
3. **m16-l03 Arrays** — ARRAY[...], ARRAY_AGG, ANY(array), unnest (WITH ORDINALITY), array_length, cardinality, @>, string_to_array.
4. **m16-l04 generate_series** — number/date series, date spines to fill gaps in reports (LEFT JOIN to a series).
5. **m16-l05 LATERAL joins** — per-row subqueries (top 3 per category via LATERAL), unnest with LATERAL.
6. **m16-l06 GROUPING SETS, ROLLUP, CUBE** — subtotals and grand totals, GROUPING() function.
7. **m16-l07 DISTINCT ON** — first row per group (Postgres-specific), vs ROW_NUMBER.
8. **m16-l08 Regular expressions** — ~, ~*, regexp_replace, regexp_matches / regexp_substr, SIMILAR TO note.
9. **m16-l09 Full-text search** — to_tsvector, to_tsquery/plainto_tsquery/websearch_to_tsquery, @@, ts_rank, highlighting.
Project: "App Event Explorer" (app, 7 tasks). Test pool: 30.

## m17 — Programming the Database · `m17-programming.yaml` · expert · shop, bank, blank
1. **m17-l01 SQL functions** — CREATE FUNCTION … LANGUAGE sql, parameters, IMMUTABLE/STABLE/VOLATILE, using in queries.
2. **m17-l02 PL/pgSQL basics** — DO blocks, DECLARE, variables, IF/ELSIF, loops (FOR … IN query), RAISE NOTICE.
3. **m17-l03 Set-returning functions** — RETURNS TABLE, RETURNS SETOF, RETURN QUERY, calling in FROM.
4. **m17-l04 Procedures** — CREATE PROCEDURE, CALL, transaction control inside procedures, functions vs procedures.
5. **m17-l05 Triggers** — BEFORE/AFTER, row vs statement, NEW/OLD, updated_at trigger, audit log table, preventing invalid changes.
6. **m17-l06 Error handling** — RAISE EXCEPTION, EXCEPTION WHEN … blocks, GET STACKED DIAGNOSTICS, custom error messages.
7. **m17-l07 Security** — roles, GRANT/REVOKE, SET ROLE to test, row-level security policies, SQL injection & parameterized queries
   (explained with a safe illustration), least privilege.
Project: "Automate the Bank" (bank, 6 tasks). Test pool: 25.

## m18 — Data Cleaning & Wrangling · `m18-data-cleaning.yaml` · advanced · messy
1. **m18-l01 Finding duplicates** — GROUP BY HAVING COUNT > 1, ROW_NUMBER dedupe, keeping the latest, DELETE duplicates.
2. **m18-l02 Standardizing text** — TRIM, LOWER/INITCAP, REPLACE, regexp_replace for phones, mapping variants with CASE / lookup tables.
3. **m18-l03 Parsing messy dates & numbers** — to_date with formats, CASE + regex guards for safe casting, cleaning '$1,234.50'.
4. **m18-l04 Missing values & outliers** — NULL vs '', NULLIF, COALESCE defaults, detecting outliers (z-score, IQR with percentiles).
5. **m18-l05 Pivot & unpivot** — pivot with FILTER/CASE, crosstab (tablefunc), unpivot with VALUES + LATERAL / unnest.
6. **m18-l06 Data quality checks** — writing assertion queries (uniqueness, completeness, validity, referential checks), building a clean table with CREATE TABLE AS.
Project: "Clean the CRM Export" (7 tasks). Test pool: 25.

## m19 — Analytics Patterns (The Pro Toolbox) · `m19-analytics.yaml` · expert · app, bank, shop, movies
1. **m19-l01 Growth metrics** — MoM / YoY growth with LAG, cumulative revenue, contribution %.
2. **m19-l02 Gaps & islands** — consecutive-day streaks (daily_steps), finding missing ranges.
3. **m19-l03 Sessionization** — splitting events into sessions with a 30-minute gap rule, session length/count.
4. **m19-l04 Funnels** — step conversion rates, ordered funnels per user, drop-off.
5. **m19-l05 Cohort retention** — signup cohorts, week-N retention matrix, retention curve.
6. **m19-l06 Moving metrics & Pareto** — 7-day moving average, rolling active users, 80/20 analysis with cumulative share.
7. **m19-l07 Percentiles & histograms** — median/p90, width_bucket histograms, binning.
8. **m19-l08 Market basket** — products bought together (self-join on order_items), support/lift basics.
9. **m19-l09 Relational division & "for all" questions** — customers who bought every product in a category, double NOT EXISTS.
10. **m19-l10 Anomaly & fraud detection** — bursts of transactions within N minutes (bank), values far from the account average.
Project: "FitTrack Growth Review" (app, 8 tasks). Test pool: 30.

## m20 — SQL in the Real World · `m20-real-world.yaml` · expert · shop, blank
1. **m20-l01 SQL dialects** — PostgreSQL vs MySQL vs SQL Server vs SQLite vs Oracle vs BigQuery/Snowflake: LIMIT/TOP/FETCH,
   string concat, ILIKE, date functions, identity/auto_increment, booleans, QUALIFY; translation table + quizzes.
2. **m20-l02 Writing production SQL** — style guide, naming, formatting, comments, CTE organization, avoiding SELECT *, deterministic ordering.
3. **m20-l03 Debugging a query** — strategies: run pieces, check row counts at each join, isolate NULLs, verify grain.
4. **m20-l04 Data warehousing** — fact vs dimension tables, star schema built from shop (CREATE TABLE AS), surrogate keys, slowly changing dimensions (type 1/2).
5. **m20-l05 Testing your queries** — edge cases checklist (NULLs, ties, empty groups, duplicates), reconciling totals.
6. **m20-l06 SQL interview playbook** — how to approach a problem (clarify grain, sketch output, build incrementally), classic interview questions practised.
7. **m20-l07 SQL beyond the database** — using SQL from Python (psycopg / pandas read_sql) and BI tools, dbt idea, next steps.
Project: "Final Capstone: Build a Star Schema & Executive Report" (8 tasks). Test pool: 25.
