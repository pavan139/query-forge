import { CheckCircle2, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Page, PageHeader } from '../components/ui.tsx';
import { courseIndex, datasetInfo, useChallenges } from '../content/load.ts';
import { useStore } from '../state/store.ts';

export const DIFF: Record<string, { label: string; cls: string; dot: string }> = {
  easy: { label: 'Easy', cls: 'bg-success-soft text-success-fg', dot: 'bg-success' },
  medium: { label: 'Medium', cls: 'bg-info-soft text-sky-700 dark:text-sky-300', dot: 'bg-sky-500' },
  hard: { label: 'Hard', cls: 'bg-warn-soft text-amber-700 dark:text-amber-300', dot: 'bg-amber-500' },
  expert: { label: 'Expert', cls: 'bg-pink/15 text-pink', dot: 'bg-pink' },
};

export default function Practice() {
  const challenges = useChallenges();
  const progress = useStore((s) => s.challenges);
  const lessons = useStore((s) => s.lessons);
  const [q, setQ] = useState('');
  const [diff, setDiff] = useState<string>('all');
  const [ds, setDs] = useState<string>('all');
  const [status, setStatus] = useState<'all' | 'todo' | 'solved' | 'ready'>('ready');

  const highest = useMemo(() => {
    let best = 'm00';
    for (const id of Object.keys(lessons)) if (lessons[id].completed && id.slice(0, 3) > best) best = id.slice(0, 3);
    return best;
  }, [lessons]);

  const list = useMemo(() => {
    if (!challenges) return [];
    return challenges.filter((c) => {
      if (diff !== 'all' && c.difficulty !== diff) return false;
      if (ds !== 'all' && c.dataset !== ds) return false;
      const solved = !!progress[c.id]?.solved;
      if (status === 'todo' && solved) return false;
      if (status === 'solved' && !solved) return false;
      if (status === 'ready' && c.module > highest) return false;
      if (q && !`${c.title} ${c.tags.join(' ')} ${c.prompt}`.toLowerCase().includes(q.toLowerCase())) return false;
      return true;
    });
  }, [challenges, diff, ds, status, q, progress, highest]);

  const solvedCount = Object.values(progress).filter((p) => p.solved).length;
  const datasetsUsed = [...new Set(challenges?.map((c) => c.dataset) ?? [])];

  return (
    <Page wide>
      <PageHeader icon="🧩" title="Practice challenges" subtitle={`${challenges?.length ?? '…'} real-world SQL problems from easy to expert. You've solved ${solvedCount}.`} />
      <div className="card mb-5 flex flex-col gap-3 p-4 lg:flex-row lg:items-center">
        <div className="flex flex-1 items-center gap-2 rounded-xl border border-line bg-surface px-3">
          <Search size={16} className="text-muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by topic (e.g. join, window, date)…" className="w-full bg-transparent py-2 text-sm outline-none" />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {(['ready', 'all', 'todo', 'solved'] as const).map((s) => (
            <button key={s} className={`btn btn-sm ${status === s ? 'btn-primary' : 'btn-outline'}`} onClick={() => setStatus(s)}>
              {s === 'ready' ? 'Ready for me' : s === 'todo' ? 'Unsolved' : s === 'solved' ? 'Solved' : 'All'}
            </button>
          ))}
        </div>
        <select value={diff} onChange={(e) => setDiff(e.target.value)} className="rounded-xl border border-line bg-surface px-3 py-2 text-sm">
          <option value="all">All levels</option>
          {Object.entries(DIFF).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </select>
        <select value={ds} onChange={(e) => setDs(e.target.value)} className="rounded-xl border border-line bg-surface px-3 py-2 text-sm">
          <option value="all">All datasets</option>
          {datasetsUsed.map((d) => (
            <option key={d} value={d}>
              {datasetInfo(d)?.icon} {datasetInfo(d)?.name ?? d}
            </option>
          ))}
        </select>
      </div>
      {status === 'ready' && <p className="mb-3 text-xs text-muted">Showing challenges that only use skills from the modules you've reached. Switch to “All” to see everything.</p>}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {list.map((c) => {
          const solved = progress[c.id]?.solved;
          const d = DIFF[c.difficulty];
          const mod = courseIndex.modules.find((m) => m.id === c.module);
          return (
            <Link key={c.id} to={`/practice/${c.id}`} className="card group flex flex-col p-4 transition hover:-translate-y-0.5 hover:shadow-pop">
              <div className="flex items-center gap-2">
                <span className={`chip ${d.cls}`}>{d.label}</span>
                <span className="text-sm" title={datasetInfo(c.dataset)?.name}>
                  {datasetInfo(c.dataset)?.icon}
                </span>
                {solved && <CheckCircle2 size={18} className="ml-auto text-success" />}
              </div>
              <div className="mt-2 font-bold group-hover:text-primary">{c.title}</div>
              <div className="mt-1 line-clamp-2 text-xs text-muted">{c.prompt.replace(/[`*#>]/g, '')}</div>
              <div className="mt-auto flex flex-wrap gap-1 pt-3">
                {c.tags.slice(0, 3).map((t) => (
                  <span key={t} className="rounded-md bg-surface-2 px-1.5 py-0.5 text-[10px] font-semibold text-muted">
                    {t}
                  </span>
                ))}
                {mod && <span className="ml-auto text-[10px] text-muted">after {mod.icon} M{mod.order}</span>}
              </div>
            </Link>
          );
        })}
      </div>
      {challenges && list.length === 0 && <div className="py-12 text-center text-sm text-muted">No challenges match these filters.</div>}
    </Page>
  );
}
