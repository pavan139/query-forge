import type { CourseIndex } from '../content/types.ts';
import type { AppState } from './store.ts';

export interface AchievementDef {
  id: string;
  title: string;
  description: string;
  icon: string;
  tier: 'bronze' | 'silver' | 'gold' | 'legend';
  check: (s: AppState, idx: CourseIndex) => boolean;
}

const lessonsDone = (s: AppState) => Object.values(s.lessons).filter((l) => l.completed).length;
const exercisesDone = (s: AppState) => Object.values(s.steps).filter((x) => x.done && x.kind === 'exercise' && !x.revealed).length;
const cleanSolves = (s: AppState) => Object.values(s.steps).filter((x) => x.done && x.kind === 'exercise' && x.firstTry).length;
const moduleDone = (s: AppState, idx: CourseIndex, id: string) => {
  const m = idx.modules.find((x) => x.id === id);
  return !!m && m.lessons.length > 0 && m.lessons.every((l) => s.lessons[l.id]?.completed);
};
const testsOf = (s: AppState, kind: string) => s.tests.filter((t) => t.kind === kind);
const challengesSolved = (s: AppState) => Object.values(s.challenges).filter((c) => c.solved).length;
const goalDays = (s: AppState) => Object.values(s.xpByDay).filter((x) => x >= s.profile.dailyGoal).length;
const allLessons = (idx: CourseIndex) => idx.modules.flatMap((m) => m.lessons.map((l) => l.id));

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: 'first-run', title: 'Hello, Database!', description: 'Run your very first query.', icon: '👋', tier: 'bronze', check: (s) => s.counters.runs >= 1 },
  { id: 'first-solve', title: 'First Solve', description: 'Solve your first exercise.', icon: '✅', tier: 'bronze', check: (s) => exercisesDone(s) >= 1 },
  { id: 'lesson-1', title: 'Lesson One', description: 'Complete your first lesson.', icon: '📗', tier: 'bronze', check: (s) => lessonsDone(s) >= 1 },
  { id: 'lessons-10', title: 'Getting Serious', description: 'Complete 10 lessons.', icon: '📚', tier: 'silver', check: (s) => lessonsDone(s) >= 10 },
  { id: 'lessons-50', title: 'Bookworm', description: 'Complete 50 lessons.', icon: '🐛', tier: 'gold', check: (s) => lessonsDone(s) >= 50 },
  { id: 'lessons-all', title: 'Graduate', description: 'Complete every lesson in the course.', icon: '🎓', tier: 'legend', check: (s, idx) => allLessons(idx).length > 0 && allLessons(idx).every((id) => s.lessons[id]?.completed) },
  { id: 'exercises-100', title: 'Century', description: 'Solve 100 exercises.', icon: '💯', tier: 'silver', check: (s) => exercisesDone(s) >= 100 },
  { id: 'exercises-500', title: 'Query Machine', description: 'Solve 500 exercises.', icon: '🤖', tier: 'gold', check: (s) => exercisesDone(s) >= 500 },
  { id: 'sharpshooter', title: 'Sharpshooter', description: 'Solve 10 exercises on the first try without hints.', icon: '🎯', tier: 'bronze', check: (s) => cleanSolves(s) >= 10 },
  { id: 'sniper', title: 'Eagle Eye', description: 'Solve 100 exercises on the first try without hints.', icon: '🦅', tier: 'gold', check: (s) => cleanSolves(s) >= 100 },
  { id: 'perfect-lesson', title: 'Flawless', description: 'Finish a lesson with every exercise right first time, no hints.', icon: '💎', tier: 'silver', check: (s) => s.counters.perfectLessons >= 1 },
  { id: 'm00', title: 'Welcome Aboard', description: 'Finish “Welcome to SQL”.', icon: '🚀', tier: 'bronze', check: (s, i) => moduleDone(s, i, 'm00') },
  { id: 'm02', title: 'Filter Pro', description: 'Finish the WHERE module.', icon: '🧹', tier: 'bronze', check: (s, i) => moduleDone(s, i, 'm02') },
  { id: 'm05', title: 'The Summarizer', description: 'Finish the Aggregation module.', icon: '📊', tier: 'silver', check: (s, i) => moduleDone(s, i, 'm05') },
  { id: 'm06', title: 'Join Master', description: 'Finish the JOINs module.', icon: '🔗', tier: 'silver', check: (s, i) => moduleDone(s, i, 'm06') },
  { id: 'm09', title: 'Recursion Ranger', description: 'Finish the CTEs module.', icon: '🌀', tier: 'silver', check: (s, i) => moduleDone(s, i, 'm09') },
  { id: 'm10', title: 'Window Wizard', description: 'Finish Window Functions I.', icon: '🪄', tier: 'gold', check: (s, i) => moduleDone(s, i, 'm10') },
  { id: 'm13', title: 'Architect', description: 'Finish the database design module.', icon: '🏛️', tier: 'gold', check: (s, i) => moduleDone(s, i, 'm13') },
  { id: 'm15', title: 'Speed Demon', description: 'Finish the performance module.', icon: '⚡', tier: 'gold', check: (s, i) => moduleDone(s, i, 'm15') },
  { id: 'm19', title: 'Analytics Ace', description: 'Finish the analytics patterns module.', icon: '📈', tier: 'legend', check: (s, i) => moduleDone(s, i, 'm19') },
  { id: 'streak-3', title: 'On a Roll', description: 'Study 3 days in a row.', icon: '🔥', tier: 'bronze', check: (s) => s.streak.best >= 3 },
  { id: 'streak-7', title: 'One Week Wonder', description: 'Study 7 days in a row.', icon: '📅', tier: 'silver', check: (s) => s.streak.best >= 7 },
  { id: 'streak-30', title: 'Habit Formed', description: 'Study 30 days in a row.', icon: '🗓️', tier: 'gold', check: (s) => s.streak.best >= 30 },
  { id: 'streak-100', title: 'Unstoppable', description: 'Study 100 days in a row.', icon: '☄️', tier: 'legend', check: (s) => s.streak.best >= 100 },
  { id: 'goal-7', title: 'Goal Getter', description: 'Hit your daily XP goal on 7 days.', icon: '🥅', tier: 'silver', check: (s) => goalDays(s) >= 7 },
  { id: 'xp-1000', title: 'Thousandaire', description: 'Earn 1,000 XP.', icon: '⭐', tier: 'bronze', check: (s) => s.totalXp >= 1000 },
  { id: 'xp-5000', title: 'Star Collector', description: 'Earn 5,000 XP.', icon: '🌟', tier: 'silver', check: (s) => s.totalXp >= 5000 },
  { id: 'xp-20000', title: 'Supernova', description: 'Earn 20,000 XP.', icon: '💫', tier: 'legend', check: (s) => s.totalXp >= 20000 },
  { id: 'reviews-50', title: 'Memory Keeper', description: 'Complete 50 review cards.', icon: '🧠', tier: 'silver', check: (s) => s.counters.reviews >= 50 },
  { id: 'reviews-500', title: 'Elephant Memory', description: 'Complete 500 review cards.', icon: '🐘', tier: 'gold', check: (s) => s.counters.reviews >= 500 },
  { id: 'weekly-1', title: 'Test Taker', description: 'Complete your first weekly test.', icon: '📝', tier: 'bronze', check: (s) => testsOf(s, 'weekly').length >= 1 },
  { id: 'weekly-ace', title: 'Weekly Ace', description: 'Score 90% or more on a weekly test.', icon: '🅰️', tier: 'silver', check: (s) => testsOf(s, 'weekly').some((t) => t.score >= 90) },
  { id: 'weekly-8', title: 'Two Months Strong', description: 'Complete 8 weekly tests.', icon: '🏅', tier: 'gold', check: (s) => testsOf(s, 'weekly').length >= 8 },
  { id: 'monthly-1', title: 'Big Exam Energy', description: 'Complete your first monthly test.', icon: '🗂️', tier: 'silver', check: (s) => testsOf(s, 'monthly').length >= 1 },
  { id: 'monthly-ace', title: 'Monthly Champion', description: 'Score 90% or more on a monthly test.', icon: '🏆', tier: 'gold', check: (s) => testsOf(s, 'monthly').some((t) => t.score >= 90) },
  { id: 'mastery-5', title: 'Mastery Five', description: 'Pass 5 module mastery tests.', icon: '👑', tier: 'gold', check: (s) => new Set(testsOf(s, 'module').filter((t) => t.score >= 70).map((t) => t.moduleId)).size >= 5 },
  { id: 'challenges-10', title: 'Challenger', description: 'Solve 10 practice challenges.', icon: '🧩', tier: 'bronze', check: (s) => challengesSolved(s) >= 10 },
  { id: 'challenges-50', title: 'Puzzle Hunter', description: 'Solve 50 practice challenges.', icon: '🗝️', tier: 'silver', check: (s) => challengesSolved(s) >= 50 },
  { id: 'challenges-150', title: 'Problem Crusher', description: 'Solve 150 practice challenges.', icon: '🦾', tier: 'legend', check: (s) => challengesSolved(s) >= 150 },
  { id: 'expert-1', title: 'Into the Deep End', description: 'Solve an expert-level challenge.', icon: '🌊', tier: 'gold', check: (s) => Object.values(s.challenges).some((c) => c.solved && c.difficulty === 'expert') },
  { id: 'project-1', title: 'Real-World Ready', description: 'Complete your first project.', icon: '💼', tier: 'silver', check: (s) => Object.values(s.projects).some((p) => p.completed) },
  { id: 'project-5', title: 'Portfolio Builder', description: 'Complete 5 projects.', icon: '🗃️', tier: 'gold', check: (s) => Object.values(s.projects).filter((p) => p.completed).length >= 5 },
  { id: 'bug-squasher', title: 'Bug Squasher', description: 'Fix 25 errors and get the query working.', icon: '🐞', tier: 'silver', check: (s) => s.counters.fixes >= 25 },
  { id: 'night-owl', title: 'Night Owl', description: 'Study after 10 pm.', icon: '🦉', tier: 'bronze', check: (s) => s.counters.nightOwl },
  { id: 'early-bird', title: 'Early Bird', description: 'Study before 7 am.', icon: '🐦', tier: 'bronze', check: (s) => s.counters.earlyBird },
  { id: 'playground-25', title: 'Tinkerer', description: 'Run 25 queries in the Playground.', icon: '🛠️', tier: 'bronze', check: (s) => s.counters.playgroundRuns >= 25 },
  { id: 'explorer', title: 'Data Explorer', description: 'Open every dataset in the Dataset explorer.', icon: '🗺️', tier: 'bronze', check: (s) => s.counters.datasetsViewed.length >= 8 },
  { id: 'notes-5', title: 'Note Taker', description: 'Write notes on 5 lessons.', icon: '✍️', tier: 'bronze', check: (s) => Object.values(s.notes).filter((n) => n.trim().length > 0).length >= 5 },
  { id: 'backup', title: 'Safety First', description: 'Download a backup of your progress.', icon: '💾', tier: 'bronze', check: (s) => !!s.lastBackupAt },
];

export function newlyUnlocked(s: AppState, idx: CourseIndex): AchievementDef[] {
  return ACHIEVEMENTS.filter((a) => !s.achievements[a.id] && a.check(s, idx));
}
