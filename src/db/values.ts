// Type handling shared by the browser worker and the Node content validator.

export const OID = {
  bool: 16,
  int8: 20,
  int2: 21,
  int4: 23,
  text: 25,
  oid: 26,
  json: 114,
  float4: 700,
  float8: 701,
  money: 790,
  bpchar: 1042,
  varchar: 1043,
  date: 1082,
  time: 1083,
  timestamp: 1114,
  timestamptz: 1184,
  interval: 1186,
  timetz: 1266,
  numeric: 1700,
  jsonb: 3802,
} as const;

const NUMERIC_TYPES = new Set<number>([OID.int8, OID.int2, OID.int4, OID.oid, OID.float4, OID.float8, OID.numeric]);
const INTEGER_TYPES = new Set<number>([OID.int8, OID.int2, OID.int4, OID.oid]);

export function isNumericType(typeId: number): boolean {
  return NUMERIC_TYPES.has(typeId);
}
export function isIntegerType(typeId: number): boolean {
  return INTEGER_TYPES.has(typeId);
}

const identity = (v: string) => v;

/**
 * PGlite parsers: keep dates/times exactly as Postgres prints them (no JS Date timezone surprises)
 * and turn bigint (e.g. COUNT(*)) into a plain number when it is safe.
 */
export const PARSERS: Record<number, (value: string) => unknown> = {
  [OID.date]: identity,
  [OID.time]: identity,
  [OID.timetz]: identity,
  [OID.timestamp]: identity,
  [OID.timestamptz]: identity,
  [OID.interval]: identity,
  [OID.money]: identity,
  [OID.int8]: (v: string) => {
    const n = Number(v);
    return Number.isSafeInteger(n) ? n : v;
  },
};

export const TYPE_NAMES: Record<number, string> = {
  16: 'boolean',
  17: 'bytea',
  20: 'bigint',
  21: 'smallint',
  23: 'integer',
  25: 'text',
  26: 'oid',
  114: 'json',
  700: 'real',
  701: 'double',
  790: 'money',
  1042: 'char',
  1043: 'varchar',
  1082: 'date',
  1083: 'time',
  1114: 'timestamp',
  1184: 'timestamptz',
  1186: 'interval',
  1266: 'timetz',
  1700: 'numeric',
  2950: 'uuid',
  3802: 'jsonb',
  1000: 'boolean[]',
  1005: 'smallint[]',
  1007: 'integer[]',
  1016: 'bigint[]',
  1009: 'text[]',
  1015: 'varchar[]',
  1182: 'date[]',
  1231: 'numeric[]',
  1022: 'double[]',
  3614: 'tsvector',
  3615: 'tsquery',
  2249: 'record',
};

export function typeName(typeId: number): string {
  return TYPE_NAMES[typeId] ?? 'value';
}

function stableJson(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(stableJson).join(',') + ']';
  const obj = v as Record<string, unknown>;
  return '{' + Object.keys(obj).sort().map((k) => JSON.stringify(k) + ':' + stableJson(obj[k])).join(',') + '}';
}

function pgArray(v: unknown[]): string {
  return (
    '{' +
    v
      .map((x) => {
        if (x === null || x === undefined) return 'NULL';
        if (Array.isArray(x)) return pgArray(x);
        if (typeof x === 'object') return stableJson(x);
        const s = String(x);
        return /[\s,{}"\\]/.test(s) || s === '' ? '"' + s.replace(/["\\]/g, '\\$&') + '"' : s;
      })
      .join(',') +
    '}'
  );
}

/** Human display of a single cell value (NULL handled by the caller). */
export function displayValue(v: unknown, typeId: number): string {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'bigint') return v.toString();
  if (typeof v === 'number') return String(v);
  if (v instanceof Uint8Array) return '\\x' + Array.from(v, (b) => b.toString(16).padStart(2, '0')).join('');
  if (v instanceof Date) return v.toISOString().replace('T', ' ').replace(/\.000Z$/, '').replace(/ 00:00:00$/, '');
  if (typeId === OID.json || typeId === OID.jsonb) return JSON.stringify(v);
  if (Array.isArray(v)) return pgArray(v);
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

export type Canon = { kind: 'null' } | { kind: 'num'; n: number } | { kind: 'str'; s: string };

/** Canonical form used for comparing a learner's result with the expected result. */
export function canonical(v: unknown, typeId: number): Canon {
  if (v === null || v === undefined) return { kind: 'null' };
  if (typeof v === 'number') return Number.isFinite(v) ? { kind: 'num', n: v } : { kind: 'str', s: String(v) };
  if (typeof v === 'bigint') return { kind: 'num', n: Number(v) };
  if (typeof v === 'string' && isNumericType(typeId)) {
    const n = Number(v);
    if (Number.isFinite(n)) return { kind: 'num', n };
  }
  if (typeof v === 'string' && (typeId === OID.timestamp || typeId === OID.timestamptz)) {
    // A midnight timestamp compares equal to a date.
    return { kind: 'str', s: v.replace(/ 00:00:00(\+00)?$/, '') };
  }
  if (typeof v === 'string' && typeId === OID.bpchar) return { kind: 'str', s: v.trimEnd() };
  if (typeof v === 'boolean') return { kind: 'str', s: v ? 'true' : 'false' };
  if (typeof v === 'object' && !(v instanceof Uint8Array) && !(v instanceof Date)) {
    return { kind: 'str', s: stableJson(v) };
  }
  return { kind: 'str', s: displayValue(v, typeId) };
}

/** Numbers match when they agree to 2 decimal places (rounding is not enforced). */
export function canonEqual(a: Canon, b: Canon): boolean {
  if (a.kind === 'null' || b.kind === 'null') return a.kind === b.kind;
  if (a.kind === 'num' && b.kind === 'num') {
    const diff = Math.abs(a.n - b.n);
    return diff <= 0.005 + 1e-9 * Math.max(Math.abs(a.n), Math.abs(b.n));
  }
  if (a.kind === 'num' && b.kind === 'str') return numStr(b.s, a.n);
  if (a.kind === 'str' && b.kind === 'num') return numStr(a.s, b.n);
  return (a as { s: string }).s === (b as { s: string }).s;
}

function numStr(s: string, n: number): boolean {
  const x = Number(s);
  return s.trim() !== '' && Number.isFinite(x) && Math.abs(x - n) <= 0.005 + 1e-9 * Math.abs(n);
}

/** Sort key for unordered comparison: numbers rounded to 2 decimals so near-equal values line up. */
export function canonKey(c: Canon): string {
  if (c.kind === 'null') return '\u0000';
  if (c.kind === 'num') return 'n' + (Math.round(c.n * 100) / 100).toFixed(2);
  const x = Number(c.s);
  if (c.s.trim() !== '' && Number.isFinite(x)) return 'n' + (Math.round(x * 100) / 100).toFixed(2);
  return 's' + c.s;
}
