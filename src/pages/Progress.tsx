import { Award, Brain, Clock, Flame, Target, Zap } from 'lucide-react';
import { Link } from 'react-router-dom';
import { ActivityHeatmap, ScoreLine, XpBars } from '../components/charts/Charts.tsx';
import { Bar, Page, PageHeader, Stat } from '../components/ui.tsx';
import { allLessonIds, courseIndex } from '../content/load.ts';
import { lastNDays } from '../lib/dates.ts';
import { strength } from '../state/srs.ts';
import { useStore } from '../state/store.ts';
import { weakLessons } from '../state/tests.ts';
import { levelFromXp, titleFor, TITLES } from '../state/xp.ts';

export default function Progress() {
  const s = useStore();
  const lv = levelFromXp(s.totalXp);
  const t = titleFor(lv.level);
  const week = lastNDays(7);
  const minutesWeek = week.reduce((n, d) => n + (s.minutesByDay[d] ?? 0), 0);
  const totalMinutes = Object.values(s.minutesByDay).reduce((a, b) => a + b, 0);
  const ex = Object.values(s.steps).filter((x) => x.kind === 'exercise' && x.done);
  const firstTry = ex.filter((x) => x.firstTry).length;
  const cards = Object.values(s.srs);
  const memory = cards.length ? cards.reduce((a, c) => a + strength(c), 0) / cards.length : 0;
  const completed = allLessonIds.filter((id) => s.lessons[id]?.completed).length;
  const weak = weakLessons(s, 6);
  const nextTitle = TITLES.find((x) => x.level > lv.level);

  return (
    <Page wide>
      <PageHeader icon="📈" title="My progress" subtitle="See how far you've come." />
      <div className="card mb-6 flex flex-col gap-5 p-6 sm:flex-row sm:items-center">
        <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br from-primary to-pink text-4xl text-white">{t.icon}</div>
        <div className="flex-1">
          <div className="text-sm font-semibold text-muted">Level {lv.level}</div>
          <div className="text-2xl font-extrabold">{t.title}</div>
          <Bar value={lv.progress} className="mt-2" />
          <div className="mt-1 text-xs text-muted">
            {lv.into} / {lv.needed} XP to level {lv.level + 1}
            {nextTitle && ` · next title “${nextTitle.title}” at level ${nextTitle.level}`}
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <Stat icon={<Zap size={14} />} label="Total XP" value={s.totalXp.toLocaleString()} />
        <Stat icon={<Flame size={14} />} label="Streak" value={`${s.streak.current} d`} hint={`best ${s.streak.best}`} />
        <Stat icon={<Clock size={14} />} label="Study time" value={`${Math.round(totalMinutes / 6) / 10} h`} hint={`${minutesWeek} min this week`} />
        <Stat icon={<Target size={14} />} label="First-try rate" value={ex.length ? `${Math.round((firstTry / ex.length) * 100)}%` : '—'} hint={`${ex.length} exercises`} />
        <Stat icon={<Brain size={14} />} label="Memory" value={`${Math.round(memory * 100)}%`} hint={`${cards.length} review cards`} />
        <Stat icon={<Award size={14} />} label="Lessons" value={`${completed}/${allLessonIds.length}`} />
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section className="card p-5">
          <h2 className="mb-3 font-bold">Activity</h2>
          <ActivityHeatmap xpByDay={s.xpByDay} weeks={26} />
          <div className="mt-5">
            <XpBars xpByDay={s.xpByDay} days={30} goal={s.profile.dailyGoal} />
          </div>
        </section>
        <section className="card p-5">
          <h2 className="mb-3 font-bold">Test scores</h2>
          <ScoreLine points={s.tests.map((x) => ({ label: x.title, score: x.score }))} />
          {weak.length > 0 && (
            <div className="mt-4">
              <div className="mb-2 text-sm font-bold">Topics to strengthen</div>
              {weak.map((w) => {
                const m = courseIndex.modules.find((mm) => mm.lessons.some((l) => l.id === w.lesson));
                const l = m?.lessons.find((x) => x.id === w.lesson);
                return (
                  <Link key={w.lesson} to={`/lesson/${w.lesson}`} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-surface-2">
                    <span>{m?.icon}</span>
                    <span className="flex-1 truncate">{l?.title}</span>
                    <Bar value={Math.max(0, w.score)} className="w-24" color="var(--c-accent)" />
                  </Link>
                );
              })}
            </div>
          )}
        </section>
      </div>
      <section className="card mt-6 p-5">
        <h2 className="mb-4 font-bold">Modules</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {courseIndex.modules.map((m) => {
            const done = m.lessons.filter((l) => s.lessons[l.id]?.completed).length;
            return (
              <Link key={m.id} to={`/learn/${m.id}`} className="flex items-center gap-3 rounded-xl border border-line p-3 hover:border-primary/40">
                <span className="text-2xl">{m.icon}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-bold">{m.title}</div>
                  <Bar value={done / m.lessons.length} className="mt-1.5" color={done === m.lessons.length ? 'var(--c-success)' : undefined} />
                </div>
                <span className="text-xs font-semibold text-muted">
                  {done}/{m.lessons.length}
                </span>
              </Link>
            );
          })}
        </div>
      </section>
    </Page>
  );
}
