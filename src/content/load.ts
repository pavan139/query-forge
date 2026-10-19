// Content access: the small course index is bundled; full modules are lazy-loaded chunks.
import { useEffect, useState } from 'react';
import indexJson from '../generated/index.json';
import datasetsJson from '../generated/datasets.json';
import type { ChallengeDef, CourseIndex, DatasetInfo, GlossaryEntry, LessonDef, ModuleDef, Step, TestItem } from './types.ts';

export const courseIndex = indexJson as unknown as CourseIndex;
export const datasets = datasetsJson as unknown as DatasetInfo[];

const moduleLoaders = import.meta.glob<ModuleDef>('../generated/modules/*.json', { import: 'default' });
const moduleCache = new Map<string, ModuleDef>();
const modulePromises = new Map<string, Promise<ModuleDef>>();

export function loadModule(id: string): Promise<ModuleDef> {
  const cached = moduleCache.get(id);
  if (cached) return Promise.resolve(cached);
  let p = modulePromises.get(id);
  if (!p) {
    const loader = moduleLoaders[`../generated/modules/${id}.json`];
    if (!loader) return Promise.reject(new Error(`Unknown module ${id}`));
    p = loader().then((m) => {
      moduleCache.set(id, m);
      return m;
    });
    modulePromises.set(id, p);
  }
  return p;
}

export function loadAllModules(): Promise<ModuleDef[]> {
  return Promise.all(courseIndex.modules.map((m) => loadModule(m.id)));
}

export function cachedModule(id: string): ModuleDef | undefined {
  return moduleCache.get(id);
}

export function useModule(id: string | undefined): ModuleDef | undefined {
  const [mod, setMod] = useState<ModuleDef | undefined>(() => (id ? moduleCache.get(id) : undefined));
  useEffect(() => {
    if (!id) return;
    let alive = true;
    const hit = moduleCache.get(id);
    if (hit) setMod(hit);
    else loadModule(id).then((m) => alive && setMod(m));
    return () => {
      alive = false;
    };
  }, [id]);
  return id && mod?.id === id ? mod : undefined;
}

export function useAllModules(): ModuleDef[] | undefined {
  const [mods, setMods] = useState<ModuleDef[] | undefined>(() => {
    const all = courseIndex.modules.map((m) => moduleCache.get(m.id));
    return all.every(Boolean) ? (all as ModuleDef[]) : undefined;
  });
  useEffect(() => {
    if (!mods) loadAllModules().then(setMods);
  }, [mods]);
  return mods;
}

let challengesPromise: Promise<ChallengeDef[]> | null = null;
export function loadChallenges(): Promise<ChallengeDef[]> {
  challengesPromise ??= import('../generated/challenges.json').then((m) => m.default as unknown as ChallengeDef[]);
  return challengesPromise;
}
export function useChallenges(): ChallengeDef[] | undefined {
  const [c, setC] = useState<ChallengeDef[]>();
  useEffect(() => {
    loadChallenges().then(setC);
  }, []);
  return c;
}

let glossaryPromise: Promise<GlossaryEntry[]> | null = null;
export function useGlossary(): GlossaryEntry[] | undefined {
  const [g, setG] = useState<GlossaryEntry[]>();
  useEffect(() => {
    glossaryPromise ??= import('../generated/glossary.json').then((m) => m.default as unknown as GlossaryEntry[]);
    glossaryPromise.then(setG);
  }, []);
  return g;
}

export const allLessonIds: string[] = courseIndex.modules.flatMap((m) => m.lessons.map((l) => l.id));

export function lessonLocation(lessonId: string) {
  for (const m of courseIndex.modules) {
    const i = m.lessons.findIndex((l) => l.id === lessonId);
    if (i !== -1) return { module: m, lesson: m.lessons[i], index: i };
  }
  return undefined;
}

export function moduleOfLesson(lessonId: string): string {
  return lessonId.split('-')[0];
}

export function nextLessonId(lessonId: string): string | undefined {
  const i = allLessonIds.indexOf(lessonId);
  return i >= 0 ? allLessonIds[i + 1] : undefined;
}

export function datasetInfo(id: string): DatasetInfo | undefined {
  return datasets.find((d) => d.id === id);
}

export function lessonDataset(mod: ModuleDef, lesson: LessonDef, step?: { dataset?: string }): string {
  return step?.dataset ?? lesson.dataset ?? mod.dataset;
}

export const GRADED_TYPES = new Set(['exercise', 'quiz', 'predict', 'fill', 'parsons']);
export function isGraded(s: Step): s is Extract<Step, { id: string }> {
  return GRADED_TYPES.has(s.type);
}

/** Find any graded item (lesson step, test item, project task) by id among loaded modules. */
export function findItem(mods: ModuleDef[], id: string):
  | { item: Step | TestItem; module: ModuleDef; lesson?: LessonDef; kind: 'lesson' | 'test' | 'project' }
  | undefined {
  for (const m of mods) {
    for (const l of m.lessons) {
      const s = l.steps.find((x) => 'id' in x && x.id === id);
      if (s) return { item: s, module: m, lesson: l, kind: 'lesson' };
    }
    const t = m.testPool.find((x) => x.id === id);
    if (t) return { item: t, module: m, lesson: m.lessons.find((l) => l.id === t.lesson), kind: 'test' };
    const p = m.project?.tasks.find((x) => x.id === id);
    if (p) return { item: p, module: m, kind: 'project' };
  }
  return undefined;
}
