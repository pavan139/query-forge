// All learner progress. Persisted to localStorage; exportable as a backup file.
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { courseIndex } from '../content/load.ts';
import { dayKey, addDays } from '../lib/dates.ts';
import { emit } from '../lib/events.ts';
import { newlyUnlocked } from './achievements.ts';
import { gradeFrom, newCard, schedule, type Grade, type SrsCard } from './srs.ts';
import { levelFromXp, titleFor, XP } from './xp.ts';

export type Theme = 'light' | 'dark' | 'system';
export type StepKind = 'exercise' | 'quiz' | 'predict' | 'fill' | 'parsons' | 'read' | 'example' | 'viz' | 'stepper';

export interface Profile {
  name: string;
  startedAt: string;
  dailyGoal: number;
  theme: Theme;
  sound: boolean;
  editorFont: number;
  onboarded: boolean;
  /** Minutes per day she wants to study (used for gentle nudges). */
  minutesGoal: number;
}

export interface StepProgress {
  kind: StepKind;
  done: boolean;
  attempts: number;
  hints: number;
  firstTry: boolean;
  revealed?: boolean;
  at?: string;
}

export interface LessonProgress {
  started: string;
  completed?: string;
  step: number;
  /** Highest step index reached. */
  maxStep: number;
}

export interface TestItemResult {
  id: string;
  module: string;
  lesson: string;
  type: string;
  correct: boolean;
  response?: string;
}

export type TestKind = 'weekly' | 'monthly' | 'module' | 'practice';

export interface TestAttempt {
  id: string;
  kind: TestKind;
  slot?: number;
  moduleId?: string;
  title: string;
  startedAt: string;
  finishedAt: string;
  total: number;
  correct: number;
  score: number;
  xp: number;
  items: TestItemResult[];
}

export interface ActiveTest {
  id: string;
  kind: TestKind;
  slot?: number;
  moduleId?: string;
  title: string;
  items: { id: string; module: string; lesson: string; type: string }[];
  answers: Record<string, { correct: boolean; response?: string }>;
  index: number;
  startedAt: string;
}

export interface ChallengeProgress {
  solved: boolean;
  attempts: number;
  difficulty: string;
  at?: string;
  sql?: string;
  hints?: number;
}

export interface Snippet {
  id: string;
  title: string;
  sql: string;
  dataset: string;
  at: string;
}

export interface Counters {
  runs: number;
  errors: number;
  fixes: number;
  reviews: number;
  perfectLessons: number;
  playgroundRuns: number;
  nightOwl: boolean;
  earlyBird: boolean;
  datasetsViewed: string[];
}

export interface Streak {
  current: number;
  best: number;
  last: string | null;
  freezes: number;
}

export interface AppData {
  profile: Profile;
  lessons: Record<string, LessonProgress>;
  steps: Record<string, StepProgress>;
  drafts: Record<string, string>;
  srs: Record<string, SrsCard>;
  xpByDay: Record<string, number>;
  minutesByDay: Record<string, number>;
  reviewsByDay: Record<string, number>;
  totalXp: number;
  streak: Streak;
  tests: TestAttempt[];
  activeTest: ActiveTest | null;
  challenges: Record<string, ChallengeProgress>;
  projects: Record<string, { tasks: Record<string, boolean>; completed?: string }>;
  achievements: Record<string, string>;
  snippets: Snippet[];
  notes: Record<string, string>;
  bookmarks: string[];
  counters: Counters;
  lastBackupAt: string | null;
}

export interface AppActions {
  setProfile: (p: Partial<Profile>) => void;
  addXp: (amount: number, reason?: string) => void;
  /** Record a finished lesson/project step. Returns XP awarded. */
  completeStep: (a: {
    id: string;
    kind: StepKind;
    ref: string;
    attempts: number;
    hints: number;
    revealed?: boolean;
    source?: SrsCard['source'];
    xp?: number;
  }) => number;
  setDraft: (id: string, sql: string) => void;
  setLessonStep: (lessonId: string, step: number) => void;
  completeLesson: (lessonId: string, perfect: boolean) => void;
  review: (id: string, grade: Grade) => void;
  addCard: (id: string, source: SrsCard['source'], ref: string, grade: Grade) => void;
  startTest: (t: Omit<ActiveTest, 'answers' | 'index' | 'startedAt'>) => void;
  answerTest: (itemId: string, correct: boolean, response?: string) => void;
  setTestIndex: (i: number) => void;
  finishTest: () => TestAttempt | null;
  abandonTest: () => void;
  solveChallenge: (id: string, difficulty: string, sql: string, attempts: number, hints: number) => void;
  attemptChallenge: (id: string, difficulty: string) => void;
  completeProjectTask: (projectId: string, taskId: string, totalTasks: number) => void;
  countRun: (opts: { error: boolean; fixed?: boolean; playground?: boolean }) => void;
  tickMinute: () => void;
  viewDataset: (id: string) => void;
  saveSnippet: (s: Omit<Snippet, 'id' | 'at'>) => void;
  deleteSnippet: (id: string) => void;
  setNote: (lessonId: string, text: string) => void;
  toggleBookmark: (lessonId: string) => void;
  markBackup: () => void;
  importData: (d: AppData) => void;
  resetAll: () => void;
  checkAchievements: () => void;
}

export type AppState = AppData & AppActions;

export function initialData(): AppData {
  return {
    profile: {
      name: '',
      startedAt: dayKey(),
      dailyGoal: 50,
      theme: 'system',
      sound: true,
      editorFont: 14,
      onboarded: false,
      minutesGoal: 20,
    },
    lessons: {},
    steps: {},
    drafts: {},
    srs: {},
    xpByDay: {},
    minutesByDay: {},
    reviewsByDay: {},
    totalXp: 0,
    streak: { current: 0, best: 0, last: null, freezes: 0 },
    tests: [],
    activeTest: null,
    challenges: {},
    projects: {},
    achievements: {},
    snippets: [],
    notes: {},
    bookmarks: [],
    counters: {
      runs: 0,
      errors: 0,
      fixes: 0,
      reviews: 0,
      perfectLessons: 0,
      playgroundRuns: 0,
      nightOwl: false,
      earlyBird: false,
      datasetsViewed: [],
    },
    lastBackupAt: null,
  };
}

const GRADED = new Set<StepKind>(['exercise', 'quiz', 'predict', 'fill', 'parsons']);

function nextStreak(s: Streak, today: string): Streak {
  if (s.last === today) return s;
  let current = 1;
  let freezes = s.freezes;
  if (s.last === addDays(today, -1)) current = s.current + 1;
  else if (s.last === addDays(today, -2) && freezes > 0) {
    // A streak freeze covers one missed day.
    current = s.current + 1;
    freezes -= 1;
  }
  if (current > 0 && current % 7 === 0) freezes = Math.min(2, freezes + 1);
  return { current, best: Math.max(s.best, current), last: today, freezes };
}

function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

/** localStorage that never throws (private mode / quota) so the app keeps working. */
const safeStorage: Storage = {
  get length() {
    try {
      return localStorage.length;
    } catch {
      return 0;
    }
  },
  clear: () => {
    try {
      localStorage.clear();
    } catch {
      /* ignore */
    }
  },
  key: (i) => {
    try {
      return localStorage.key(i);
    } catch {
      return null;
    }
  },
  getItem: (k) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  setItem: (k, v) => {
    try {
      localStorage.setItem(k, v);
    } catch (e) {
      console.warn('Could not save progress', e);
    }
  },
  removeItem: (k) => {
    try {
      localStorage.removeItem(k);
    } catch {
      /* ignore */
    }
  },
};

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      ...initialData(),

      setProfile: (p) => set((s) => ({ profile: { ...s.profile, ...p } })),

      addXp: (amount, reason) => {
        if (amount <= 0) return;
        const today = dayKey();
        const before = levelFromXp(get().totalXp).level;
        const h = new Date().getHours();
        set((s) => ({
          totalXp: s.totalXp + amount,
          xpByDay: { ...s.xpByDay, [today]: (s.xpByDay[today] ?? 0) + amount },
          streak: nextStreak(s.streak, today),
          counters: { ...s.counters, nightOwl: s.counters.nightOwl || h >= 22, earlyBird: s.counters.earlyBird || (h >= 4 && h < 7) },
        }));
        emit({ type: 'xp', amount, reason });
        const after = levelFromXp(get().totalXp).level;
        if (after > before) {
          const t = titleFor(after);
          emit({ type: 'level', level: after, title: t.title, icon: t.icon });
        }
        get().checkAchievements();
      },

      completeStep: ({ id, kind, ref, attempts, hints, revealed, source = 'lesson', xp }) => {
        const prev = get().steps[id];
        if (prev?.done && !prev.revealed) return 0;
        const firstTry = attempts <= 1 && hints === 0 && !revealed;
        let award = 0;
        if (!prev?.done) {
          if (revealed) award = kind === 'exercise' ? 2 : 1;
          else if (xp !== undefined) award = xp;
          else if (kind === 'exercise') award = XP.exercise + (firstTry ? XP.firstTryBonus : 0);
          else if (GRADED.has(kind)) award = XP.quiz;
          else if (kind === 'example' || kind === 'stepper' || kind === 'viz') award = XP.example;
          else award = XP.read;
        } else if (prev.revealed && !revealed) {
          // Solved properly after peeking earlier.
          award = kind === 'exercise' ? 5 : 2;
        }
        set((s) => {
          const steps = {
            ...s.steps,
            [id]: { kind, done: true, attempts: (prev?.attempts ?? 0) + attempts, hints: (prev?.hints ?? 0) + hints, firstTry: prev?.done ? prev.firstTry : firstTry, revealed: revealed && !(prev?.done && !prev.revealed) ? true : undefined, at: new Date().toISOString() },
          };
          let srs = s.srs;
          if (GRADED.has(kind) && !srs[id]) {
            srs = { ...srs, [id]: newCard(id, source, ref, gradeFrom(true, attempts, hints, revealed)) };
          }
          return { steps, srs };
        });
        if (award) get().addXp(award);
        return award;
      },

      setDraft: (id, sql) => set((s) => ({ drafts: { ...s.drafts, [id]: sql } })),

      setLessonStep: (lessonId, step) =>
        set((s) => {
          const prev = s.lessons[lessonId];
          return {
            lessons: {
              ...s.lessons,
              [lessonId]: { started: prev?.started ?? new Date().toISOString(), completed: prev?.completed, step, maxStep: Math.max(prev?.maxStep ?? 0, step) },
            },
          };
        }),

      completeLesson: (lessonId, perfect) => {
        const prev = get().lessons[lessonId];
        if (prev?.completed) return;
        set((s) => ({
          lessons: {
            ...s.lessons,
            [lessonId]: { started: prev?.started ?? new Date().toISOString(), completed: new Date().toISOString(), step: prev?.step ?? 0, maxStep: prev?.maxStep ?? 0 },
          },
          counters: perfect ? { ...s.counters, perfectLessons: s.counters.perfectLessons + 1 } : s.counters,
        }));
        get().addXp(XP.lessonComplete, 'Lesson complete');
        emit({ type: 'confetti' });
      },

      review: (id, grade) => {
        const card = get().srs[id];
        if (!card) return;
        const today = dayKey();
        set((s) => ({
          srs: { ...s.srs, [id]: schedule(card, grade) },
          counters: { ...s.counters, reviews: s.counters.reviews + 1 },
          reviewsByDay: { ...s.reviewsByDay, [today]: (s.reviewsByDay[today] ?? 0) + 1 },
        }));
        get().addXp(grade === 'again' ? 1 : XP.review);
      },

      addCard: (id, source, ref, grade) =>
        set((s) => {
          const existing = s.srs[id];
          return { srs: { ...s.srs, [id]: existing ? schedule(existing, grade) : newCard(id, source, ref, grade) } };
        }),

      startTest: (t) => set({ activeTest: { ...t, answers: {}, index: 0, startedAt: new Date().toISOString() } }),

      answerTest: (itemId, correct, response) =>
        set((s) => (s.activeTest ? { activeTest: { ...s.activeTest, answers: { ...s.activeTest.answers, [itemId]: { correct, response } } } } : {})),

      setTestIndex: (i) => set((s) => (s.activeTest ? { activeTest: { ...s.activeTest, index: i } } : {})),

      finishTest: () => {
        const t = get().activeTest;
        if (!t) return null;
        const items: TestItemResult[] = t.items.map((it) => ({
          ...it,
          correct: !!t.answers[it.id]?.correct,
          response: t.answers[it.id]?.response?.slice(0, 2000),
        }));
        const correct = items.filter((i) => i.correct).length;
        const score = items.length ? Math.round((correct / items.length) * 100) : 0;
        const bonus = score >= 90 ? 40 : score >= 70 ? 20 : 0;
        const kindBonus = t.kind === 'monthly' ? 2 : t.kind === 'weekly' ? 1.5 : 1;
        const xp = Math.round((correct * 6 + bonus) * kindBonus);
        const attempt: TestAttempt = {
          id: t.id,
          kind: t.kind,
          slot: t.slot,
          moduleId: t.moduleId,
          title: t.title,
          startedAt: t.startedAt,
          finishedAt: new Date().toISOString(),
          total: items.length,
          correct,
          score,
          xp,
          items,
        };
        // Missed items come back in daily review tomorrow; correct ones are reinforced.
        set((s) => {
          const srs = { ...s.srs };
          for (const it of items) {
            const existing = srs[it.id];
            if (!it.correct) srs[it.id] = existing ? schedule(existing, 'again') : newCard(it.id, 'lesson', it.lesson, 'again');
            else if (existing) srs[it.id] = schedule(existing, 'good');
          }
          return { tests: [...s.tests, attempt], activeTest: null, srs };
        });
        get().addXp(xp, `${t.title} finished`);
        if (score >= 70) emit({ type: 'confetti' });
        return attempt;
      },

      abandonTest: () => set({ activeTest: null }),

      attemptChallenge: (id, difficulty) =>
        set((s) => {
          const p = s.challenges[id];
          return { challenges: { ...s.challenges, [id]: { solved: p?.solved ?? false, attempts: (p?.attempts ?? 0) + 1, difficulty, at: p?.at, sql: p?.sql, hints: p?.hints } } };
        }),

      solveChallenge: (id, difficulty, sql, attempts, hints) => {
        const prev = get().challenges[id];
        set((s) => ({
          challenges: { ...s.challenges, [id]: { solved: true, attempts: Math.max(attempts, prev?.attempts ?? 0), difficulty, at: prev?.at ?? new Date().toISOString(), sql, hints } },
        }));
        if (!prev?.solved) {
          const base = XP.challenge[difficulty] ?? 20;
          get().addXp(hints > 0 ? Math.round(base * 0.7) : base, 'Challenge solved');
          if (!get().srs[id]) get().addCard(id, 'challenge', id, gradeFrom(true, attempts, hints));
        }
      },

      completeProjectTask: (projectId, taskId, totalTasks) => {
        const prev = get().projects[projectId];
        if (prev?.tasks[taskId]) return;
        const tasks = { ...(prev?.tasks ?? {}), [taskId]: true };
        const done = Object.keys(tasks).length >= totalTasks;
        set((s) => ({ projects: { ...s.projects, [projectId]: { tasks, completed: done ? new Date().toISOString() : prev?.completed } } }));
        get().addXp(XP.projectTask);
        if (done && !prev?.completed) {
          get().addXp(XP.projectComplete, 'Project complete');
          emit({ type: 'confetti' });
        }
      },

      countRun: ({ error, fixed, playground }) => {
        set((s) => ({
          counters: {
            ...s.counters,
            runs: s.counters.runs + 1,
            errors: s.counters.errors + (error ? 1 : 0),
            fixes: s.counters.fixes + (fixed ? 1 : 0),
            playgroundRuns: s.counters.playgroundRuns + (playground ? 1 : 0),
          },
        }));
        get().checkAchievements();
      },

      tickMinute: () => {
        const today = dayKey();
        set((s) => ({ minutesByDay: { ...s.minutesByDay, [today]: (s.minutesByDay[today] ?? 0) + 1 } }));
      },

      viewDataset: (id) =>
        set((s) =>
          s.counters.datasetsViewed.includes(id) ? {} : { counters: { ...s.counters, datasetsViewed: [...s.counters.datasetsViewed, id] } },
        ),

      saveSnippet: (sn) => set((s) => ({ snippets: [{ ...sn, id: uid(), at: new Date().toISOString() }, ...s.snippets].slice(0, 200) })),
      deleteSnippet: (id) => set((s) => ({ snippets: s.snippets.filter((x) => x.id !== id) })),
      setNote: (lessonId, text) => set((s) => ({ notes: { ...s.notes, [lessonId]: text } })),
      toggleBookmark: (lessonId) =>
        set((s) => ({ bookmarks: s.bookmarks.includes(lessonId) ? s.bookmarks.filter((b) => b !== lessonId) : [...s.bookmarks, lessonId] })),
      markBackup: () => {
        set({ lastBackupAt: new Date().toISOString() });
        get().checkAchievements();
      },
      importData: (d) => set({ ...initialData(), ...d, profile: { ...initialData().profile, ...d.profile } }),
      resetAll: () => set(initialData()),

      checkAchievements: () => {
        const unlocked = newlyUnlocked(get(), courseIndex);
        if (!unlocked.length) return;
        const at = new Date().toISOString();
        set((s) => ({ achievements: { ...s.achievements, ...Object.fromEntries(unlocked.map((a) => [a.id, at])) } }));
        for (const a of unlocked) emit({ type: 'achievement', id: a.id, title: a.title, icon: a.icon, description: a.description });
      },
    }),
    {
      name: 'sqlquest-v1',
      version: 1,
      storage: createJSONStorage(() => safeStorage),
      partialize: (s) => pickData(s),
    },
  ),
);

export function pickData(s: AppData): AppData {
  const d = initialData();
  const out = {} as Record<string, unknown>;
  for (const k of Object.keys(d)) out[k] = (s as unknown as Record<string, unknown>)[k];
  return out as unknown as AppData;
}

// ---------- backup ----------
export const BACKUP_APP = 'sql-quest';

export function exportBackup(): string {
  return JSON.stringify({ app: BACKUP_APP, version: 1, exportedAt: new Date().toISOString(), data: pickData(useStore.getState()) }, null, 1);
}

export function parseBackup(text: string): AppData {
  const obj = JSON.parse(text);
  if (!obj || obj.app !== BACKUP_APP || !obj.data || typeof obj.data !== 'object') throw new Error('This file is not a SQL Quest backup.');
  const d = obj.data as AppData;
  if (!d.profile || typeof d.totalXp !== 'number') throw new Error('The backup file looks damaged.');
  return d;
}
