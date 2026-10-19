// Splits a SQL script into statements, respecting quotes, dollar-quoting and comments.
// Each statement keeps its offset in the original text so error positions can be mapped back.

export interface SqlStatement {
  sql: string;
  /** Offset of the first character of `sql` in the original script. */
  offset: number;
  /** Uppercased first keyword (SELECT, INSERT, WITH, ...) or '' if none. */
  keyword: string;
}

export function splitSql(script: string): SqlStatement[] {
  const out: SqlStatement[] = [];
  let i = 0;
  let start = 0;
  const n = script.length;
  // Depth of BEGIN ATOMIC ... END bodies (SQL-standard function bodies) is rare; ignored.
  while (i < n) {
    const c = script[i];
    const next = script[i + 1];
    if (c === '-' && next === '-') {
      const nl = script.indexOf('\n', i);
      i = nl === -1 ? n : nl + 1;
      continue;
    }
    if (c === '/' && next === '*') {
      let depth = 1;
      i += 2;
      while (i < n && depth > 0) {
        if (script[i] === '/' && script[i + 1] === '*') {
          depth++;
          i += 2;
        } else if (script[i] === '*' && script[i + 1] === '/') {
          depth--;
          i += 2;
        } else i++;
      }
      continue;
    }
    if (c === "'") {
      // E'...' strings allow backslash escapes.
      const escapes = i > 0 && (script[i - 1] === 'E' || script[i - 1] === 'e') && !isIdentChar(script[i - 2]);
      i++;
      while (i < n) {
        if (escapes && script[i] === '\\') {
          i += 2;
          continue;
        }
        if (script[i] === "'") {
          if (script[i + 1] === "'") {
            i += 2;
            continue;
          }
          break;
        }
        i++;
      }
      i++;
      continue;
    }
    if (c === '"') {
      i++;
      while (i < n) {
        if (script[i] === '"') {
          if (script[i + 1] === '"') {
            i += 2;
            continue;
          }
          break;
        }
        i++;
      }
      i++;
      continue;
    }
    if (c === '$' && !isIdentChar(script[i - 1])) {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(script.slice(i, i + 64));
      if (m) {
        const tag = m[0];
        const close = script.indexOf(tag, i + tag.length);
        i = close === -1 ? n : close + tag.length;
        continue;
      }
    }
    if (c === ';') {
      push(out, script, start, i);
      start = i + 1;
    }
    i++;
  }
  push(out, script, start, n);
  return out;
}

function isIdentChar(ch: string | undefined): boolean {
  return !!ch && /[A-Za-z0-9_]/.test(ch);
}

function push(out: SqlStatement[], script: string, from: number, to: number) {
  const raw = script.slice(from, to);
  if (!stripComments(raw).trim()) return;
  // Trim leading whitespace but keep offsets exact.
  const lead = raw.length - raw.trimStart().length;
  const sql = raw.trim();
  out.push({ sql, offset: from + lead, keyword: firstKeyword(sql) });
}

export function stripComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ');
}

export function firstKeyword(sql: string): string {
  const m = /^[\s(]*([A-Za-z]+)/.exec(stripComments(sql));
  return m ? m[1].toUpperCase() : '';
}

const READ_ONLY = new Set(['SELECT', 'VALUES', 'TABLE', 'SHOW', 'EXPLAIN']);
const DML_IN_WITH = /\b(INSERT|UPDATE|DELETE|MERGE)\b/i;

/** True when the statement can change database state (data, schema or session). */
export function isMutating(stmt: SqlStatement): boolean {
  const kw = stmt.keyword;
  const body = stripComments(stmt.sql);
  if (kw === 'WITH') return DML_IN_WITH.test(body);
  if (kw === 'EXPLAIN') return /\bANALYZE\b/i.test(body) && DML_IN_WITH.test(body);
  if (kw === 'SELECT') {
    // SELECT ... INTO new_table creates a table; a few functions change session state.
    const head = body.split(/\bFROM\b/i)[0] ?? '';
    return /\bINTO\b/i.test(head) || /\b(nextval|setval|set_config)\s*\(/i.test(body);
  }
  return !READ_ONLY.has(kw);
}
