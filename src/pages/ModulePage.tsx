import { ArrowLeft, ArrowRight, Briefcase, CheckCircle2, CircleDashed, ClipboardCheck, Clock, Crown, PlayCircle } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { CodeBlock } from '../components/CodeBlock.tsx';
import { Markdown } from '../components/Markdown.tsx';
import { LevelChip, Page, ProgressRing } from '../components/ui.tsx';
import { courseIndex, datasetInfo, useModule } from '../content/load.ts';
import { useStore } from '../state/store.ts';
import { startTestFlow } from './Tests.tsx';

export default function ModulePage() {
  const { moduleId } = useParams();
  const meta = courseIndex.modules.find((m) => m.id === moduleId);
  const mod = useModule(moduleId);
  const lessons = useStore((s) => s.lessons);
  const tests = useStore((s) => s.tests);
  const projects = useStore((s) => s.projects);
  const nav = useNavigate();
  if (!meta) return <Page>Module not found.</Page>;
  const done = meta.lessons.filter((l) => lessons[l.id]?.completed).length;
  const pct = done / meta.lessons.length;
  const best = Math.max(-1, ...tests.filter((t) => t.kind === 'module' && t.moduleId === meta.id).map((t) => t.score));
  const firstOpen = meta.lessons.find((l) => !lessons[l.id]?.completed);
  const ds = datasetInfo(meta.dataset);
  const idx = courseIndex.modules.indexOf(meta);
  const prev = courseIndex.modules[idx - 1];
  const next = courseIndex.modules[idx + 1];
  const proj = meta.project;
  const projDone = proj ? Object.keys(projects[proj.id]?.tasks ?? {}).length : 0;

  return (
    <Page>
      <Link to="/learn" className="mb-4 inline-flex items-center gap-1 text-sm font-semibold text-muted hover:text-fg">
        <ArrowLeft size={15} /> All modules
      </Link>
      <div className="card overflow-hidden">
        <div className="gradient-hero p-6 text-white sm:p-8">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
            <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-3xl bg-white/15 text-5xl">{meta.icon}</div>
            <div className="flex-1">
              <div className="text-xs font-bold tracking-widest uppercase opacity-80">Module {meta.order}</div>
              <h1 className="text-3xl font-extrabold tracking-tight">{meta.title}</h1>
              <p className="mt-1 opacity-90">{meta.subtitle}</p>
            </div>
            <div className="rounded-full bg-white/15 p-1">
              <ProgressRing value={pct} size={76} stroke={7} color="#fde68a">
                <span className="text-white">{Math.round(pct * 100)}%</span>
              </ProgressRing>
            </div>
          </div>
        </div>
        <div className="space-y-4 p-6">
          <div className="flex flex-wrap gap-2">
            <LevelChip level={meta.level} />
            {ds && (
              <Link to={`/datasets/${ds.id}`} className="chip hover:bg-surface-3">
                {ds.icon} Dataset: {ds.name}
              </Link>
            )}
            <span className="chip">
              <Clock size={11} /> ~{meta.lessons.reduce((n, l) => n + l.minutes, 0)} min
            </span>
          </div>
          <Markdown md={meta.description} />
          {firstOpen && (
            <Link to={`/lesson/${firstOpen.id}`} className="btn btn-primary btn-lg">
              <PlayCircle size={18} /> {done ? 'Continue' : 'Start'}: {firstOpen.title}
            </Link>
          )}
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <section className="lg:col-span-2">
          <h2 className="mb-3 text-lg font-bold">Lessons</h2>
          <div className="space-y-2">
            {meta.lessons.map((l, i) => {
              const p = lessons[l.id];
              const status = p?.completed ? 'done' : p ? 'started' : 'new';
              return (
                <Link key={l.id} to={`/lesson/${l.id}`} className="card group flex items-center gap-4 p-4 transition hover:border-primary/40">
                  <div
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-sm font-bold ${
                      status === 'done' ? 'bg-success-soft text-success-fg' : status === 'started' ? 'bg-primary-soft text-primary' : 'bg-surface-2 text-muted'
                    }`}
                  >
                    {status === 'done' ? <CheckCircle2 size={20} /> : i + 1}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-bold group-hover:text-primary">{l.title}</div>
                    <div className="truncate text-sm text-muted">{l.summary}</div>
                  </div>
                  <div className="hidden shrink-0 text-right text-xs text-muted sm:block">
                    <div>{l.minutes} min</div>
                    <div>{l.graded} questions</div>
                  </div>
                  {status === 'started' && <CircleDashed size={18} className="text-primary" />}
                  <ArrowRight size={16} className="text-muted group-hover:text-primary" />
                </Link>
              );
            })}
          </div>
        </section>

        <aside className="space-y-4">
          <div className="card p-5">
            <div className="flex items-center gap-2 font-bold">
              <ClipboardCheck size={18} className="text-pink" /> Mastery test
            </div>
            <p className="mt-1 text-sm text-muted">12 fresh questions from this module. Score 70% or more to earn the crown 👑.</p>
            {best >= 0 && (
              <div className="mt-2 flex items-center gap-2 text-sm">
                {best >= 70 && <Crown size={16} className="text-accent" />} Best score: <b>{best}%</b>
              </div>
            )}
            <button
              className="btn btn-outline mt-3 w-full"
              onClick={async () => {
                if (done < meta.lessons.length && !confirm("You haven't finished all lessons in this module yet. Take the test anyway?")) return;
                await startTestFlow({ kind: 'module', moduleId: meta.id, title: `${meta.title} — Mastery test` });
                nav('/tests/run');
              }}
            >
              {best >= 0 ? 'Retake test' : 'Take the test'}
            </button>
          </div>

          {proj && (
            <Link to={`/projects/${meta.id}`} className="card block p-5 transition hover:border-primary/40">
              <div className="flex items-center gap-2 font-bold">
                <Briefcase size={18} className="text-primary" /> Project
              </div>
              <div className="mt-2 flex items-center gap-3">
                <span className="text-3xl">{proj.icon}</span>
                <div>
                  <div className="font-bold">{proj.title}</div>
                  <div className="text-xs text-muted">
                    {projDone}/{proj.tasks} tasks done
                  </div>
                </div>
              </div>
            </Link>
          )}

          {mod && mod.lessons.some((l) => l.cheatsheet?.length) && (
            <div className="card p-5">
              <div className="mb-2 font-bold">📌 Module cheat sheet</div>
              <div className="space-y-3">
                {mod.lessons
                  .flatMap((l) => l.cheatsheet ?? [])
                  .slice(0, 8)
                  .map((c, i) => (
                    <div key={i}>
                      <div className="mb-1 text-xs font-semibold text-muted">{c.title}</div>
                      <CodeBlock sql={c.sql.trim()} />
                    </div>
                  ))}
              </div>
              <Link to="/reference" className="mt-3 inline-block text-sm font-semibold text-primary">
                Full cheat sheet →
              </Link>
            </div>
          )}

          <div className="flex justify-between gap-2">
            {prev ? (
              <Link to={`/learn/${prev.id}`} className="btn btn-ghost btn-sm">
                <ArrowLeft size={14} /> {prev.icon} Prev
              </Link>
            ) : (
              <span />
            )}
            {next && (
              <Link to={`/learn/${next.id}`} className="btn btn-ghost btn-sm">
                Next {next.icon} <ArrowRight size={14} />
              </Link>
            )}
          </div>
        </aside>
      </div>
    </Page>
  );
}
