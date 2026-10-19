import { ArrowRight, Brain, CalendarDays, CheckCircle2, RotateCcw } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { StepView, STEP_LABEL } from '../components/steps/StepView.tsx';
import { Empty, Page, PageHeader } from '../components/ui.tsx';
import { Workbench } from '../components/Workbench.tsx';
import { Markdown } from '../components/Markdown.tsx';
import { findItem, useAllModules, useChallenges } from '../content/load.ts';
import type { Step } from '../content/types.ts';
import { addDays } from '../lib/dates.ts';
import { useToday } from '../lib/hooks.ts';
import { dueCards, gradeFrom, strength, type Grade } from '../state/srs.ts';
import { useStore } from '../state/store.ts';

const SESSION = 15;

export default function Review() {
  const srs = useStore((s) => s.srs);
  const review = useStore((s) => s.review);
  const addXp = useStore((s) => s.addXp);
  const today = useToday();
  const mods = useAllModules();
  const challenges = useChallenges();
  const [queue, setQueue] = useState<string[] | null>(null);
  const [extra, setExtra] = useState(false);
  const [pos, setPos] = useState(0);
  const [results, setResults] = useState<Record<string, Grade>>({});
  const [answered, setAnswered] = useState<Grade | null>(null);
  const [requeued, setRequeued] = useState<Set<string>>(new Set());

  const due = useMemo(() => dueCards(srs, today), [srs, today]);
  const forecast = useMemo(() => Array.from({ length: 7 }, (_, i) => {
    const d = addDays(today, i + 1);
    return { d, n: Object.values(srs).filter((c) => c.due === d).length };
  }), [srs, today]);
  const total = Object.keys(srs).length;
  const avgStrength = total ? Object.values(srs).reduce((s, c) => s + strength(c), 0) / total : 0;

  const start = (isExtra = false) => {
    let ids: string[];
    if (isExtra) {
      const all = Object.values(srs).filter((c) => c.due > today);
      all.sort((a, b) => a.interval - b.interval || b.lapses - a.lapses);
      ids = all.slice(0, 10).map((c) => c.id);
    } else ids = due.slice(0, SESSION).map((c) => c.id);
    setExtra(isExtra);
    setQueue(ids);
    setPos(0);
    setResults({});
    setAnswered(null);
    setRequeued(new Set());
  };

  const current = queue?.[pos];
  const card = current ? srs[current] : undefined;
  const found = useMemo(() => (mods && current ? findItem(mods, current) : undefined), [mods, current]);
  const challenge = useMemo(() => (current && challenges ? challenges.find((c) => c.id === current) : undefined), [challenges, current]);

  const grade = (g: Grade) => {
    if (!current) return;
    setAnswered(g);
    setResults((r) => ({ ...r, [current]: g }));
    if (extra) addXp(1);
    else review(current, g);
    // Forgotten cards come back once more at the end of the session.
    if (g === 'again' && !requeued.has(current) && queue) {
      setQueue([...queue, current]);
      setRequeued(new Set([...requeued, current]));
    }
  };

  const nextCard = () => {
    setAnswered(null);
    setPos((p) => p + 1);
  };

  // ---------- landing
  if (!queue) {
    return (
      <Page>
        <PageHeader icon="🧠" title="Daily Review" subtitle="Spaced repetition: each exercise comes back right before you would forget it. A few minutes a day keeps everything fresh." />
        <div className="grid gap-4 md:grid-cols-3">
          <div className="card p-6 md:col-span-2">
            {due.length > 0 ? (
              <>
                <div className="text-5xl font-extrabold text-primary">{due.length}</div>
                <div className="font-bold">card{due.length === 1 ? '' : 's'} due today</div>
                <p className="mt-1 text-sm text-muted">A session is up to {SESSION} cards (about {Math.min(SESSION, due.length) * 1.5} minutes).</p>
                <button className="btn btn-primary btn-lg mt-4" onClick={() => start()}>
                  <Brain size={18} /> Start review
                </button>
              </>
            ) : total === 0 ? (
              <div>
                <div className="text-4xl">🌱</div>
                <div className="mt-2 font-bold">Nothing to review yet</div>
                <p className="mt-1 text-sm text-muted">Every exercise and question you complete in lessons is added here automatically.</p>
                <Link to="/learn" className="btn btn-primary mt-4">
                  Go to lessons <ArrowRight size={16} />
                </Link>
              </div>
            ) : (
              <div>
                <div className="text-4xl">✅</div>
                <div className="mt-2 font-bold">All caught up for today!</div>
                <p className="mt-1 text-sm text-muted">Come back tomorrow. Want more practice now? Extra practice doesn't change your schedule.</p>
                <button className="btn btn-outline mt-4" onClick={() => start(true)}>
                  <RotateCcw size={16} /> Extra practice (10 cards)
                </button>
              </div>
            )}
          </div>
          <div className="card p-6">
            <div className="flex items-center gap-2 font-bold">
              <CalendarDays size={16} /> Coming up
            </div>
            <div className="mt-3 flex h-28 items-end gap-1.5">
              {forecast.map((f) => {
                const max = Math.max(1, ...forecast.map((x) => x.n));
                return (
                  <div key={f.d} className="flex flex-1 flex-col items-center gap-1" title={`${f.n} due on ${f.d}`}>
                    <span className="text-[10px] text-muted">{f.n || ''}</span>
                    <div className="w-full rounded-t-md bg-primary/70" style={{ height: `${(f.n / max) * 80 + 2}px` }} />
                    <span className="text-[10px] text-muted">{new Date(f.d + 'T12:00').toLocaleDateString(undefined, { weekday: 'narrow' })}</span>
                  </div>
                );
              })}
            </div>
            <div className="mt-4 text-sm">
              <div className="flex justify-between">
                <span className="text-muted">Cards in your deck</span>
                <b>{total}</b>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Memory strength</span>
                <b>{Math.round(avgStrength * 100)}%</b>
              </div>
            </div>
          </div>
        </div>
      </Page>
    );
  }

  // ---------- finished
  if (pos >= queue.length) {
    const vals = Object.values(results);
    const good = vals.filter((g) => g === 'good' || g === 'easy').length;
    return (
      <Page>
        <Empty icon="🎉" title="Review session complete!">
          You reviewed {vals.length} card{vals.length === 1 ? '' : 's'} — {good} remembered easily, {vals.filter((g) => g === 'hard').length} with effort, {vals.filter((g) => g === 'again').length} to practise again soon.
          <div className="mt-4 flex justify-center gap-2">
            {due.length > 0 && !extra ? (
              <button className="btn btn-primary" onClick={() => start()}>
                Next {Math.min(SESSION, due.length)} cards
              </button>
            ) : (
              <Link to="/" className="btn btn-primary">
                Back home
              </Link>
            )}
            <button className="btn btn-outline" onClick={() => setQueue(null)}>
              Done
            </button>
          </div>
        </Empty>
      </Page>
    );
  }

  // ---------- a card
  const step = found?.item as Step | undefined;
  const dataset = challenge?.dataset ?? (found ? ((step && 'dataset' in step && step.dataset) || found.lesson?.dataset || found.module.dataset) : 'cafe');
  return (
    <Page>
      <div className="mb-4 flex items-center gap-3">
        <button className="btn btn-ghost btn-sm" onClick={() => setQueue(null)}>
          ✕ End
        </button>
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-3">
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${(pos / queue.length) * 100}%` }} />
        </div>
        <span className="text-xs font-semibold text-muted">
          {pos + 1}/{queue.length}
        </span>
      </div>
      <div className="card p-5 sm:p-6">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {step && (
            <span className="chip bg-primary-soft text-primary">
              {STEP_LABEL[step.type].icon} {STEP_LABEL[step.type].label}
            </span>
          )}
          {challenge && <span className="chip bg-primary-soft text-primary">🧩 Challenge</span>}
          {card && card.lapses > 0 && <span className="chip bg-danger-soft text-danger-fg">tricky one</span>}
          <span className="ml-auto truncate text-[11px] text-muted">
            {found ? `${found.module.icon} ${found.lesson?.title ?? found.module.title}` : challenge?.title}
          </span>
        </div>
        {!mods && <div className="h-40 animate-pulse rounded-xl bg-surface-2" />}
        {step && (
          <StepView
            key={current + ':' + pos}
            step={step.type === 'exercise' ? { ...step, title: undefined } : step}
            dataset={dataset}
            done={false}
            onDone={(r) => !answered && grade(gradeFrom(true, r.attempts, r.hints, r.revealed))}
          />
        )}
        {challenge && (
          <div className="space-y-3">
            <div className="text-lg font-bold">{challenge.title}</div>
            <Markdown md={challenge.prompt} />
            <Workbench
              key={current + ':' + pos}
              dataset={challenge.dataset}
              initialSql={challenge.starter ?? ''}
              exercise={challenge}
              onPass={(p) => !answered && grade(gradeFrom(true, p.attempts, p.hints, p.revealed))}
            />
          </div>
        )}
        {mods && challenges && !step && !challenge && (
          <div className="text-sm text-muted">
            This card's content changed and can't be shown.{' '}
            <button className="font-semibold text-primary" onClick={() => grade('good')}>
              Skip it
            </button>
          </div>
        )}
        <div className="mt-5 flex flex-wrap items-center justify-end gap-2 border-t border-line pt-4">
          {!answered ? (
            <button className="btn btn-ghost btn-sm text-muted" onClick={() => grade('again')}>
              I don't remember — show me later
            </button>
          ) : (
            <>
              <span className="mr-auto flex items-center gap-1.5 text-sm font-semibold">
                <CheckCircle2 size={16} className={answered === 'again' ? 'text-danger' : 'text-success'} />
                {answered === 'again' ? "We'll show this again soon." : answered === 'hard' ? 'Got it with some effort — back in a few days.' : 'Remembered! See you in a while.'}
              </span>
              <button className="btn btn-primary" onClick={nextCard}>
                Next card <ArrowRight size={16} />
              </button>
            </>
          )}
        </div>
      </div>
    </Page>
  );
}
