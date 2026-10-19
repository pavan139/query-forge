// Spaced repetition (SM-2 flavoured). Pure functions so they are easy to test.
import { addDays, dayKey } from '../lib/dates.ts';

export type Grade = 'again' | 'hard' | 'good' | 'easy';

export interface SrsCard {
  id: string;
  /** Where the item lives: lesson step, challenge... */
  source: 'lesson' | 'challenge' | 'project';
  /** Lesson or challenge the item belongs to (for linking back). */
  ref: string;
  due: string;
  interval: number;
  ease: number;
  reps: number;
  lapses: number;
  last?: string;
}

export const MAX_INTERVAL = 180;

export function newCard(id: string, source: SrsCard['source'], ref: string, firstGrade: Grade, today = dayKey()): SrsCard {
  const card: SrsCard = { id, source, ref, due: today, interval: 0, ease: 2.5, reps: 0, lapses: 0 };
  return schedule(card, firstGrade, today);
}

export function schedule(card: SrsCard, grade: Grade, today = dayKey()): SrsCard {
  let { interval, ease, reps, lapses } = card;
  switch (grade) {
    case 'again':
      lapses += card.reps > 0 ? 1 : 0;
      reps = 0;
      interval = 1;
      ease = Math.max(1.3, ease - 0.2);
      break;
    case 'hard':
      interval = Math.max(1, Math.round(Math.max(interval, 1) * 1.2));
      ease = Math.max(1.3, ease - 0.15);
      reps += 1;
      break;
    case 'good':
      interval = reps === 0 ? 1 : reps === 1 ? 3 : Math.round(interval * ease);
      reps += 1;
      break;
    case 'easy':
      interval = reps === 0 ? 3 : Math.round(Math.max(interval, 1) * ease * 1.3);
      ease = Math.min(3.2, ease + 0.15);
      reps += 1;
      break;
  }
  interval = Math.min(MAX_INTERVAL, Math.max(1, interval));
  return { ...card, interval, ease: Math.round(ease * 100) / 100, reps, lapses, last: today, due: addDays(today, interval) };
}

/** Grade an auto-checked answer: first try & no hints = good, struggled = hard, failed = again. */
export function gradeFrom(correct: boolean, attempts: number, hintsUsed: number, revealed = false): Grade {
  if (!correct || revealed) return 'again';
  if (attempts <= 1 && hintsUsed === 0) return 'good';
  return 'hard';
}

export function dueCards(cards: Record<string, SrsCard>, today = dayKey()): SrsCard[] {
  return Object.values(cards)
    .filter((c) => c.due <= today)
    .sort((a, b) => (a.due === b.due ? b.lapses - a.lapses : a.due < b.due ? -1 : 1));
}

/** How well an item is known: 0 (new/forgotten) … 1 (long interval). */
export function strength(card: SrsCard): number {
  return Math.min(1, Math.log2(1 + card.interval) / Math.log2(1 + 60));
}
