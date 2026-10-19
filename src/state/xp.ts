// XP, levels and titles.

export const XP = {
  read: 1,
  example: 2,
  exercise: 10,
  firstTryBonus: 5,
  quiz: 5,
  lessonComplete: 20,
  review: 3,
  projectTask: 15,
  projectComplete: 50,
  challenge: { easy: 15, medium: 25, hard: 40, expert: 60 } as Record<string, number>,
} as const;

/** Cumulative XP needed to reach a level (level 0 = 0 XP). */
export function xpForLevel(level: number): number {
  return 25 * level * (level + 3);
}

export function levelFromXp(xp: number): { level: number; into: number; needed: number; progress: number } {
  let level = 0;
  while (xpForLevel(level + 1) <= xp) level++;
  const base = xpForLevel(level);
  const next = xpForLevel(level + 1);
  return { level, into: xp - base, needed: next - base, progress: (xp - base) / (next - base) };
}

export const TITLES: { level: number; title: string; icon: string }[] = [
  { level: 0, title: 'SQL Seedling', icon: '🌱' },
  { level: 3, title: 'Query Curious', icon: '🔍' },
  { level: 5, title: 'Data Explorer', icon: '🧭' },
  { level: 8, title: 'Filter Finder', icon: '🧹' },
  { level: 10, title: 'Join Journeyer', icon: '🔗' },
  { level: 13, title: 'Aggregation Ace', icon: '📊' },
  { level: 16, title: 'Subquery Sleuth', icon: '🕵️' },
  { level: 19, title: 'Window Wizard', icon: '🪄' },
  { level: 22, title: 'Schema Architect', icon: '🏛️' },
  { level: 25, title: 'Performance Pro', icon: '⚡' },
  { level: 28, title: 'SQL Master', icon: '👑' },
  { level: 31, title: 'Advanced SQL Developer', icon: '🏆' },
];

export function titleFor(level: number) {
  let t = TITLES[0];
  for (const x of TITLES) if (level >= x.level) t = x;
  return t;
}
