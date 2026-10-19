#!/usr/bin/env node
// Run SQL against a dataset exactly like the app does, and print the results.
// Usage: node scripts/sql.mjs <dataset> "<sql>"      or      node scripts/sql.mjs <dataset> -f file.sql
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { tablefunc } from '@electric-sql/pglite/contrib/tablefunc';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { Engine } from '../src/db/engine.ts';
import { displayValue } from '../src/db/values.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [dataset, arg, file] = process.argv.slice(2);
if (!dataset || !arg) {
  console.error('Usage: node scripts/sql.mjs <dataset> "<sql>"   |   node scripts/sql.mjs <dataset> -f query.sql');
  process.exit(2);
}
const sql = arg === '-f' ? fs.readFileSync(file, 'utf8') : arg;
const db = new PGlite({ extensions: { tablefunc, pg_trgm } });
const engine = new Engine(db, async (id) => fs.readFileSync(path.join(root, 'public', 'datasets', `${id}.sql`), 'utf8'));
await engine.use(dataset);
const out = await engine.run(sql, 200);
for (const r of out.results) {
  if (!r.columns.length) {
    console.log(`-- ${r.command}${r.affectedRows ? ` (${r.affectedRows} rows)` : ''}`);
    continue;
  }
  const head = r.columns.map((c) => c.name);
  const rows = r.rows.map((row) => row.map((v, i) => (v === null ? 'NULL' : displayValue(v, r.columns[i].typeId))));
  const w = head.map((h, i) => Math.min(40, Math.max(h.length, ...rows.map((x) => x[i].length))));
  const line = (cells) => cells.map((c, i) => String(c).slice(0, 40).padEnd(w[i])).join(' | ');
  console.log(line(head));
  console.log(w.map((n) => '-'.repeat(n)).join('-+-'));
  for (const x of rows) console.log(line(x));
  console.log(`(${r.rowCount} row${r.rowCount === 1 ? '' : 's'}${r.truncated ? ', first 200 shown' : ''})\n`);
}
for (const n of out.notices) console.log(n);
if (out.error) {
  console.log(`ERROR: ${out.error.message}${out.error.hint ? `\nHINT: ${out.error.hint}` : ''}${out.error.code ? `\nSQLSTATE: ${out.error.code}` : ''}`);
  process.exit(1);
}
