import { ArrowRight, Briefcase, CheckCircle2, Crown, Lock } from 'lucide-react';
import { Link } from 'react-router-dom';
import { LevelChip, Page, PageHeader, ProgressRing } from '../components/ui.tsx';
import { courseIndex } from '../content/load.ts';
import { useStore } from '../state/store.ts';
import { useNextLesson } from './Home.tsx';

const LEVELS = [
  { id: 'beginner', title: 'Foundations', blurb: 'Reading data: SELECT, filtering, sorting, functions.', emoji: '🌱' },
  { id: 'intermediate', title: 'Core Skills', blurb: 'Summaries, joins, subqueries, changing data, design.', emoji: '🌿' },
  { id: 'advanced', title: 'Advanced SQL', blurb: 'Window functions, CTEs, transactions, performance, Postgres power tools.', emoji: '🌳' },
  { id: 'expert', title: 'Pro Developer', blurb: 'Programming the database, analytics patterns, real-world practice.', emoji: '🏆' },
];

export default function Learn() {
  const lessons = useStore((s) => s.lessons);
  const tests = useStore((s) => s.tests);
  const next = useNextLesson();
  const nextModule = next?.split('-')[0];
  const mastered = new Set(tests.filter((t) => t.kind === 'module' && t.score >= 70).map((t) => t.moduleId));

  return (
    <Page>
      <PageHeader
        title="Your learning path"
        subtitle={`${courseIndex.modules.length} modules · ${courseIndex.modules.reduce((n, m) => n + m.lessons.length, 0)} lessons · from your first query to advanced SQL developer`}
        actions={
          next && (
            <Link to={`/lesson/${next}`} className="btn btn-primary">
              Continue learning <ArrowRight size={16} />
            </Link>
          )
        }
      />
      <div className="space-y-10">
        {LEVELS.map((lvl) => {
          const mods = courseIndex.modules.filter((m) => m.level === lvl.id);
          if (!mods.length) return null;
          return (
            <section key={lvl.id}>
              <div className="mb-4 flex items-center gap-3">
                <span className="text-3xl">{lvl.emoji}</span>
                <div>
                  <h2 className="text-xl font-bold">{lvl.title}</h2>
                  <p className="text-sm text-muted">{lvl.blurb}</p>
                </div>
              </div>
              <div className="relative space-y-4 pl-8 sm:pl-10">
                <div className="absolute top-2 bottom-2 left-3 w-1 rounded-full bg-surface-3 sm:left-4" />
                {mods.map((m) => {
                  const done = m.lessons.filter((l) => lessons[l.id]?.completed).length;
                  const started = m.lessons.some((l) => lessons[l.id]);
                  const pct = done / Math.max(1, m.lessons.length);
                  const complete = pct === 1;
                  const current = m.id === nextModule;
                  const notYet = !started && !current && m.order > (courseIndex.modules.find((x) => x.id === nextModule)?.order ?? 0);
                  return (
                    <div key={m.id} className="relative">
                      <div
                        className={`absolute top-6 -left-[26px] flex h-6 w-6 items-center justify-center rounded-full border-4 border-bg sm:-left-[30px] ${
                          complete ? 'bg-success' : current ? 'animate-pulse bg-primary' : started ? 'bg-primary/60' : 'bg-line-strong'
                        }`}
                      />
                      <Link
                        to={`/learn/${m.id}`}
                        className={`card group flex flex-col gap-4 p-5 transition hover:-translate-y-0.5 hover:shadow-pop sm:flex-row sm:items-center ${current ? 'ring-2 ring-primary/50' : ''} ${notYet ? 'opacity-80' : ''}`}
                      >
                        <ProgressRing value={pct} size={64} stroke={5} color={complete ? 'var(--c-success)' : 'var(--c-primary)'}>
                          <span className="text-2xl">{m.icon}</span>
                        </ProgressRing>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs font-bold text-muted">MODULE {m.order}</span>
                            <LevelChip level={m.level} />
                            {current && <span className="chip bg-primary !text-primary-fg">You are here</span>}
                            {mastered.has(m.id) && (
                              <span className="chip bg-accent-soft text-accent">
                                <Crown size={11} /> Mastered
                              </span>
                            )}
                          </div>
                          <h3 className="mt-1 text-lg font-bold group-hover:text-primary">{m.title}</h3>
                          <p className="text-sm text-muted">{m.subtitle}</p>
                          <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted">
                            <span>
                              {done}/{m.lessons.length} lessons
                            </span>
                            <span>~{Math.round(m.lessons.reduce((n, l) => n + l.minutes, 0) / 5) * 5} min</span>
                            <span>{m.lessons.reduce((n, l) => n + l.graded, 0)} exercises & questions</span>
                            {m.project && (
                              <span className="flex items-center gap-1">
                                <Briefcase size={12} /> Project
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="shrink-0">
                          {complete ? (
                            <CheckCircle2 className="text-success" size={28} />
                          ) : notYet ? (
                            <Lock className="text-line-strong" size={22} />
                          ) : (
                            <ArrowRight className="text-primary transition group-hover:translate-x-1" size={24} />
                          )}
                        </div>
                      </Link>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </Page>
  );
}
