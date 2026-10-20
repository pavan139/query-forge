#!/usr/bin/env node
// "Blind solver" tooling: export every graded item WITHOUT its answer, then grade a set of answers
// exactly like the app does. If a careful solver who only sees the prompt gets it wrong, the prompt is
// probably ambiguous (or the answer key is wrong).
//
//   node scripts/blind.mjs prompts content/modules/m05-aggregation.yaml > /tmp/m05-prompts.md
//   node scripts/blind.mjs check   content/modules/m05-aggregation.yaml /tmp/m05-answers.json
//
// answers.json maps item id → answer:
//   exercise: "SQL text"   quiz/predict: 2 (or [0, 3] for multi-answer quizzes)
//   fill: ["blank 1", "blank 2"]   parsons: ["line text", "line text", ...] (in order, without distractors)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { PGlite } from '@electric-sql/pglite';
import { tablefunc } from '@electric-sql/pglite/contrib/tablefunc';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { Engine } from '../src/db/engine.ts';
import { displayValue } from '../src/db/values.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [cmd, file, answersFile] = process.argv.slice(2);
if (!cmd || !file || (cmd === 'check' && !answersFile)) {
  console.error('usage: node scripts/blind.mjs prompts <file.yaml> | check <file.yaml> <answers.json>');
  process.exit(2);
}

const data = YAML.parse(fs.readFileSync(path.resolve(file), 'utf8'));

/** Every graded item in the file with its context: { item, dataset, where }. */
function collect() {
  const out = [];
  if (data.challenges) {
    for (const c of data.challenges) out.push({ item: { ...c, type: 'exercise' }, dataset: c.dataset, where: `challenge ${c.title}` });
    return out;
  }
  for (const lesson of data.lessons ?? []) {
    const ds = lesson.dataset ?? data.dataset;
    for (const s of lesson.steps ?? []) {
      if (['exercise', 'quiz', 'predict', 'fill', 'parsons'].includes(s.type)) out.push({ item: s, dataset: s.dataset ?? ds, where: lesson.id });
    }
  }
  for (const t of data.testPool ?? []) {
    const lesson = (data.lessons ?? []).find((l) => l.id === t.lesson);
    out.push({ item: t, dataset: t.dataset ?? lesson?.dataset ?? data.dataset, where: `testPool (${t.lesson})` });
  }
  if (data.project) {
    for (const t of data.project.tasks ?? []) out.push({ item: { ...t, type: 'exercise' }, dataset: t.dataset ?? data.project.dataset, where: `project ${data.project.id}` });
  }
  return out;
}

function shuffle(arr, seedStr) {
  let seed = 0;
  for (const c of seedStr) seed = (seed * 31 + c.charCodeAt(0)) | 0;
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const j = seed % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const fence = (sql) => '```sql\n' + sql.trim() + '\n```';

function exportPrompts() {
  const items = collect();
  const lines = [`# Blind prompts for ${path.relative(root, path.resolve(file))} (${items.length} items)\n`];
  for (const { item: s, dataset, where } of items) {
    lines.push(`## ${s.id} — ${s.type} — dataset: ${dataset} — ${where}`);
    switch (s.type) {
      case 'exercise': {
        lines.push(s.prompt.trim());
        const rules = [];
        rules.push(s.ordered ? 'Row order IS checked.' : 'Row order is NOT checked.');
        rules.push(s.columnNames ? 'Column names ARE checked (use the aliases asked for).' : 'Column names are not checked, but column order is.');
        lines.push(`_Checking: ${rules.join(' ')}_`);
        if (s.setup) lines.push('Hidden setup that already ran before the learner\'s SQL (she sees the resulting tables in the schema panel):', fence(s.setup));
        if (s.check) lines.push('_This is a data-changing task: after her SQL runs, a hidden query inspects the tables._');
        if (s.starter) lines.push('Starter code already in the editor:', fence(s.starter));
        break;
      }
      case 'quiz':
        lines.push(s.question.trim());
        if (s.sql) lines.push(fence(s.sql));
        s.options.forEach((o, i) => lines.push(`${i}. ${o}`));
        if (Array.isArray(s.answer)) lines.push('_Select ALL correct options (answer is a list of indexes)._');
        break;
      case 'predict':
        lines.push(s.question?.trim() ?? 'What does this query return?');
        lines.push(fence(s.sql));
        s.options.forEach((o, i) => lines.push(`${i}. ${o}`));
        break;
      case 'fill':
        lines.push(s.prompt?.trim() ?? '');
        lines.push(`Template (${s.answers.length} blank(s) marked ___):`, fence(s.template));
        break;
      case 'parsons': {
        lines.push(s.prompt?.trim() ?? 'Put the lines in order.');
        const pool = shuffle([...s.lines, ...(s.distractors ?? [])], s.id);
        lines.push('Lines (shuffled; some may be distractors that do not belong):');
        pool.forEach((l) => lines.push(`- \`${l}\``));
        break;
      }
    }
    lines.push('');
  }
  console.log(lines.join('\n'));
}

function preview(rs) {
  if (!rs) return '(no result set)';
  const head = rs.columns.map((c) => c.name).join(' | ');
  const rows = rs.rows.slice(0, 6).map((r) => r.map((v, i) => displayValue(v, rs.columns[i].typeId)).join(' | '));
  return `${rs.rowCount ?? rs.rows.length} row(s): [${head}]\n      ${rows.join('\n      ')}${rs.rows.length > 6 ? '\n      ...' : ''}`;
}

const norm = (s) =>
  String(s)
    .trim()
    .replace(/;+$/, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*([(),=<>*+\-/])\s*/g, '$1')
    .toLowerCase();

async function checkAnswers() {
  const answers = JSON.parse(fs.readFileSync(path.resolve(answersFile), 'utf8'));
  const db = new PGlite({ extensions: { tablefunc, pg_trgm } });
  await db.waitReady;
  const cache = new Map();
  const engine = new Engine(db, async (id) => {
    if (!cache.has(id)) cache.set(id, fs.readFileSync(path.join(root, 'public', 'datasets', `${id}.sql`), 'utf8'));
    return cache.get(id);
  });
  const sameResult = async (dataset, a, b) => {
    const r = await engine.check({ dataset, solution: a, learner: b, cacheKey: `blind:${a}` });
    return r.pass;
  };

  let pass = 0;
  let fail = 0;
  let missing = 0;
  const items = collect();
  for (const { item: s, dataset } of items) {
    if (!(s.id in answers)) {
      missing++;
      console.log(`· ${s.id}: no answer given`);
      continue;
    }
    const a = answers[s.id];
    let ok = false;
    let detail = '';
    switch (s.type) {
      case 'exercise': {
        const res = await engine.check({
          dataset,
          solution: s.solution,
          learner: String(a),
          setup: s.setup,
          check: s.check,
          ordered: s.ordered,
          columnNames: s.columnNames,
          cacheKey: `blind:${s.id}`,
        });
        ok = res.pass;
        if (!ok) {
          if (res.error) detail = `learner SQL error: ${res.error.message}`;
          else detail = `${res.outcome?.message ?? 'mismatch'}\n    expected ${preview(res.expected)}\n    got      ${preview(res.actual)}`;
          detail += `\n    blind SQL: ${String(a).trim().split('\n').join('\n               ')}`;
        }
        break;
      }
      case 'quiz':
      case 'predict': {
        const want = Array.isArray(s.answer) ? [...s.answer].sort() : [s.answer];
        const got = (Array.isArray(a) ? [...a] : [a]).map(Number).sort();
        ok = want.length === got.length && want.every((x, i) => x === got[i]);
        if (!ok) detail = `key says ${JSON.stringify(s.answer)} (${want.map((i) => `"${s.options[i]}"`).join(', ')}); blind answer ${JSON.stringify(a)} (${got.map((i) => `"${s.options[i]}"`).join(', ')})`;
        break;
      }
      case 'fill': {
        const vals = Array.isArray(a) ? a : [a];
        const perBlank = s.answers.map((alts, i) => alts.some((x) => norm(x) === norm(vals[i] ?? '')));
        ok = perBlank.every(Boolean) && vals.length === s.answers.length;
        if (!ok) {
          let k = 0;
          const learnerSql = s.template.replace(/___/g, () => vals[k++] ?? '');
          k = 0;
          const keySql = s.template.replace(/___/g, () => s.answers[k++][0]);
          let equiv = false;
          try {
            equiv = await sameResult(dataset, keySql, learnerSql);
          } catch {
            equiv = false;
          }
          detail = `accepted ${JSON.stringify(s.answers)}; blind ${JSON.stringify(vals)}${equiv ? ' — SAME RESULT as the key: consider accepting it' : ''}`;
        }
        break;
      }
      case 'parsons': {
        const got = Array.isArray(a) ? a.map((x) => String(x).trim()) : [];
        ok = got.length === s.lines.length && got.every((l, i) => l === s.lines[i].trim());
        if (!ok) {
          let equiv = false;
          if (s.runnable !== false && got.length) {
            try {
              equiv = await sameResult(dataset, s.lines.join('\n'), got.join('\n'));
            } catch {
              equiv = false;
            }
          }
          detail = `expected order:\n      ${s.lines.join('\n      ')}\n    blind order:\n      ${got.join('\n      ')}${equiv ? '\n    — blind order runs with the SAME RESULT: the puzzle has more than one valid order' : ''}`;
        }
        break;
      }
    }
    if (ok) pass++;
    else {
      fail++;
      console.log(`✖ ${s.id} [${s.type}] ${detail}`);
    }
  }
  console.log(`\nblind: ${pass} passed, ${fail} failed, ${missing} missing of ${items.length}`);
  process.exit(fail ? 1 : 0);
}

if (cmd === 'prompts') exportPrompts();
else if (cmd === 'check') await checkAnswers();
else {
  console.error(`unknown command ${cmd}`);
  process.exit(2);
}
