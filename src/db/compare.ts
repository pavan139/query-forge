import { canonEqual, canonical, canonKey, type Canon } from './values.ts';

export interface ColumnInfo {
  name: string;
  typeId: number;
}

export interface ResultSet {
  columns: ColumnInfo[];
  rows: unknown[][];
}

export interface CompareOptions {
  ordered?: boolean;
  columnNames?: boolean;
}

export type CompareOutcome =
  | { ok: true }
  | {
      ok: false;
      /** Short machine code for analytics and tailored UI. */
      code: 'no-result' | 'column-count' | 'column-names' | 'row-count' | 'values' | 'order';
      /** Friendly one-paragraph explanation for the learner. */
      message: string;
      /** Indices (in the learner's result) of rows that are not in the expected result. */
      extraRows?: number[];
      /** Indices (in the expected result) of rows the learner is missing. */
      missingRows?: number[];
    };

const lc = (s: string) => s.toLowerCase();

/** Reorders actual columns to match expected ones by name when every name matches. */
function alignColumns(expected: ResultSet, actual: ResultSet): number[] | null {
  const used = new Set<number>();
  const map: number[] = [];
  for (const col of expected.columns) {
    const idx = actual.columns.findIndex((c, i) => !used.has(i) && lc(c.name) === lc(col.name));
    if (idx === -1) return null;
    used.add(idx);
    map.push(idx);
  }
  return map;
}

/** Canonical rows, each value interpreted with its own column's type (reordered by `map`). */
function canonRows(rs: ResultSet, map: number[] | null): Canon[][] {
  const order = map ?? rs.columns.map((_, i) => i);
  return rs.rows.map((row) => order.map((i) => canonical(row[i], rs.columns[i]?.typeId ?? 25)));
}

function rowsEqual(a: Canon[], b: Canon[]): boolean {
  return a.length === b.length && a.every((c, i) => canonEqual(c, b[i]));
}

function rowKey(r: Canon[]): string {
  return r.map(canonKey).join('\u0001');
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

export function compareResults(expected: ResultSet, actual: ResultSet | null, opts: CompareOptions = {}): CompareOutcome {
  if (actual && actual.columns.length === 0 && actual.rows.length > 0) {
    return {
      ok: false,
      code: 'column-count',
      message: 'Your SELECT returned rows but no columns — list the columns you want right after the word SELECT.',
    };
  }
  if (!actual || actual.columns.length === 0) {
    return {
      ok: false,
      code: 'no-result',
      message: "Your SQL ran, but it didn't return any rows to check. This task needs a query that returns a result (usually a SELECT).",
    };
  }
  const expNames = expected.columns.map((c) => c.name);
  if (actual.columns.length !== expected.columns.length) {
    const fewer = actual.columns.length < expected.columns.length;
    return {
      ok: false,
      code: 'column-count',
      message:
        `Your result has ${plural(actual.columns.length, 'column')}, but the answer has ${plural(expected.columns.length, 'column')}` +
        (opts.columnNames || fewer ? ` (${expNames.join(', ')}).` : '.') +
        (fewer ? ' Check that you selected every column the task asks for.' : ' Check that you only selected the columns the task asks for.'),
    };
  }

  let map = alignColumns(expected, actual);
  if (opts.columnNames && !map) {
    const got = actual.columns.map((c) => c.name);
    const wrong = expNames.filter((n) => !got.some((g) => lc(g) === lc(n)));
    return {
      ok: false,
      code: 'column-names',
      message: `The column names don't match. Expected column${wrong.length > 1 ? 's' : ''} named ${wrong
        .map((w) => `"${w}"`)
        .join(', ')} — your columns are ${got.map((g) => `"${g}"`).join(', ')}. Use AS to rename a column.`,
    };
  }
  // Names don't line up: fall back to position.
  if (map && map.every((v, i) => v === i)) map = null;

  const exp = canonRows(expected, null);
  const act = canonRows(actual, map);

  if (exp.length !== act.length) {
    const more = act.length > exp.length;
    return {
      ok: false,
      code: 'row-count',
      message:
        `Your query returned ${plural(act.length, 'row')}, but the answer has ${plural(exp.length, 'row')}. ` +
        (more
          ? 'You have extra rows — maybe a filter (WHERE / HAVING) is missing or too loose, or a JOIN is duplicating rows.'
          : 'Some rows are missing — maybe a filter is too strict, or you need a LEFT JOIN instead of an INNER JOIN.'),
      ...diffRows(exp, act),
    };
  }

  if (opts.ordered) {
    const firstBad = exp.findIndex((r, i) => !rowsEqual(r, act[i]));
    if (firstBad === -1) return { ok: true };
    const sameSet = multisetEqual(exp, act);
    if (sameSet) {
      return {
        ok: false,
        code: 'order',
        message: `You have exactly the right rows, but in a different order (first difference at row ${firstBad + 1}). Check your ORDER BY.`,
        extraRows: [firstBad],
      };
    }
    return { ok: false, code: 'values', message: valuesMessage(exp, act), ...diffRows(exp, act) };
  }

  if (multisetEqual(exp, act)) return { ok: true };
  return { ok: false, code: 'values', message: valuesMessage(exp, act), ...diffRows(exp, act) };
}

function multisetEqual(exp: Canon[][], act: Canon[][]): boolean {
  const a = exp.map((r) => ({ r, k: rowKey(r) })).sort((x, y) => (x.k < y.k ? -1 : x.k > y.k ? 1 : 0));
  const b = act.map((r) => ({ r, k: rowKey(r) })).sort((x, y) => (x.k < y.k ? -1 : x.k > y.k ? 1 : 0));
  if (a.every((x, i) => rowsEqual(x.r, b[i].r))) return true;
  // Sorting can misalign rows whose numbers sit on a rounding boundary: fall back to greedy matching.
  const left = [...act];
  for (const r of exp) {
    const idx = left.findIndex((x) => rowsEqual(r, x));
    if (idx === -1) return false;
    left.splice(idx, 1);
  }
  return true;
}

function diffRows(exp: Canon[][], act: Canon[][]): { extraRows: number[]; missingRows: number[] } {
  const unmatchedExp = new Set(exp.map((_, i) => i));
  const extraRows: number[] = [];
  act.forEach((r, ai) => {
    for (const ei of unmatchedExp) {
      if (rowsEqual(exp[ei], r)) {
        unmatchedExp.delete(ei);
        return;
      }
    }
    extraRows.push(ai);
  });
  return { extraRows: extraRows.slice(0, 200), missingRows: [...unmatchedExp].slice(0, 200) };
}

function valuesMessage(exp: Canon[][], act: Canon[][]): string {
  const { extraRows } = diffRows(exp, act);
  const n = extraRows.length;
  // Find a column that is entirely different: often a wrong calculation or wrong column picked.
  const cols = exp[0]?.length ?? 0;
  const colExpSets = Array.from({ length: cols }, (_, c) => new Set(exp.map((r) => canonKey(r[c]))));
  const badCols: number[] = [];
  for (let c = 0; c < cols; c++) {
    const actSet = new Set(act.map((r) => canonKey(r[c])));
    let same = actSet.size === colExpSets[c].size;
    if (same) for (const k of actSet) if (!colExpSets[c].has(k)) same = false;
    if (!same) badCols.push(c);
  }
  const colHint =
    badCols.length > 0 && badCols.length < cols
      ? ` The values in column ${badCols.map((c) => c + 1).join(', ')} look different from the answer.`
      : '';
  return `Right number of rows, but ${plural(n, 'row')} ${n === 1 ? "doesn't" : "don't"} match the answer.${colHint} Compare your result with the expected output.`;
}
