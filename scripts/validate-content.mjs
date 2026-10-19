#!/usr/bin/env node
// Runs every piece of SQL in the course against real PostgreSQL (PGlite) exactly like the app does.
// Usage:
//   node scripts/validate-content.mjs                      # everything
//   node scripts/validate-content.mjs content/modules/m05-aggregation.yaml [--verbose]
//   --verbose   print the result of every predict/quiz query so you can double-check answers
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { PGlite } from '@electric-sql/pglite';
import { tablefunc } from '@electric-sql/pglite/contrib/tablefunc';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { Engine } from '../src/db/engine.ts';
import { displayValue } from '../src/db/values.ts';
import { challengeFileSchema, moduleSchema, semanticChecks } from './content-schema.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const verbose = args.includes('--verbose');
let files = args.filter((a) => !a.startsWith('--')).map((f) => path.resolve(f));
if (files.length === 0) {
  const dirs = ['content/modules', 'content/challenges'];
  files = dirs.flatMap((d) => {
    const abs = path.join(root, d);
    return fs.existsSync(abs) ? fs.readdirSync(abs).filter((f) => /\.ya?ml$/.test(f)).sort().map((f) => path.join(abs, f)) : [];
  });
}

const db = new PGlite({ extensions: { tablefunc, pg_trgm } });
await db.waitReady;
const datasetCache = new Map();
const engine = new Engine(db, async (id) => {
  if (!datasetCache.has(id)) datasetCache.set(id, fs.readFileSync(path.join(root, 'public', 'datasets', `${id}.sql`), 'utf8'));
  return datasetCache.get(id);
});

let errorCount = 0;
let warnCount = 0;
let checked = 0;
const err = (where, msg) => {
  errorCount++;
  console.log(`  ✖ ${where}: ${msg}`);
};
const warn = (where, msg) => {
  warnCount++;
  console.log(`  ⚠ ${where}: ${msg}`);
};

function fmtErr(e) {
  if (!e) return 'unknown error';
  return `${e.message}${e.hint ? ` (hint: ${e.hint})` : ''}${e.statementSql ? `\n      in: ${e.statementSql.split('\n').join('\n          ')}` : ''}`;
}

function preview(res) {
  if (!res) return '(no result set)';
  const head = res.columns.map((c) => c.name).join(' | ');
  const rows = res.rows.slice(0, 5).map((r) => r.map((v, i) => displayValue(v, res.columns[i].typeId)).join(' | '));
  return `${res.rowCount} row(s): [${head}]\n        ${rows.join('\n        ')}${res.rowCount > 5 ? '\n        ...' : ''}`;
}

async function runOn(dataset, sql, setup) {
  await engine.use(dataset);
  if (setup) {
    const s = await engine.run(setup);
    if (!s.ok) return { setupError: s.error };
  }
  return engine.run(sql, 50);
}

async function checkExercise(ex, dataset, where) {
  checked++;
  const spec = {
    dataset: ex.dataset ?? dataset,
    solution: ex.solution,
    learner: ex.solution,
    setup: ex.setup,
    check: ex.check,
    ordered: ex.ordered,
    columnNames: ex.columnNames,
    cacheKey: `${where}:${ex.id}`,
  };
  const res = await engine.check(spec);
  if (res.solutionError) return err(where, `solution fails: ${fmtErr(res.solutionError)}`);
  if (res.error) return err(where, `solution fails on re-run: ${fmtErr(res.error)}`);
  if (!res.pass) return err(where, `solution does not match itself: ${res.outcome?.message}`);
  const expected = res.expected;
  if (!expected) return err(where, 'solution returns no result set');
  if (expected.rowCount === 0 && !ex.allowEmpty) err(where, 'solution returns 0 rows (set allowEmpty: true if intended)');
  if (expected.rowCount > 1000) warn(where, `solution returns ${expected.rowCount} rows — consider a smaller result`);
  if (/\b(sort|order(ed)? by|highest first|lowest first|alphabetical)/i.test(ex.prompt) && !ex.ordered)
    warn(where, 'prompt talks about ordering but ordered is not true');
  if (verbose) console.log(`    ${where} → ${preview(expected)}`);
  if (ex.starter && ex.starter.trim()) {
    const s = await engine.check({ ...spec, learner: ex.starter, cacheKey: spec.cacheKey });
    if (s.pass) err(where, 'starter code already passes the check');
  }
}

async function checkStep(s, dataset, where) {
  const ds = s.dataset ?? dataset;
  switch (s.type) {
    case 'example': {
      checked++;
      const r = await runOn(ds, s.sql);
      if (r.setupError) return err(where, fmtErr(r.setupError));
      if (s.expectError) {
        if (r.ok) err(where, 'example has expectError but it ran fine');
      } else if (!r.ok) err(where, `example fails: ${fmtErr(r.error)}`);
      else {
        const ans = Engine.answerOf(r);
        if (ans && ans.rowCount === 0) warn(where, 'example returns 0 rows');
      }
      return;
    }
    case 'exercise':
      return checkExercise(s, ds, where);
    case 'quiz':
      if (s.sql) {
        checked++;
        const r = await runOn(ds, s.sql);
        if (!r.ok && !s.expectError) err(where, `quiz sql fails: ${fmtErr(r.error)}`);
        else if (verbose) console.log(`    ${where} → ${preview(Engine.answerOf(r))}`);
      }
      return;
    case 'predict': {
      checked++;
      const r = await runOn(ds, s.sql);
      if (s.expectError) {
        if (r.ok) err(where, 'predict has expectError but query ran fine');
        else if (verbose) console.log(`    ${where} → ERROR ${r.error.message}`);
      } else if (!r.ok) err(where, `predict sql fails: ${fmtErr(r.error)}`);
      else if (verbose) console.log(`    ${where} → ${preview(Engine.answerOf(r))}\n      answer: ${s.options[s.answer]}`);
      return;
    }
    case 'fill': {
      checked++;
      // Every accepted value for each blank must produce runnable SQL (others use their first value).
      for (let b = 0; b < s.answers.length; b++) {
        for (const alt of s.answers[b]) {
          let k = 0;
          const sql = s.template.replace(/___/g, () => {
            const i = k++;
            return i === b ? alt : s.answers[i][0];
          });
          const r = await runOn(ds, sql);
          if (!r.ok) err(where, `fill with "${alt}" in blank ${b + 1} fails: ${fmtErr(r.error)}`);
        }
      }
      return;
    }
    case 'parsons': {
      if (s.runnable === false) return;
      checked++;
      const r = await runOn(ds, s.lines.join('\n'));
      if (!r.ok) err(where, `parsons lines don't run in order: ${fmtErr(r.error)}`);
      return;
    }
    case 'stepper':
      for (const [i, st] of s.stages.entries()) {
        checked++;
        const r = await runOn(ds, st.sql);
        if (!r.ok) err(`${where} stage ${i + 1}`, fmtErr(r.error));
      }
      return;
    default:
      return;
  }
}

const started = Date.now();
for (const file of files) {
  const rel = path.relative(root, file);
  console.log(`\n▶ ${rel}`);
  let data;
  try {
    data = YAML.parse(fs.readFileSync(file, 'utf8'), { prettyErrors: true });
  } catch (e) {
    err(rel, `YAML error: ${e.message}`);
    continue;
  }
  if (data && data.challenges) {
    const parsed = challengeFileSchema.safeParse(data);
    if (!parsed.success) {
      for (const i of parsed.error.issues.slice(0, 30)) err(rel, `${i.path.join('.')}: ${i.message}`);
      continue;
    }
    const ids = new Set();
    for (const c of parsed.data.challenges) {
      if (ids.has(c.id)) err(rel, `duplicate id ${c.id}`);
      ids.add(c.id);
      await checkExercise(c, c.dataset, c.id);
    }
    continue;
  }
  const parsed = moduleSchema.safeParse(data);
  if (!parsed.success) {
    for (const i of parsed.error.issues.slice(0, 30)) err(rel, `${i.path.join('.')}: ${i.message}`);
    continue;
  }
  const mod = parsed.data;
  for (const e of semanticChecks(mod)) err(rel, e);
  const ids = new Set();
  const claim = (id, where) => {
    if (ids.has(id)) err(where, `duplicate id ${id}`);
    ids.add(id);
  };
  for (const lesson of mod.lessons) {
    claim(lesson.id, lesson.id);
    const ds = lesson.dataset ?? mod.dataset;
    const graded = lesson.steps.filter((s) => ['exercise', 'quiz', 'predict', 'fill', 'parsons'].includes(s.type)).length;
    const exercises = lesson.steps.filter((s) => s.type === 'exercise').length;
    if (exercises < 3) warn(lesson.id, `only ${exercises} exercise(s) — aim for 4+`);
    if (graded < 5) warn(lesson.id, `only ${graded} graded step(s)`);
    for (const [i, s] of lesson.steps.entries()) {
      if (s.id) claim(s.id, lesson.id);
      await checkStep(s, ds, `${lesson.id} step ${i + 1}${s.id ? ` (${s.id})` : ` [${s.type}]`}`);
    }
  }
  for (const t of mod.testPool) {
    claim(t.id, 'testPool');
    const lesson = mod.lessons.find((l) => l.id === t.lesson);
    await checkStep(t, lesson?.dataset ?? mod.dataset, `testPool ${t.id}`);
  }
  if (mod.project) for (const t of mod.project.tasks) {
    claim(t.id, mod.project.id);
    await checkExercise(t, t.dataset ?? mod.project.dataset, `project ${t.id}`);
  }
  const lessons = mod.lessons.length;
  console.log(`  ${lessons} lessons, ${mod.testPool.length} test items${mod.project ? `, project with ${mod.project.tasks.length} tasks` : ''}`);
}

console.log(
  `\n${errorCount ? '✖' : '✔'} ${checked} SQL checks, ${errorCount} error(s), ${warnCount} warning(s) in ${((Date.now() - started) / 1000).toFixed(1)}s`,
);
process.exit(errorCount ? 1 : 0);
