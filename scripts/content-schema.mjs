// Zod schemas mirroring src/content/types.ts. Used by build-content.mjs and validate-content.mjs.
import { z } from 'zod';

export const DATASETS = ['cafe', 'shop', 'company', 'movies', 'bank', 'app', 'school', 'messy', 'blank'];
const dataset = z.enum(DATASETS);
const md = z.string().min(1);
const id = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'ids are lowercase letters, digits and dashes');
const sql = z.string().min(1);

const read = z.object({ type: z.literal('read'), title: z.string().optional(), md }).strict();
const example = z
  .object({
    type: z.literal('example'),
    title: z.string().optional(),
    md: md.optional(),
    sql,
    after: md.optional(),
    dataset: dataset.optional(),
    expectError: z.boolean().optional(),
  })
  .strict();
const exerciseFields = {
  id,
  title: z.string().optional(),
  prompt: md,
  starter: z.string().optional(),
  solution: sql,
  setup: z.string().optional(),
  check: z.string().optional(),
  ordered: z.boolean().optional(),
  columnNames: z.boolean().optional(),
  allowEmpty: z.boolean().optional(),
  hints: z.array(z.string().min(1)).min(1),
  explanation: md.optional(),
  difficulty: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
  dataset: dataset.optional(),
};
const exercise = z.object({ type: z.literal('exercise'), ...exerciseFields }).strict();
const quizFields = {
  id,
  question: md,
  sql: z.string().optional(),
  options: z.array(z.string().min(1)).min(2).max(6),
  answer: z.union([z.number().int().min(0), z.array(z.number().int().min(0)).min(1)]),
  explanation: md,
  dataset: dataset.optional(),
  expectError: z.boolean().optional(),
};
const quiz = z.object({ type: z.literal('quiz'), ...quizFields }).strict();
const predictFields = {
  id,
  question: md,
  sql,
  options: z.array(z.string().min(1)).min(2).max(6),
  answer: z.number().int().min(0),
  explanation: md,
  dataset: dataset.optional(),
  expectError: z.boolean().optional(),
};
const predict = z.object({ type: z.literal('predict'), ...predictFields }).strict();
const fillFields = {
  id,
  prompt: md,
  template: sql,
  answers: z.array(z.array(z.string().min(1)).min(1)).min(1),
  explanation: md.optional(),
  dataset: dataset.optional(),
};
const fill = z.object({ type: z.literal('fill'), ...fillFields }).strict();
const parsonsFields = {
  id,
  prompt: md,
  lines: z.array(z.string().min(1)).min(2).max(12),
  distractors: z.array(z.string().min(1)).max(4).optional(),
  explanation: md.optional(),
  dataset: dataset.optional(),
  runnable: z.boolean().optional(),
};
const parsons = z.object({ type: z.literal('parsons'), ...parsonsFields }).strict();
const viz = z
  .object({
    type: z.literal('viz'),
    viz: z.enum(['join', 'groupby', 'window', 'execution-order', 'null-logic', 'set-ops', 'index', 'transaction']),
    title: z.string().optional(),
    md: md.optional(),
    config: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
const stepper = z
  .object({
    type: z.literal('stepper'),
    title: z.string(),
    md: md.optional(),
    stages: z.array(z.object({ label: z.string(), md, sql }).strict()).min(2),
    dataset: dataset.optional(),
  })
  .strict();

export const stepSchema = z.discriminatedUnion('type', [read, example, exercise, quiz, predict, fill, parsons, viz, stepper]);

const testMeta = { lesson: id, difficulty: z.union([z.literal(1), z.literal(2), z.literal(3)]) };
export const testItemSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('exercise'), ...exerciseFields, ...testMeta }).strict(),
  z.object({ type: z.literal('quiz'), ...quizFields, ...testMeta }).strict(),
  z.object({ type: z.literal('predict'), ...predictFields, ...testMeta }).strict(),
  z.object({ type: z.literal('fill'), ...fillFields, ...testMeta }).strict(),
  z.object({ type: z.literal('parsons'), ...parsonsFields, ...testMeta }).strict(),
]);

const cheat = z.object({ title: z.string(), sql, note: z.string().optional() }).strict();

export const lessonSchema = z
  .object({
    id,
    title: z.string().min(3),
    summary: z.string().min(5),
    minutes: z.number().int().min(2).max(60),
    dataset: dataset.optional(),
    steps: z.array(stepSchema).min(3),
    cheatsheet: z.array(cheat).optional(),
  })
  .strict();

export const projectSchema = z
  .object({ id, title: z.string(), icon: z.string(), md, dataset, tasks: z.array(exercise).min(3) })
  .strict();

export const moduleSchema = z
  .object({
    id: z.string().regex(/^m\d\d$/),
    order: z.number().int(),
    title: z.string(),
    subtitle: z.string(),
    icon: z.string(),
    level: z.enum(['beginner', 'intermediate', 'advanced', 'expert']),
    description: md,
    dataset,
    lessons: z.array(lessonSchema).min(1),
    testPool: z.array(testItemSchema).min(1),
    project: projectSchema.optional(),
  })
  .strict();

export const challengeSchema = z
  .object({
    id,
    title: z.string(),
    difficulty: z.enum(['easy', 'medium', 'hard', 'expert']),
    dataset,
    tags: z.array(z.string()).min(1),
    module: z.string().regex(/^m\d\d$/),
    prompt: md,
    starter: z.string().optional(),
    solution: sql,
    setup: z.string().optional(),
    check: z.string().optional(),
    ordered: z.boolean().optional(),
    columnNames: z.boolean().optional(),
    allowEmpty: z.boolean().optional(),
    hints: z.array(z.string().min(1)).min(1),
    explanation: md,
  })
  .strict();

export const challengeFileSchema = z.object({ challenges: z.array(challengeSchema).min(1) }).strict();

export const glossarySchema = z
  .object({
    glossary: z.array(
      z.object({ term: z.string(), definition: md, example: z.string().optional(), module: z.string().optional() }).strict(),
    ),
  })
  .strict();

/** Cross-field checks zod can't express. Returns a list of error strings. */
export function semanticChecks(mod) {
  const errs = [];
  const lessonIds = new Set(mod.lessons.map((l) => l.id));
  for (const l of mod.lessons) {
    if (!l.id.startsWith(mod.id + '-')) errs.push(`lesson ${l.id}: id must start with "${mod.id}-"`);
    for (const s of l.steps) errs.push(...stepChecks(s, `${l.id}`));
  }
  for (const t of mod.testPool) {
    if (!lessonIds.has(t.lesson)) errs.push(`testPool ${t.id}: lesson "${t.lesson}" not in this module`);
    errs.push(...stepChecks(t, `testPool`));
  }
  if (mod.project) for (const t of mod.project.tasks) errs.push(...stepChecks(t, `project ${mod.project.id}`));
  return errs;
}

export function stepChecks(s, where) {
  const errs = [];
  const at = `${where} ${s.id ?? s.type}`;
  if (s.type === 'quiz' || s.type === 'predict') {
    const answers = Array.isArray(s.answer) ? s.answer : [s.answer];
    for (const a of answers) if (a >= s.options.length) errs.push(`${at}: answer index ${a} out of range`);
    if (new Set(s.options).size !== s.options.length) errs.push(`${at}: duplicate options`);
  }
  if (s.type === 'fill') {
    const blanks = (s.template.match(/___/g) ?? []).length;
    if (blanks !== s.answers.length) errs.push(`${at}: template has ${blanks} blanks but ${s.answers.length} answer lists`);
  }
  if (s.type === 'exercise' && s.ordered && !/order\s+by/i.test(s.check ?? s.solution))
    errs.push(`${at}: ordered=true but solution has no ORDER BY`);
  return errs;
}
