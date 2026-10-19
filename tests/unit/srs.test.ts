import { describe, expect, it } from 'vitest';
import { dueCards, gradeFrom, newCard, schedule } from '../../src/state/srs.ts';
import { levelFromXp, xpForLevel } from '../../src/state/xp.ts';

describe('spaced repetition', () => {
  it('grows intervals with good answers and resets on again', () => {
    let c = newCard('x', 'lesson', 'l', 'good', '2025-01-01');
    expect(c.due).toBe('2025-01-02');
    c = schedule(c, 'good', '2025-01-02');
    expect(c.interval).toBe(3);
    c = schedule(c, 'good', '2025-01-05');
    expect(c.interval).toBeGreaterThan(5);
    const lapsed = schedule(c, 'again', '2025-01-20');
    expect(lapsed.interval).toBe(1);
    expect(lapsed.lapses).toBe(1);
    expect(lapsed.ease).toBeLessThan(c.ease);
  });
  it('grades auto-checked answers', () => {
    expect(gradeFrom(true, 1, 0)).toBe('good');
    expect(gradeFrom(true, 3, 0)).toBe('hard');
    expect(gradeFrom(true, 1, 2)).toBe('hard');
    expect(gradeFrom(true, 1, 0, true)).toBe('again');
    expect(gradeFrom(false, 1, 0)).toBe('again');
  });
  it('lists due cards oldest first', () => {
    const a = { ...newCard('a', 'lesson', 'l', 'good', '2025-01-01'), due: '2025-01-03' };
    const b = { ...newCard('b', 'lesson', 'l', 'good', '2025-01-01'), due: '2025-01-02' };
    const c = { ...newCard('c', 'lesson', 'l', 'good', '2025-01-01'), due: '2025-02-01' };
    expect(dueCards({ a, b, c }, '2025-01-05').map((x) => x.id)).toEqual(['b', 'a']);
  });
});

describe('levels', () => {
  it('is monotonic and consistent', () => {
    for (let l = 0; l < 40; l++) expect(xpForLevel(l + 1)).toBeGreaterThan(xpForLevel(l));
    expect(levelFromXp(0).level).toBe(0);
    expect(levelFromXp(xpForLevel(5)).level).toBe(5);
    expect(levelFromXp(xpForLevel(5) - 1).level).toBe(4);
  });
});
