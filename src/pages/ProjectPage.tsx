import { ArrowLeft, CheckCircle2, Circle } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Difficulty } from '../components/steps/StepView.tsx';
import { Markdown } from '../components/Markdown.tsx';
import { Bar, Page } from '../components/ui.tsx';
import { Workbench } from '../components/Workbench.tsx';
import { datasetInfo, useModule } from '../content/load.ts';
import { useStore } from '../state/store.ts';

export default function ProjectPage() {
  const { moduleId } = useParams();
  const mod = useModule(moduleId);
  const progress = useStore((s) => (mod?.project ? s.projects[mod.project.id] : undefined));
  const completeTask = useStore((s) => s.completeProjectTask);
  const addCard = useStore((s) => s.addCard);
  const [active, setActive] = useState(0);
  if (!mod) return <Page>Loading…</Page>;
  const p = mod.project;
  if (!p) return <Page>This module has no project.</Page>;
  const done = progress?.tasks ?? {};
  const doneCount = Object.keys(done).length;
  const task = p.tasks[active];
  const ds = datasetInfo(p.dataset);

  return (
    <Page wide>
      <Link to="/projects" className="mb-4 inline-flex items-center gap-1 text-sm font-semibold text-muted hover:text-fg">
        <ArrowLeft size={15} /> All projects
      </Link>
      <div className="card mb-6 overflow-hidden">
        <div className="gradient-hero flex items-center gap-4 p-6 text-white">
          <div className="text-5xl">{p.icon}</div>
          <div className="flex-1">
            <div className="text-xs font-bold tracking-widest uppercase opacity-80">Project · {ds?.icon} {ds?.name}</div>
            <h1 className="text-2xl font-extrabold">{p.title}</h1>
          </div>
          {progress?.completed && <CheckCircle2 size={32} />}
        </div>
        <div className="p-6">
          <Markdown md={p.md} />
          <div className="mt-4">
            <div className="mb-1 text-xs text-muted">
              {doneCount}/{p.tasks.length} tasks complete
            </div>
            <Bar value={doneCount / p.tasks.length} />
          </div>
        </div>
      </div>
      <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
        <div className="space-y-1.5">
          {p.tasks.map((t, i) => (
            <button
              key={t.id}
              onClick={() => setActive(i)}
              className={`flex w-full items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-sm transition ${i === active ? 'border-primary bg-primary-soft' : 'border-line bg-surface hover:border-line-strong'}`}
            >
              {done[t.id] ? <CheckCircle2 size={18} className="shrink-0 text-success" /> : <Circle size={18} className="shrink-0 text-line-strong" />}
              <span className="font-semibold">
                Task {i + 1}
                {t.title ? `: ${t.title}` : ''}
              </span>
            </button>
          ))}
        </div>
        <div className="card p-5 sm:p-6">
          <div className="mb-2 flex items-center gap-2">
            <h2 className="text-lg font-bold">
              Task {active + 1}
              {task.title ? `: ${task.title}` : ''}
            </h2>
            {task.difficulty && <Difficulty d={task.difficulty} />}
          </div>
          <Markdown md={task.prompt} />
          <div className="mt-4">
            <Workbench
              key={task.id}
              draftKey={task.id}
              dataset={task.dataset ?? p.dataset}
              initialSql={task.starter ?? ''}
              exercise={task}
              solved={!!done[task.id]}
              showSchema
              onPass={(info) => {
                completeTask(p.id, task.id, p.tasks.length);
                addCard(task.id, 'project', mod.id, info.revealed ? 'again' : info.attempts <= 1 && info.hints === 0 ? 'good' : 'hard');
              }}
            />
          </div>
          {done[task.id] && active < p.tasks.length - 1 && (
            <button className="btn btn-primary mt-4" onClick={() => setActive(active + 1)}>
              Next task →
            </button>
          )}
        </div>
      </div>
    </Page>
  );
}
