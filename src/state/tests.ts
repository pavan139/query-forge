// Weekly / monthly / module / practice test scheduling and assembly.
import type { ModuleDef, Step, TestItem } from '../content/types.ts';
import { addDays, dayKey, daysBetween } from '../lib/dates.ts';
import type { AppData, TestAttempt, TestKind } from './store.ts';

export const WEEK_DAYS = 7;
export const MONTH_DAYS = 28;
export const SIZES: Record<TestKind, number> = { weekly: 15, monthly: 25, module: 12, practice: 10 };
const GRADED = new Set(['exercise', 'quiz', 'predict', 'fill', 'parsons']);

export interface SlotStatus {
  kind: 'weekly' | 'monthly';
  /** 1-based slot number (week 1, week 2…). 0 = first one not unlocked yet. */
  slot: number;
  unlockDay: string;
  nextUnlockDay: string;
  available: boolean;
  attempt?: TestAttempt;
  daysUntil: number;
}

export function slotStatus(kind: 'weekly' | 'monthly', startedAt: string, tests: TestAttempt[], today = dayKey()): SlotStatus {
  const period = kind === 'weekly' ? WEEK_DAYS : MONTH_DAYS;
  const elapsed = Math.max(0, daysBetween(startedAt, today));
  const slot = Math.floor(elapsed / period);
  const unlockDay = addDays(startedAt, slot * period);
  const nextUnlockDay = addDays(startedAt, (slot + 1) * period);
  const attempt = slot > 0 ? tests.find((t) => t.kind === kind && t.slot === slot) : undefined;
  return {
    kind,
    slot,
    unlockDay,
    nextUnlockDay,
    available: slot > 0 && !attempt,
    attempt,
    daysUntil: daysBetween(today, nextUnlockDay),
  };
}

export interface PoolItem {
  id: string;
  module: string;
  lesson: string;
  type: string;
  difficulty: number;
  fromTestPool: boolean;
}

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function poolFor(mods: ModuleDef[], lessonIds: Set<string>): { test: PoolItem[]; lesson: PoolItem[] } {
  const test: PoolItem[] = [];
  const lesson: PoolItem[] = [];
  for (const m of mods) {
    for (const t of m.testPool as TestItem[]) {
      if (lessonIds.has(t.lesson)) test.push({ id: t.id, module: m.id, lesson: t.lesson, type: t.type, difficulty: t.difficulty, fromTestPool: true });
    }
    for (const l of m.lessons) {
      if (!lessonIds.has(l.id)) continue;
      for (const s of l.steps as Step[]) {
        if (GRADED.has(s.type) && 'id' in s)
          lesson.push({ id: s.id, module: m.id, lesson: l.id, type: s.type, difficulty: (s as { difficulty?: number }).difficulty ?? 1, fromTestPool: false });
      }
    }
  }
  return { test, lesson };
}

/** Per-lesson accuracy in past tests (0..1). */
export function lessonAccuracy(tests: TestAttempt[]): Map<string, { correct: number; total: number }> {
  const m = new Map<string, { correct: number; total: number }>();
  for (const t of tests)
    for (const it of t.items) {
      const e = m.get(it.lesson) ?? { correct: 0, total: 0 };
      e.total++;
      if (it.correct) e.correct++;
      m.set(it.lesson, e);
    }
  return m;
}

/** Lessons sorted weakest first, combining test accuracy and review lapses. */
export function weakLessons(data: AppData, limit = 5): { lesson: string; score: number }[] {
  const acc = lessonAccuracy(data.tests);
  const lapses = new Map<string, number>();
  for (const c of Object.values(data.srs)) if (c.source === 'lesson') lapses.set(c.ref, (lapses.get(c.ref) ?? 0) + c.lapses);
  const lessons = Object.keys(data.lessons).filter((l) => data.lessons[l].completed);
  return lessons
    .map((l) => {
      const a = acc.get(l);
      const accuracy = a ? a.correct / a.total : 0.75;
      const score = accuracy - Math.min(0.4, (lapses.get(l) ?? 0) * 0.08);
      return { lesson: l, score, tested: !!a || (lapses.get(l) ?? 0) > 0 };
    })
    .filter((x) => x.tested && x.score < 0.8)
    .sort((a, b) => a.score - b.score)
    .slice(0, limit)
    .map(({ lesson, score }) => ({ lesson, score }));
}

function pickWeighted<T>(items: T[], n: number, weight: (t: T) => number, rnd: () => number, taken: Set<string>, key: (t: T) => string): T[] {
  const out: T[] = [];
  const pool = items.filter((t) => !taken.has(key(t)));
  while (out.length < n && pool.length) {
    const total = pool.reduce((s, t) => s + Math.max(0.01, weight(t)), 0);
    let r = rnd() * total;
    let idx = 0;
    for (; idx < pool.length - 1; idx++) {
      r -= Math.max(0.01, weight(pool[idx]));
      if (r <= 0) break;
    }
    const [chosen] = pool.splice(idx, 1);
    taken.add(key(chosen));
    out.push(chosen);
  }
  return out;
}

export interface BuildOptions {
  kind: TestKind;
  seed: string;
  moduleId?: string;
  moduleIds?: string[];
  size?: number;
  today?: string;
}

export function buildTest(mods: ModuleDef[], data: AppData, opts: BuildOptions): PoolItem[] {
  const rnd = mulberry32(hash(opts.seed));
  const size = opts.size ?? SIZES[opts.kind];
  const today = opts.today ?? dayKey();
  const completed = Object.entries(data.lessons)
    .filter(([, p]) => p.completed)
    .map(([id, p]) => ({ id, at: p.completed!.slice(0, 10) }));
  const seenInTests = new Map<string, number>();
  for (const t of data.tests) for (const it of t.items) seenInTests.set(it.id, (seenInTests.get(it.id) ?? 0) + 1);
  const acc = lessonAccuracy(data.tests);
  const weakness = (lesson: string) => {
    const a = acc.get(lesson);
    return a ? 1.4 - a.correct / a.total : 0.9;
  };
  const freshness = (id: string) => 1 / (1 + 2 * (seenInTests.get(id) ?? 0));
  const taken = new Set<string>();
  const key = (p: PoolItem) => p.id;
  let picked: PoolItem[] = [];

  if (opts.kind === 'module' || opts.kind === 'practice') {
    const moduleIds = new Set(opts.kind === 'module' ? [opts.moduleId!] : (opts.moduleIds ?? []));
    const lessonIds = new Set(mods.filter((m) => moduleIds.has(m.id)).flatMap((m) => m.lessons.map((l) => l.id)));
    const { test, lesson } = poolFor(mods, lessonIds);
    // Spread across lessons: round-robin by lesson.
    const byLesson = new Map<string, PoolItem[]>();
    for (const p of test) byLesson.set(p.lesson, [...(byLesson.get(p.lesson) ?? []), p]);
    const lessonsOrdered = [...byLesson.keys()];
    while (picked.length < size && lessonsOrdered.some((l) => (byLesson.get(l) ?? []).some((p) => !taken.has(p.id)))) {
      for (const l of lessonsOrdered) {
        if (picked.length >= size) break;
        picked.push(...pickWeighted(byLesson.get(l) ?? [], 1, (p) => freshness(p.id) * (0.6 + p.difficulty * 0.3), rnd, taken, key));
      }
    }
    if (picked.length < size) picked.push(...pickWeighted(lesson, size - picked.length, (p) => freshness(p.id), rnd, taken, key));
  } else if (opts.kind === 'weekly') {
    if (!completed.length) return [];
    const since = addDays(today, -WEEK_DAYS);
    let recent = completed.filter((c) => c.at >= since).map((c) => c.id);
    if (!recent.length) recent = completed.sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 3).map((c) => c.id);
    const recentSet = new Set(recent);
    const older = new Set(completed.map((c) => c.id).filter((id) => !recentSet.has(id)));
    const recentPool = poolFor(mods, recentSet);
    const olderPool = poolFor(mods, older);
    const nRecent = older.size ? Math.round(size * 0.6) : size;
    picked.push(...pickWeighted(recentPool.test, nRecent, (p) => freshness(p.id) * (0.7 + 0.2 * p.difficulty), rnd, taken, key));
    picked.push(...pickWeighted(olderPool.test, Math.round(size * 0.27), (p) => freshness(p.id) * weakness(p.lesson), rnd, taken, key));
    // Items she struggled with in lessons.
    const struggled = [...recentPool.lesson, ...olderPool.lesson].filter((p) => {
      const s = data.steps[p.id];
      const c = data.srs[p.id];
      return (s && (s.revealed || s.attempts > 2 || s.hints > 1)) || (c && c.lapses > 0);
    });
    picked.push(...pickWeighted(struggled, size - picked.length, () => 1, rnd, taken, key));
    const all = poolFor(mods, new Set(completed.map((c) => c.id)));
    if (picked.length < size) picked.push(...pickWeighted(all.test, size - picked.length, (p) => freshness(p.id), rnd, taken, key));
    if (picked.length < size) picked.push(...pickWeighted(all.lesson, size - picked.length, (p) => freshness(p.id), rnd, taken, key));
  } else {
    // monthly: everything learned so far, weighted towards weak lessons, harder items and items not tested recently.
    if (!completed.length) return [];
    const all = poolFor(mods, new Set(completed.map((c) => c.id)));
    const modulesCovered = [...new Set(all.test.map((p) => p.module))];
    // At least one item from each module learned.
    for (const m of modulesCovered) {
      if (picked.length >= size) break;
      picked.push(...pickWeighted(all.test.filter((p) => p.module === m), 1, (p) => weakness(p.lesson) * freshness(p.id), rnd, taken, key));
    }
    picked.push(
      ...pickWeighted(all.test, size - picked.length, (p) => weakness(p.lesson) * freshness(p.id) * (0.5 + 0.35 * p.difficulty), rnd, taken, key),
    );
    if (picked.length < size) picked.push(...pickWeighted(all.lesson, size - picked.length, (p) => freshness(p.id) * weakness(p.lesson), rnd, taken, key));
  }

  picked = picked.slice(0, size);
  // Order: easier first, mix types, keep module order loosely.
  return picked.sort((a, b) => a.difficulty - b.difficulty || a.module.localeCompare(b.module) || a.lesson.localeCompare(b.lesson));
}
