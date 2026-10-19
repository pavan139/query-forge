import { CheckCircle2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Bar, Page, PageHeader } from '../components/ui.tsx';
import { courseIndex } from '../content/load.ts';
import { useStore } from '../state/store.ts';

export default function Projects() {
  const projects = useStore((s) => s.projects);
  const lessons = useStore((s) => s.lessons);
  const list = courseIndex.modules.filter((m) => m.project);
  return (
    <Page>
      <PageHeader icon="💼" title="Projects" subtitle="Realistic, multi-step case studies — the kind of work SQL developers do every day. Each one builds on a module." />
      <div className="grid gap-4 sm:grid-cols-2">
        {list.map((m) => {
          const p = m.project!;
          const done = Object.keys(projects[p.id]?.tasks ?? {}).length;
          const modDone = m.lessons.filter((l) => lessons[l.id]?.completed).length;
          const ready = modDone === m.lessons.length;
          return (
            <Link key={p.id} to={`/projects/${m.id}`} className="card group flex flex-col p-5 transition hover:-translate-y-0.5 hover:shadow-pop">
              <div className="flex items-start gap-3">
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-primary-soft text-3xl">{p.icon}</div>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-bold text-muted">
                    After module {m.order}: {m.title.split(/[:—]/)[0]}
                  </div>
                  <div className="text-lg font-extrabold group-hover:text-primary">{p.title}</div>
                </div>
                {projects[p.id]?.completed && <CheckCircle2 className="text-success" />}
              </div>
              <div className="mt-4">
                <div className="mb-1 flex justify-between text-xs text-muted">
                  <span>
                    {done}/{p.tasks} tasks
                  </span>
                  {!ready && <span>Recommended after finishing the module ({modDone}/{m.lessons.length})</span>}
                </div>
                <Bar value={done / p.tasks} />
              </div>
            </Link>
          );
        })}
      </div>
    </Page>
  );
}
