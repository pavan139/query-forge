// SQL execution engine shared by the browser worker and the Node validator.
// It owns one PGlite instance, loads datasets, resets state and checks exercises.

import { compareResults, type ColumnInfo, type CompareOutcome, type ResultSet } from './compare.ts';
import { isMutating, splitSql, type SqlStatement } from './split.ts';
import { PARSERS } from './values.ts';

export interface StatementResult extends ResultSet {
  /** e.g. SELECT, INSERT, CREATE */
  command: string;
  rowCount: number;
  affectedRows: number;
  truncated: boolean;
  /** Index of the statement within the script. */
  index: number;
  sql: string;
}

export interface SqlError {
  message: string;
  code?: string;
  detail?: string;
  hint?: string;
  /** 1-based character position in the full script (already offset-corrected). */
  position?: number;
  where?: string;
  statementIndex?: number;
  statementSql?: string;
  /** Statements that ran successfully before the failing one. */
  completed?: number;
}

export interface RunOutput {
  ok: boolean;
  results: StatementResult[];
  error?: SqlError;
  notices: string[];
  ms: number;
  mutated: boolean;
}

export interface CheckSpec {
  dataset: string;
  solution: string;
  learner: string;
  setup?: string;
  check?: string;
  ordered?: boolean;
  columnNames?: boolean;
  cacheKey?: string;
}

export interface CheckOutput {
  pass: boolean;
  outcome?: CompareOutcome;
  expected?: StatementResult | null;
  actual?: StatementResult | null;
  /** All learner statement results (for display). */
  run?: RunOutput;
  error?: SqlError;
  /** Set when the solution itself fails (content bug). */
  solutionError?: SqlError;
}

/** Minimal surface of PGlite we rely on, so Node and browser can share this file. */
export interface PgLike {
  exec(
    sql: string,
    opts?: { rowMode?: 'array' | 'object'; parsers?: Record<number, (v: string) => unknown>; onNotice?: (n: { message?: string; severity?: string }) => void },
  ): Promise<Array<{ rows: unknown[]; fields: { name: string; dataTypeID: number }[]; affectedRows?: number }>>;
}

const DISPLAY_ROW_LIMIT = 1000;

const RESET_SQL = `
DO $reset$
DECLARE r record;
BEGIN
  FOR r IN SELECT nspname FROM pg_namespace
           WHERE nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
             AND nspname NOT LIKE 'pg_temp%' AND nspname NOT LIKE 'pg_toast_temp%'
  LOOP
    EXECUTE format('DROP SCHEMA %I CASCADE', r.nspname);
  END LOOP;
  FOR r IN SELECT rolname FROM pg_roles
           WHERE rolname NOT LIKE 'pg\\_%' AND rolname <> current_user AND NOT rolsuper
  LOOP
    EXECUTE format('DROP OWNED BY %I CASCADE', r.rolname);
    EXECUTE format('DROP ROLE %I', r.rolname);
  END LOOP;
END
$reset$;
CREATE SCHEMA public;
`;

export class Engine {
  current: string | null = null;
  /** True when the database may differ from the pristine dataset. */
  dirty = true;
  private expectedCache = new Map<string, { expected: StatementResult | null; error?: SqlError }>();

  private db: PgLike;
  private loadDatasetSql: (id: string) => Promise<string>;

  constructor(db: PgLike, loadDatasetSql: (id: string) => Promise<string>) {
    this.db = db;
    this.loadDatasetSql = loadDatasetSql;
  }

  private async quiet(sql: string) {
    try {
      await this.db.exec(sql);
    } catch {
      /* ignore */
    }
  }

  /** Drop everything and reload the dataset. */
  async reset(dataset: string): Promise<void> {
    await this.quiet('ROLLBACK');
    await this.quiet('RESET ROLE');
    await this.quiet('DISCARD ALL');
    await this.db.exec(RESET_SQL);
    await this.db.exec("SET TIME ZONE 'UTC'; SET search_path TO public;");
    const seed = await this.loadDatasetSql(dataset);
    if (seed.trim()) await this.db.exec(seed);
    this.current = dataset;
    this.dirty = false;
  }

  /** Make sure the dataset is loaded; reload when dirty or when `fresh` is requested. */
  async use(dataset: string, fresh = false): Promise<void> {
    if (fresh || this.dirty || this.current !== dataset) await this.reset(dataset);
  }

  async run(script: string, limit = DISPLAY_ROW_LIMIT): Promise<RunOutput> {
    const t0 = now();
    const statements = splitSql(script);
    const results: StatementResult[] = [];
    const notices: string[] = [];
    let mutated = false;
    for (let i = 0; i < statements.length; i++) {
      const st = statements[i];
      if (isMutating(st)) {
        mutated = true;
        this.dirty = true;
      }
      try {
        const res = await this.db.exec(st.sql, {
          rowMode: 'array',
          parsers: PARSERS,
          onNotice: (n) => notices.push(`${n.severity ?? 'NOTICE'}: ${n.message ?? ''}`),
        });
        const last = res[res.length - 1] ?? { rows: [], fields: [], affectedRows: 0 };
        results.push(toResult(last, st, i, limit));
      } catch (e) {
        return {
          ok: false,
          results,
          error: toSqlError(e, st, i),
          notices,
          ms: now() - t0,
          mutated,
        };
      }
    }
    return { ok: true, results, notices, ms: now() - t0, mutated };
  }

  /** Last statement result that returned columns (the "answer" of a script). */
  static answerOf(run: RunOutput): StatementResult | null {
    for (let i = run.results.length - 1; i >= 0; i--) if (run.results[i].columns.length > 0) return run.results[i];
    return null;
  }

  async expected(spec: CheckSpec): Promise<{ expected: StatementResult | null; error?: SqlError }> {
    const key = spec.cacheKey ?? `${spec.dataset}\u0000${spec.setup ?? ''}\u0000${spec.solution}\u0000${spec.check ?? ''}`;
    const cached = this.expectedCache.get(key);
    if (cached) return cached;
    await this.use(spec.dataset, true);
    if (spec.setup) await this.db.exec(spec.setup);
    const sol = await this.run(spec.solution, Number.MAX_SAFE_INTEGER);
    let out: { expected: StatementResult | null; error?: SqlError };
    if (!sol.ok) out = { expected: null, error: sol.error };
    else if (spec.check) {
      const chk = await this.run(spec.check, Number.MAX_SAFE_INTEGER);
      out = chk.ok ? { expected: Engine.answerOf(chk) } : { expected: null, error: chk.error };
    } else out = { expected: Engine.answerOf(sol) };
    this.dirty = true;
    this.expectedCache.set(key, out);
    return out;
  }

  async check(spec: CheckSpec): Promise<CheckOutput> {
    const exp = await this.expected(spec);
    if (exp.error || !exp.expected) {
      return { pass: false, solutionError: exp.error ?? { message: 'Solution returned no result set' } };
    }
    const learnerStatements = splitSql(spec.learner);
    const needsFresh = !!spec.setup || !!spec.check || learnerStatements.some(isMutating);
    await this.use(spec.dataset, needsFresh);
    if (spec.setup) {
      await this.db.exec(spec.setup);
      this.dirty = true;
    }
    const run = await this.run(spec.learner, Number.MAX_SAFE_INTEGER);
    if (!run.ok) return { pass: false, run: trimRun(run), error: run.error, expected: trimResult(exp.expected) };
    let actual: StatementResult | null;
    if (spec.check) {
      const chk = await this.run(spec.check, Number.MAX_SAFE_INTEGER);
      if (!chk.ok) return { pass: false, run: trimRun(run), error: chk.error, expected: trimResult(exp.expected) };
      actual = Engine.answerOf(chk);
    } else actual = Engine.answerOf(run);
    const outcome = compareResults(exp.expected, actual, { ordered: spec.ordered, columnNames: spec.columnNames });
    return {
      pass: outcome.ok,
      outcome,
      expected: trimResult(exp.expected),
      actual: actual ? trimResult(actual) : null,
      run: trimRun(run),
    };
  }

  /** Tables, columns, keys of the current database for the schema explorer and autocomplete. */
  async schema(): Promise<SchemaInfo> {
    const res = await this.db.exec(SCHEMA_SQL, { rowMode: 'object', parsers: PARSERS });
    const rows = res[res.length - 1].rows as {
      table_name: string;
      table_type: string;
      column_name: string | null;
      data_type: string | null;
      is_nullable: string | null;
      is_pk: boolean;
      fk: string | null;
      ord: number | null;
      est_rows: number | null;
    }[];
    const tables = new Map<string, SchemaTable>();
    for (const r of rows) {
      let t = tables.get(r.table_name);
      if (!t) {
        t = { name: r.table_name, kind: r.table_type === 'VIEW' ? 'view' : r.table_type === 'MATVIEW' ? 'matview' : 'table', columns: [], rows: r.est_rows ?? null };
        tables.set(r.table_name, t);
      }
      if (r.column_name)
        t.columns.push({ name: r.column_name, type: r.data_type ?? '', nullable: r.is_nullable === 'YES', pk: r.is_pk, fk: r.fk });
    }
    return { tables: [...tables.values()] };
  }
}

export interface SchemaColumn {
  name: string;
  type: string;
  nullable: boolean;
  pk: boolean;
  fk: string | null;
}
export interface SchemaTable {
  name: string;
  kind: 'table' | 'view' | 'matview';
  columns: SchemaColumn[];
  rows: number | null;
}
export interface SchemaInfo {
  tables: SchemaTable[];
}

const SCHEMA_SQL = `
WITH rels AS (
  SELECT c.oid, c.relname AS table_name,
         CASE c.relkind WHEN 'v' THEN 'VIEW' WHEN 'm' THEN 'MATVIEW' ELSE 'TABLE' END AS table_type,
         GREATEST(c.reltuples, 0)::bigint AS est_rows
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'v', 'm', 'p')
),
pk AS (
  SELECT i.indrelid, unnest(i.indkey) AS attnum FROM pg_index i WHERE i.indisprimary
),
fk AS (
  SELECT con.conrelid, a.attnum,
         (SELECT relname FROM pg_class WHERE oid = con.confrelid) || '.' ||
         (SELECT attname FROM pg_attribute WHERE attrelid = con.confrelid AND attnum = con.confkey[array_position(con.conkey, a.attnum)]) AS target
  FROM pg_constraint con
  JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = ANY (con.conkey)
  WHERE con.contype = 'f'
)
SELECT r.table_name, r.table_type, a.attname AS column_name,
       format_type(a.atttypid, a.atttypmod) AS data_type,
       CASE WHEN a.attnotnull THEN 'NO' ELSE 'YES' END AS is_nullable,
       EXISTS (SELECT 1 FROM pk WHERE pk.indrelid = r.oid AND pk.attnum = a.attnum) AS is_pk,
       (SELECT min(target) FROM fk WHERE fk.conrelid = r.oid AND fk.attnum = a.attnum) AS fk,
       a.attnum AS ord,
       r.est_rows
FROM rels r
LEFT JOIN pg_attribute a ON a.attrelid = r.oid AND a.attnum > 0 AND NOT a.attisdropped
ORDER BY r.table_type = 'TABLE' DESC, r.table_name, a.attnum;
`;

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function toResult(
  res: { rows: unknown[]; fields: { name: string; dataTypeID: number }[]; affectedRows?: number },
  st: SqlStatement,
  index: number,
  limit: number,
): StatementResult {
  const columns: ColumnInfo[] = res.fields.map((f) => ({ name: f.name, typeId: f.dataTypeID }));
  const rows = res.rows as unknown[][];
  return {
    columns,
    rows: rows.length > limit ? rows.slice(0, limit) : rows,
    rowCount: rows.length,
    affectedRows: res.affectedRows ?? 0,
    truncated: rows.length > limit,
    command: commandOf(st),
    index,
    sql: st.sql,
  };
}

function commandOf(st: SqlStatement): string {
  if (st.keyword === 'WITH') {
    const m = /\)\s*(SELECT|INSERT|UPDATE|DELETE|MERGE)\b/i.exec(st.sql);
    return m ? m[1].toUpperCase() : 'SELECT';
  }
  if (st.keyword === 'CREATE' || st.keyword === 'DROP' || st.keyword === 'ALTER') {
    const m = /^\s*(CREATE|DROP|ALTER)\s+(OR\s+REPLACE\s+)?(UNIQUE\s+)?(TEMP\s+|TEMPORARY\s+|MATERIALIZED\s+)?([A-Za-z]+)/i.exec(st.sql);
    if (m) return `${m[1].toUpperCase()} ${(m[4] ?? '').trim().toUpperCase()} ${m[5].toUpperCase()}`.replace(/\s+/g, ' ');
  }
  return st.keyword || 'SQL';
}

function toSqlError(e: unknown, st: SqlStatement, index: number): SqlError {
  const err = e as { message?: string; code?: string; detail?: string; hint?: string; position?: string | number; where?: string };
  const pos = err.position !== undefined && err.position !== null && err.position !== '' ? Number(err.position) : undefined;
  return {
    message: err.message ?? String(e),
    code: err.code,
    detail: err.detail,
    hint: err.hint,
    where: err.where,
    position: pos !== undefined && Number.isFinite(pos) ? st.offset + pos : undefined,
    statementIndex: index,
    statementSql: st.sql,
    completed: index,
  };
}

const PREVIEW_ROWS = 200;
function trimResult(r: StatementResult | null): StatementResult | null {
  if (!r) return r;
  return r.rows.length > PREVIEW_ROWS ? { ...r, rows: r.rows.slice(0, PREVIEW_ROWS), truncated: true } : r;
}
function trimRun(run: RunOutput): RunOutput {
  return { ...run, results: run.results.map((r) => trimResult(r)!) };
}
