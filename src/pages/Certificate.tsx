import { Printer } from 'lucide-react';
import { Link } from 'react-router-dom';
import { LogoMark } from '../components/Logo.tsx';
import { Bar, Page } from '../components/ui.tsx';
import { allLessonIds, courseIndex } from '../content/load.ts';
import { friendlyDate } from '../lib/dates.ts';
import { useStore } from '../state/store.ts';

export default function Certificate() {
  const s = useStore();
  const done = allLessonIds.filter((id) => s.lessons[id]?.completed);
  const complete = done.length === allLessonIds.length && allLessonIds.length > 0;
  const lastDate = done.map((id) => s.lessons[id].completed!).sort().pop();
  const solved = Object.values(s.steps).filter((x) => x.kind === 'exercise' && x.done).length;
  const challenges = Object.values(s.challenges).filter((c) => c.solved).length;

  if (!complete) {
    return (
      <Page>
        <div className="card mx-auto max-w-xl p-8 text-center">
          <div className="text-6xl">🎓</div>
          <h1 className="mt-3 text-2xl font-bold">Your certificate is waiting</h1>
          <p className="mt-2 text-sm text-muted">Finish every lesson to unlock your “Advanced SQL Developer” certificate.</p>
          <div className="mt-5 text-left">
            <div className="mb-1 text-xs text-muted">
              {done.length} / {allLessonIds.length} lessons
            </div>
            <Bar value={done.length / Math.max(1, allLessonIds.length)} />
          </div>
          <Link to="/learn" className="btn btn-primary mt-6">
            Keep learning
          </Link>
        </div>
      </Page>
    );
  }

  return (
    <Page>
      <div className="no-print mb-4 flex justify-end">
        <button className="btn btn-primary" onClick={() => window.print()}>
          <Printer size={16} /> Print / save as PDF
        </button>
      </div>
      <div className="mx-auto max-w-3xl rounded-3xl border-8 border-double border-primary/40 bg-white p-10 text-center text-slate-900 shadow-pop">
        <div className="mx-auto w-fit">
          <LogoMark size={72} />
        </div>
        <div className="mt-4 text-sm font-bold tracking-[0.3em] text-slate-500 uppercase">Certificate of completion</div>
        <div className="mt-6 text-lg text-slate-600">This certifies that</div>
        <div className="mt-2 font-serif text-5xl font-bold text-indigo-700">{s.profile.name || 'Learner'}</div>
        <div className="mt-6 text-lg text-slate-600">has completed the full SQL Quest curriculum and earned the title</div>
        <div className="mt-2 text-3xl font-bold">🏆 Advanced SQL Developer</div>
        <div className="mx-auto mt-8 grid max-w-lg grid-cols-3 gap-4 text-sm">
          <div>
            <div className="text-2xl font-bold text-indigo-700">{courseIndex.modules.length}</div>modules
          </div>
          <div>
            <div className="text-2xl font-bold text-indigo-700">{solved}</div>exercises
          </div>
          <div>
            <div className="text-2xl font-bold text-indigo-700">{challenges}</div>challenges
          </div>
        </div>
        <div className="mt-8 text-sm text-slate-500">
          Started {friendlyDate(s.profile.startedAt)} · Completed {lastDate ? friendlyDate(lastDate) : ''} · {s.totalXp.toLocaleString()} XP
        </div>
        <div className="mt-4 text-xs text-slate-400">SELECT, JOIN, GROUP BY, subqueries, CTEs, window functions, transactions, indexing, design, PL/pgSQL, analytics.</div>
      </div>
    </Page>
  );
}
