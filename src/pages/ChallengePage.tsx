import { ArrowLeft, ArrowRight, CheckCircle2 } from 'lucide-react';
import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Markdown } from '../components/Markdown.tsx';
import { Page } from '../components/ui.tsx';
import { Workbench } from '../components/Workbench.tsx';
import { datasetInfo, useChallenges } from '../content/load.ts';
import { useStore } from '../state/store.ts';
import { DIFF } from './Practice.tsx';

export default function ChallengePage() {
  const { challengeId } = useParams();
  const challenges = useChallenges();
  const c = challenges?.find((x) => x.id === challengeId);
  const p = useStore((s) => (challengeId ? s.challenges[challengeId] : undefined));
  const solve = useStore((s) => s.solveChallenge);
  const attempt = useStore((s) => s.attemptChallenge);
  const next = useMemo(() => {
    if (!challenges || !c) return undefined;
    const i = challenges.indexOf(c);
    return challenges.slice(i + 1).find((x) => x.difficulty === c.difficulty) ?? challenges[i + 1];
  }, [challenges, c]);

  if (!challenges) return <Page>Loading…</Page>;
  if (!c) return <Page>Challenge not found.</Page>;
  const d = DIFF[c.difficulty];
  const ds = datasetInfo(c.dataset);

  return (
    <Page wide>
      <Link to="/practice" className="mb-4 inline-flex items-center gap-1 text-sm font-semibold text-muted hover:text-fg">
        <ArrowLeft size={15} /> All challenges
      </Link>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div className="card h-fit p-6 lg:sticky lg:top-6">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`chip ${d.cls}`}>{d.label}</span>
            {ds && (
              <Link to={`/datasets/${ds.id}`} className="chip hover:bg-surface-3">
                {ds.icon} {ds.name}
              </Link>
            )}
            {p?.solved && (
              <span className="chip bg-success-soft text-success-fg">
                <CheckCircle2 size={12} /> Solved
              </span>
            )}
          </div>
          <h1 className="mt-3 text-2xl font-bold">{c.title}</h1>
          <div className="mt-3">
            <Markdown md={c.prompt} />
          </div>
          <div className="mt-4 flex flex-wrap gap-1">
            {c.tags.map((t) => (
              <span key={t} className="rounded-md bg-surface-2 px-2 py-0.5 text-xs font-semibold text-muted">
                #{t}
              </span>
            ))}
          </div>
        </div>
        <div className="space-y-4">
          <Workbench
            key={c.id}
            draftKey={`ch:${c.id}`}
            dataset={c.dataset}
            initialSql={c.starter ?? ''}
            exercise={c}
            solved={p?.solved}
            showSchema
            editorMinHeight={200}
            onFail={() => attempt(c.id, c.difficulty)}
            onPass={(info) => solve(c.id, c.difficulty, info.sql, info.attempts, info.hints + (info.revealed ? 3 : 0))}
          />
          {p?.solved && next && (
            <Link to={`/practice/${next.id}`} className="btn btn-primary">
              Next challenge: {next.title} <ArrowRight size={16} />
            </Link>
          )}
        </div>
      </div>
    </Page>
  );
}
