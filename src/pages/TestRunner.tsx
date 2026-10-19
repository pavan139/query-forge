import { ArrowLeft, ArrowRight, Flag, Timer, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { StepView, STEP_LABEL } from '../components/steps/StepView.tsx';
import { Empty, Page } from '../components/ui.tsx';
import { findItem, useAllModules } from '../content/load.ts';
import type { Step } from '../content/types.ts';
import { useStore } from '../state/store.ts';

function useElapsed(startIso: string | undefined) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  if (!startIso) return '0:00';
  const s = Math.max(0, Math.floor((now - new Date(startIso).getTime()) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export default function TestRunner() {
  const active = useStore((s) => s.activeTest);
  const answer = useStore((s) => s.answerTest);
  const setIndex = useStore((s) => s.setTestIndex);
  const finish = useStore((s) => s.finishTest);
  const abandon = useStore((s) => s.abandonTest);
  const mods = useAllModules();
  const nav = useNavigate();
  const elapsed = useElapsed(active?.startedAt);
  const i = active?.index ?? 0;
  const item = active?.items[i];
  const found = useMemo(() => (mods && item ? findItem(mods, item.id) : undefined), [mods, item]);

  if (!active) {
    return (
      <Page>
        <Empty icon="📝" title="No test in progress">
          <Link to="/tests" className="btn btn-primary mt-3">
            Go to tests
          </Link>
        </Empty>
      </Page>
    );
  }
  const answered = Object.keys(active.answers).length;
  const total = active.items.length;

  const done = () => {
    const missing = total - answered;
    if (missing > 0 && !confirm(`You have ${missing} unanswered question${missing > 1 ? 's' : ''}. They will count as wrong. Finish anyway?`)) return;
    const res = finish();
    if (res) nav(`/tests/result/${res.id}`, { replace: true });
  };

  const step = found?.item as Step | undefined;
  const dataset = found ? ((step && 'dataset' in step && step.dataset) || found.lesson?.dataset || found.module.dataset) : 'cafe';

  return (
    <div className="min-h-full pb-20">
      <div className="sticky top-0 z-20 border-b border-line bg-surface/90 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center gap-3 px-4 py-2.5">
          <button
            className="btn btn-ghost btn-sm !px-2"
            title="Leave test (your answers are kept)"
            onClick={() => nav('/tests')}
          >
            <X size={18} />
          </button>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-bold">{active.title}</div>
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-surface-3">
              <div className="h-full rounded-full bg-gradient-to-r from-pink to-primary transition-all" style={{ width: `${(answered / total) * 100}%` }} />
            </div>
          </div>
          <span className="chip tabular-nums">
            <Timer size={12} /> {elapsed}
          </span>
          <button className="btn btn-primary btn-sm" onClick={done}>
            <Flag size={14} /> Finish
          </button>
        </div>
      </div>

      <div className="mx-auto max-w-4xl px-4 pt-6">
        <div className="mb-4 flex flex-wrap gap-1.5">
          {active.items.map((it, k) => (
            <button
              key={it.id}
              onClick={() => setIndex(k)}
              className={`h-8 w-8 rounded-lg text-xs font-bold transition ${
                k === i ? 'bg-primary text-primary-fg' : active.answers[it.id] ? 'bg-primary-soft text-primary' : 'bg-surface-2 text-muted hover:bg-surface-3'
              }`}
              title={`Question ${k + 1}${active.answers[it.id] ? ' (answered)' : ''}`}
            >
              {k + 1}
            </button>
          ))}
        </div>

        <div className="card p-5 sm:p-6">
          <div className="mb-3 flex items-center gap-2">
            <span className="chip bg-primary-soft text-primary">
              Question {i + 1} of {total}
            </span>
            {step && (
              <span className="chip">
                {STEP_LABEL[step.type].icon} {STEP_LABEL[step.type].label}
              </span>
            )}
            {found && <span className="ml-auto truncate text-[11px] text-muted">{found.module.icon} {found.lesson?.title ?? found.module.title}</span>}
          </div>
          {!mods && <div className="h-40 animate-pulse rounded-xl bg-surface-2" />}
          {mods && !found && <div className="text-sm text-muted">This question is no longer available — skip it.</div>}
          {step && item && (
            <StepView
              key={item.id}
              step={step}
              dataset={dataset}
              done={false}
              onDone={() => undefined}
              test={{ onAnswer: (correct, response) => answer(item.id, correct, response), answered: !!active.answers[item.id] }}
            />
          )}
          {item && active.answers[item.id] && <div className="mt-4 text-xs text-muted">Answer saved. You can move on.</div>}
        </div>

        <div className="mt-4 flex justify-between">
          <button className="btn btn-outline" disabled={i === 0} onClick={() => setIndex(i - 1)}>
            <ArrowLeft size={16} /> Previous
          </button>
          {i < total - 1 ? (
            <button className="btn btn-primary" onClick={() => setIndex(i + 1)}>
              Next <ArrowRight size={16} />
            </button>
          ) : (
            <button className="btn btn-primary" onClick={done}>
              <Flag size={16} /> Finish test
            </button>
          )}
        </div>
        <div className="mt-8 text-center">
          <button
            className="text-xs text-muted underline hover:text-danger"
            onClick={() => {
              if (confirm('Discard this test? Your answers will be lost.')) {
                abandon();
                nav('/tests');
              }
            }}
          >
            Discard this test
          </button>
        </div>
      </div>
    </div>
  );
}
