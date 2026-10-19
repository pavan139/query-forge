import { describe, expect, it } from 'vitest';
import type { ModuleDef } from '../../src/content/types.ts';
import { initialData } from '../../src/state/store.ts';
import { buildTest, slotStatus } from '../../src/state/tests.ts';

function fakeModule(id: string, lessons: number, perLesson: number): ModuleDef {
  return {
    id,
    order: Number(id.slice(1)),
    title: id,
    subtitle: '',
    icon: '',
    level: 'beginner',
    description: 'x',
    dataset: 'cafe',
    lessons: Array.from({ length: lessons }, (_, i) => ({
      id: `${id}-l0${i + 1}`,
      title: 'L',
      summary: 's',
      minutes: 5,
      steps: [{ type: 'quiz', id: `${id}-l0${i + 1}-q1`, question: 'q', options: ['a', 'b'], answer: 0, explanation: 'e' }],
    })),
    testPool: Array.from({ length: lessons * perLesson }, (_, k) => ({
      type: 'quiz',
      id: `${id}-t${k}`,
      lesson: `${id}-l0${(k % lessons) + 1}`,
      difficulty: ((k % 3) + 1) as 1 | 2 | 3,
      question: 'q',
      options: ['a', 'b'],
      answer: 0,
      explanation: 'e',
    })),
  };
}

describe('test slots', () => {
  it('unlocks weekly tests every 7 days', () => {
    expect(slotStatus('weekly', '2025-01-01', [], '2025-01-05').available).toBe(false);
    const s = slotStatus('weekly', '2025-01-01', [], '2025-01-08');
    expect(s.slot).toBe(1);
    expect(s.available).toBe(true);
    const done = slotStatus('weekly', '2025-01-01', [{ kind: 'weekly', slot: 1 } as never], '2025-01-09');
    expect(done.available).toBe(false);
    expect(done.daysUntil).toBe(6);
  });
  it('unlocks monthly tests every 28 days', () => {
    expect(slotStatus('monthly', '2025-01-01', [], '2025-01-28').available).toBe(false);
    expect(slotStatus('monthly', '2025-01-01', [], '2025-01-29').available).toBe(true);
  });
});

describe('buildTest', () => {
  const mods = [fakeModule('m01', 3, 6), fakeModule('m02', 3, 6)];
  const data = initialData();
  data.lessons = {
    'm01-l01': { started: '2025-01-01', completed: '2025-01-01T10:00:00Z', step: 0, maxStep: 0 },
    'm01-l02': { started: '2025-01-01', completed: '2025-01-02T10:00:00Z', step: 0, maxStep: 0 },
    'm02-l01': { started: '2025-01-09', completed: '2025-01-09T10:00:00Z', step: 0, maxStep: 0 },
  };
  it('only uses completed lessons and mixes recent with older', () => {
    const items = buildTest(mods, data, { kind: 'weekly', seed: 'w1', today: '2025-01-10' });
    expect(items.length).toBe(15);
    const lessons = new Set(items.map((i) => i.lesson));
    for (const l of lessons) expect(data.lessons[l]?.completed).toBeTruthy();
    expect(items.some((i) => i.lesson === 'm02-l01')).toBe(true);
    expect(items.some((i) => i.lesson.startsWith('m01'))).toBe(true);
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
  });
  it('builds module tests from a single module', () => {
    const items = buildTest(mods, data, { kind: 'module', moduleId: 'm02', seed: 'x' });
    expect(items.length).toBe(12);
    expect(items.every((i) => i.module === 'm02')).toBe(true);
  });
  it('returns nothing when no lesson is completed', () => {
    expect(buildTest(mods, initialData(), { kind: 'monthly', seed: 'y' })).toEqual([]);
  });
});
