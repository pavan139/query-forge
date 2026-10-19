#!/usr/bin/env node
// Validates content/*.yaml against the schema and writes JSON bundles to src/generated/.
// Usage: node scripts/build-content.mjs [--check]   (--check validates without writing)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { challengeFileSchema, glossarySchema, moduleSchema, semanticChecks } from './content-schema.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const contentDir = path.join(root, 'content');
const outDir = path.join(root, 'src', 'generated');
const checkOnly = process.argv.includes('--check');

const errors = [];
const readYaml = (file) => {
  try {
    return YAML.parse(fs.readFileSync(file, 'utf8'), { prettyErrors: true });
  } catch (e) {
    errors.push(`${path.relative(root, file)}: YAML error: ${e.message}`);
    return null;
  }
};
const zodErrors = (file, err) => {
  for (const issue of err.issues.slice(0, 30)) {
    errors.push(`${path.relative(root, file)}: ${issue.path.join('.')}: ${issue.message}`);
  }
};
const listYaml = (dir) =>
  fs.existsSync(dir)
    ? fs
        .readdirSync(dir)
        .filter((f) => /\.ya?ml$/.test(f))
        .sort()
        .map((f) => path.join(dir, f))
    : [];

// ---- modules
const modules = [];
for (const file of listYaml(path.join(contentDir, 'modules'))) {
  const data = readYaml(file);
  if (!data) continue;
  const parsed = moduleSchema.safeParse(data);
  if (!parsed.success) {
    zodErrors(file, parsed.error);
    continue;
  }
  for (const e of semanticChecks(parsed.data)) errors.push(`${path.relative(root, file)}: ${e}`);
  modules.push(parsed.data);
}
modules.sort((a, b) => a.order - b.order);

// ---- challenges
const challenges = [];
for (const file of listYaml(path.join(contentDir, 'challenges'))) {
  const data = readYaml(file);
  if (!data) continue;
  const parsed = challengeFileSchema.safeParse(data);
  if (!parsed.success) {
    zodErrors(file, parsed.error);
    continue;
  }
  challenges.push(...parsed.data.challenges);
}

// ---- glossary (content/glossary.yaml and/or content/glossary/*.yaml), de-duplicated by term
let glossary = [];
const glossaryFiles = [path.join(contentDir, 'glossary.yaml'), ...listYaml(path.join(contentDir, 'glossary'))].filter((f) => fs.existsSync(f));
const seenTerms = new Set();
for (const file of glossaryFiles) {
  const data = readYaml(file);
  const parsed = data && glossarySchema.safeParse(data);
  if (parsed && !parsed.success) zodErrors(file, parsed.error);
  else if (parsed)
    for (const g of parsed.data.glossary) {
      const k = g.term.toLowerCase();
      if (!seenTerms.has(k)) {
        seenTerms.add(k);
        glossary.push(g);
      }
    }
}
glossary.sort((a, b) => a.term.localeCompare(b.term));

// ---- datasets
const catalogFile = path.join(contentDir, 'datasets', 'catalog.json');
const datasets = fs.existsSync(catalogFile) ? JSON.parse(fs.readFileSync(catalogFile, 'utf8')) : [];

// ---- global uniqueness of ids
const seen = new Map();
const claim = (id, where) => {
  if (seen.has(id)) errors.push(`duplicate id "${id}" in ${where} (also in ${seen.get(id)})`);
  else seen.set(id, where);
};
const moduleIds = new Set();
for (const m of modules) {
  if (moduleIds.has(m.id)) errors.push(`duplicate module id ${m.id}`);
  moduleIds.add(m.id);
  for (const l of m.lessons) {
    claim(l.id, `${m.id} lessons`);
    for (const s of l.steps) if (s.id) claim(s.id, l.id);
  }
  for (const t of m.testPool) claim(t.id, `${m.id} testPool`);
  if (m.project) {
    claim(m.project.id, `${m.id} project`);
    for (const t of m.project.tasks) claim(t.id, m.project.id);
  }
}
for (const c of challenges) claim(c.id, 'challenges');

const GRADED = new Set(['exercise', 'quiz', 'predict', 'fill', 'parsons']);
const index = {
  modules: modules.map((m) => ({
    id: m.id,
    order: m.order,
    title: m.title,
    subtitle: m.subtitle,
    icon: m.icon,
    level: m.level,
    description: m.description,
    dataset: m.dataset,
    lessons: m.lessons.map((l) => ({
      id: l.id,
      title: l.title,
      summary: l.summary,
      minutes: l.minutes,
      graded: l.steps.filter((s) => GRADED.has(s.type)).length,
    })),
    testPoolSize: m.testPool.length,
    project: m.project ? { id: m.project.id, title: m.project.title, icon: m.project.icon, tasks: m.project.tasks.length } : undefined,
  })),
  challengeCount: challenges.length,
  generatedAt: new Date().toISOString().slice(0, 10),
};

if (errors.length) {
  console.error(`\n✖ ${errors.length} content error(s):\n` + errors.map((e) => '  • ' + e).join('\n'));
  process.exit(1);
}

const stats = {
  modules: modules.length,
  lessons: modules.reduce((n, m) => n + m.lessons.length, 0),
  graded: modules.reduce((n, m) => n + m.lessons.reduce((k, l) => k + l.steps.filter((s) => GRADED.has(s.type)).length, 0), 0),
  testPool: modules.reduce((n, m) => n + m.testPool.length, 0),
  projects: modules.filter((m) => m.project).length,
  challenges: challenges.length,
  glossary: glossary.length,
};

if (!checkOnly) {
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(outDir, 'modules'), { recursive: true });
  for (const m of modules) fs.writeFileSync(path.join(outDir, 'modules', `${m.id}.json`), JSON.stringify(m));
  fs.writeFileSync(path.join(outDir, 'index.json'), JSON.stringify(index));
  fs.writeFileSync(path.join(outDir, 'challenges.json'), JSON.stringify(challenges));
  fs.writeFileSync(path.join(outDir, 'glossary.json'), JSON.stringify(glossary));
  fs.writeFileSync(path.join(outDir, 'datasets.json'), JSON.stringify(datasets));
}
console.log(`✔ content ok: ${Object.entries(stats).map(([k, v]) => `${v} ${k}`).join(', ')}`);
