import { ArrowRight, Brain, CalendarClock, CheckCircle2, Circle, ClipboardCheck, Flame, Puzzle, Save, Sparkles, Target, Trophy } from 'lucide-react';
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ActivityHeatmap, XpBars } from '../components/charts/Charts.tsx';
import { Page, ProgressRing } from '../components/ui.tsx';
import { allLessonIds, courseIndex, lessonLocation, useChallenges } from '../content/load.ts';
import { daysBetween, greeting } from '../lib/dates.ts';
import { useDueCount, useTestBadges, useToday } from '../lib/hooks.ts';
import { ACHIEVEMENTS } from '../state/achievements.ts';
import { useStore } from '../state/store.ts';
import { weakLessons } from '../state/tests.ts';
import { levelFromXp, titleFor } from '../state/xp.ts';

export function useNextLesson(): string | undefined {
  const lessons = useStore((s) => s.lessons);
  return useMemo(() => {
    const inProgress = allLessonIds.find((id) => lessons[id] && !lessons[id].completed);
    return inProgress ?? allLessonIds.find((id) => !lessons[id]?.completed);
  }, [lessons]);
}

function hashDay(s: string): number {
  let h = 0;
  for (const c of s) h = (h * 33 + c.charCodeAt(0)) >>> 0;
  return h;
}

export function Home() {
  const s = useStore();
  const today = useToday();
  const due = useDueCount();
  const tests = useTestBadges();
  const next = useNextLesson();
  const loc = next ? lessonLocation(next) : undefined;
  const challenges = useChallenges();
  const xpToday = s.xpByDay[today] ?? 0;
  const lv = levelFromXp(s.totalXp);
  const title = titleFor(lv.level);
  const completedLessons = Object.values(s.lessons).filter((l) => l.completed).length;
  const totalLessons = allLessonIds.length;
  const solved = Object.values(s.steps).filter((x) => x.done && x.kind === 'exercise').length;
  const weak = weakLessons(s, 4);
  const anyLesson = completedLessons > 0;

  const highestModule = useMemo(() => {
    let best = 'm00';
    for (const id of Object.keys(s.lessons)) if (s.lessons[id].completed && id.slice(0, 3) > best) best = id.slice(0, 3);
    return best;
  }, [s.lessons]);
  const dailyChallenge = useMemo(() => {
    if (!challenges?.length) return undefined;
    const open = challenges.filter((c) => c.module <= highestModule);
    const pool = open.filter((c) => !s.challenges[c.id]?.solved);
    const list = pool.length ? pool : open;
    return list.length ? list[hashDay(today) % list.length] : undefined;
  }, [challenges, highestModule, s.challenges, today]);

  const recentBadges = Object.entries(s.achievements)
    .sort((a, b) => (a[1] < b[1] ? 1 : -1))
    .slice(0, 4)
    .map(([id]) => ACHIEVEMENTS.find((a) => a.id === id))
    .filter(Boolean);
  const needBackup = completedLessons >= 3 && (!s.lastBackupAt || daysBetween(s.lastBackupAt.slice(0, 10), today) > 14);
  const lessonIndex = next ? allLessonIds.indexOf(next) : totalLessons;

  const plan = [
    {
      done: !!Object.values(s.lessons).some((l) => l.completed?.slice(0, 10) === today),
      label: loc ? `Lesson: ${loc.lesson.title}` : 'All lessons complete!',
      to: next ? `/lesson/${next}` : '/learn',
      icon: Sparkles,
    },
    { done: due === 0 && (s.reviewsByDay[today] ?? 0) > 0, label: due ? `Daily review — ${due} card${due === 1 ? '' : 's'} due` : 'Daily review — all caught up', to: '/review', icon: Brain, hidden: due === 0 && !(s.reviewsByDay[today] ?? 0) },
    ...(tests.ready ? [{ done: false, label: tests.monthly.available ? `Monthly test #${tests.monthly.slot} is ready` : `Weekly test #${tests.weekly.slot} is ready`, to: '/tests', icon: ClipboardCheck }] : []),
    ...(dailyChallenge ? [{ done: !!s.challenges[dailyChallenge.id]?.solved, label: `Daily challenge: ${dailyChallenge.title}`, to: `/practice/${dailyChallenge.id}`, icon: Puzzle }] : []),
  ].filter((p) => !('hidden' in p && p.hidden));

  return (
    <Page wide>
      {/* Hero */}
      <section className="card hero-soft relative overflow-hidden p-5 sm:p-8">
        <div className="relative flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <div className="text-[13px] font-medium text-muted">
              {greeting()}, {s.profile.name || 'friend'}
            </div>
            <h1 className="mt-1 text-[24px] leading-tight font-bold tracking-tight sm:text-[34px]">
              {completedLessons === 0 ? 'Your SQL journey starts today.' : xpToday >= s.profile.dailyGoal ? 'Daily goal reached. Nice work.' : 'Ready for today’s lesson?'}
            </h1>
            <p className="mt-1.5 max-w-xl text-[14px] text-muted sm:text-[15px]">
              {title.icon} Level {lv.level} · {title.title} · {completedLessons} of {totalLessons} lessons done
            </p>
            {loc && (
              <Link to={`/lesson/${next}`} className="btn btn-primary btn-lg mt-4 w-full sm:mt-5 sm:w-auto">
                <span className="truncate">
                  {s.lessons[next!] ? 'Continue' : 'Start'}: {loc.lesson.title}
                </span>
                <ArrowRight size={18} className="shrink-0" />
              </Link>
            )}
          </div>
          <div className="flex shrink-0 items-center justify-around gap-6 rounded-2xl bg-surface-2/60 p-3 md:justify-start md:bg-transparent md:p-0">
            <div className="text-center">
              <div className="flex items-center justify-center gap-1 text-[34px] leading-none font-bold">
                <Flame size={30} className={s.streak.current > 0 ? 'fill-accent text-accent' : 'text-muted'} />
                {s.streak.current}
              </div>
              <div className="mt-1.5 text-xs font-medium text-muted">day streak</div>
              {s.streak.freezes > 0 && <div className="mt-0.5 text-[10px] text-muted">🧊 {s.streak.freezes} freeze{s.streak.freezes > 1 ? 's' : ''}</div>}
            </div>
            <div className="text-center">
              <ProgressRing value={xpToday / s.profile.dailyGoal} size={84} stroke={8} color="var(--c-primary)">
                <div>
                  <div className="text-lg leading-none font-bold">{xpToday}</div>
                  <div className="text-[10px] text-muted">/ {s.profile.dailyGoal} XP</div>
                </div>
              </ProgressRing>
              <div className="mt-1 text-xs font-medium text-muted">today</div>
            </div>
          </div>
        </div>
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {/* Today's plan */}
          <section className="card p-5">
            <div className="mb-3 flex items-center gap-2">
              <Target size={18} className="text-primary" />
              <h2 className="font-bold">Today's plan</h2>
            </div>
            <div className="space-y-2">
              {plan.map((p) => (
                <Link key={p.label} to={p.to} className="group flex items-center gap-3 rounded-xl border border-line px-3 py-2.5 transition hover:border-primary/40 hover:bg-primary-soft/40">
                  {p.done ? <CheckCircle2 size={20} className="text-success" /> : <Circle size={20} className="text-line-strong" />}
                  <p.icon size={16} className="text-muted" />
                  <span className={`flex-1 text-sm font-semibold ${p.done ? 'text-muted line-through' : ''}`}>{p.label}</span>
                  <ArrowRight size={16} className="text-muted transition group-hover:translate-x-0.5 group-hover:text-primary" />
                </Link>
              ))}
            </div>
          </section>

          {/* Course progress */}
          <section className="card p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-bold">Your path to Advanced SQL Developer</h2>
              <Link to="/learn" className="text-sm font-semibold text-primary">
                See all →
              </Link>
            </div>
            <div className="mb-4">
              <div className="mb-1 flex justify-between text-xs text-muted">
                <span>{Math.round((completedLessons / Math.max(1, totalLessons)) * 100)}% of the course</span>
                <span>
                  Lesson {Math.min(lessonIndex + 1, totalLessons)} of {totalLessons}
                </span>
              </div>
              <div className="h-3 overflow-hidden rounded-full bg-surface-3">
                <div className="h-full rounded-full bg-primary" style={{ width: `${(completedLessons / Math.max(1, totalLessons)) * 100}%` }} />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-7">
              {courseIndex.modules.map((m) => {
                const done = m.lessons.filter((l) => s.lessons[l.id]?.completed).length;
                const pct = done / Math.max(1, m.lessons.length);
                return (
                  <Link key={m.id} to={`/learn/${m.id}`} className="flex flex-col items-center gap-1 rounded-xl p-2 text-center transition hover:bg-surface-2" title={m.title}>
                    <ProgressRing value={pct} size={44} stroke={4} color={pct === 1 ? 'var(--c-success)' : 'var(--c-primary)'}>
                      <span className="text-lg">{m.icon}</span>
                    </ProgressRing>
                    <span className="line-clamp-2 text-[10px] leading-tight font-semibold text-muted">{m.title.split(':')[0].split('—')[0]}</span>
                  </Link>
                );
              })}
            </div>
          </section>

          <section className="card p-5">
            <h2 className="mb-3 font-bold">Your study activity</h2>
            <ActivityHeatmap xpByDay={s.xpByDay} weeks={16} />
            <div className="mt-5">
              <div className="mb-2 text-xs font-semibold text-muted">XP earned — last 14 days</div>
              <XpBars xpByDay={s.xpByDay} days={14} goal={s.profile.dailyGoal} />
            </div>
          </section>
        </div>

        <div className="space-y-6">
          {/* Tests */}
          <section className="card p-5">
            <div className="mb-3 flex items-center gap-2">
              <CalendarClock size={18} className="text-pink" />
              <h2 className="font-bold">Tests</h2>
            </div>
            {[tests.weekly, tests.monthly].map((t) => (
              <Link key={t.kind} to="/tests" className="mb-2 flex items-center justify-between rounded-xl border border-line px-3 py-2.5 hover:border-primary/40">
                <div>
                  <div className="text-sm font-bold">{t.kind === 'weekly' ? 'Weekly test' : 'Monthly test'}</div>
                  <div className="text-xs text-muted">
                    {!anyLesson
                      ? 'Unlocks after your first lessons'
                      : t.available
                        ? `#${t.slot} is ready now!`
                        : t.attempt
                          ? `#${t.slot} done (${t.attempt.score}%) · next in ${t.daysUntil} day${t.daysUntil === 1 ? '' : 's'}`
                          : `First one in ${t.daysUntil} day${t.daysUntil === 1 ? '' : 's'}`}
                  </div>
                </div>
                {anyLesson && t.available ? <span className="chip bg-danger !text-white">Ready</span> : <span className="text-xl">{t.kind === 'weekly' ? '📝' : '🗂️'}</span>}
              </Link>
            ))}
          </section>

          {/* Stats */}
          <section className="grid grid-cols-2 gap-3">
            <MiniStat label="Lessons" value={`${completedLessons}`} />
            <MiniStat label="Exercises solved" value={`${solved}`} />
            <MiniStat label="Challenges" value={`${Object.values(s.challenges).filter((c) => c.solved).length}`} />
            <MiniStat label="Best streak" value={`${s.streak.best}🔥`} />
          </section>

          {weak.length > 0 && (
            <section className="card p-5">
              <h2 className="mb-1 font-bold">Brush up on these</h2>
              <p className="mb-3 text-xs text-muted">Based on your tests and reviews.</p>
              <div className="space-y-1.5">
                {weak.map((w) => {
                  const l = lessonLocation(w.lesson);
                  return l ? (
                    <Link key={w.lesson} to={`/lesson/${w.lesson}`} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-surface-2">
                      <span>{l.module.icon}</span>
                      <span className="flex-1 truncate font-semibold">{l.lesson.title}</span>
                      <span className="text-xs text-danger">{Math.max(0, Math.round(w.score * 100))}%</span>
                    </Link>
                  ) : null;
                })}
              </div>
            </section>
          )}

          {recentBadges.length > 0 && (
            <section className="card p-5">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="flex items-center gap-2 font-bold">
                  <Trophy size={16} className="text-accent" /> Recent badges
                </h2>
                <Link to="/achievements" className="text-xs font-semibold text-primary">
                  All →
                </Link>
              </div>
              <div className="grid grid-cols-4 gap-2">
                {recentBadges.map((a) => (
                  <div key={a!.id} className="flex flex-col items-center text-center" title={a!.description}>
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent-soft text-2xl">{a!.icon}</div>
                    <div className="mt-1 text-[10px] leading-tight font-semibold">{a!.title}</div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {needBackup && (
            <Link to="/settings" className="card flex items-center gap-3 border-accent/40 bg-warn-soft p-4">
              <Save size={20} className="shrink-0 text-accent" />
              <div className="text-sm">
                <div className="font-bold">Time for a backup</div>
                <div className="text-xs text-muted">Download your progress file so it's safe even if browser data gets cleared.</div>
              </div>
            </Link>
          )}
        </div>
      </div>
    </Page>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card p-3.5">
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-xs font-semibold text-muted">{label}</div>
    </div>
  );
}
