import { Check, CheckCircle2, Loader2, Play, X, XCircle } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { FillStep, ParsonsStep, PredictStep, QuizStep } from '../../content/types.ts';
import { db } from '../../db/client.ts';
import type { RunOutput } from '../../db/engine.ts';
import { playSound } from '../../lib/sound.ts';
import { useStore } from '../../state/store.ts';
import { CodeBlock } from '../CodeBlock.tsx';
import { Markdown } from '../Markdown.tsx';
import { ResultsPanel } from '../ResultsPanel.tsx';

export interface GradedProps {
  dataset: string;
  done: boolean;
  /** Lesson/review: called once answered correctly (attempts includes the correct one). */
  onDone?: (r: { attempts: number; hints: number; revealed: boolean }) => void;
  /** Test mode: one attempt, report correctness. */
  test?: { onAnswer: (correct: boolean, response: string) => void; answered?: boolean };
}

function useFeedbackSound() {
  const sound = useStore((s) => s.profile.sound);
  return (ok: boolean) => sound && playSound(ok ? 'success' : 'wrong');
}

function Feedback({ ok, explanation, retry }: { ok: boolean; explanation?: string; retry?: boolean }) {
  return (
    <div className={`animate-pop rounded-xl border p-3.5 ${ok ? 'border-success/40 bg-success-soft' : 'border-danger/30 bg-danger-soft'}`}>
      <div className={`flex items-center gap-2 font-bold ${ok ? 'text-success-fg' : 'text-danger-fg'}`}>
        {ok ? <CheckCircle2 size={18} /> : <XCircle size={18} />}
        {ok ? 'Correct!' : retry ? 'Not quite — have another go.' : 'Not quite.'}
      </div>
      {explanation && (ok || !retry) && (
        <div className="mt-1.5 text-sm">
          <Markdown md={explanation} />
        </div>
      )}
    </div>
  );
}

function Saved() {
  return <div className="animate-pop text-sm font-semibold text-primary">✓ Answer saved — you'll see the results at the end.</div>;
}

function RunIt({ sql, dataset, label = 'Run it and see' }: { sql: string; dataset: string; label?: string }) {
  const [run, setRun] = useState<RunOutput | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="space-y-2">
      <button
        className="btn btn-outline btn-sm"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            setRun(await db.run(dataset, sql));
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />} {label}
      </button>
      {run && <ResultsPanel run={run} sql={sql} maxHeight={260} />}
    </div>
  );
}

// ---------------------------------------------------------------- Quiz
export function QuizView({ step, dataset, done, onDone, test }: GradedProps & { step: QuizStep }) {
  const multi = Array.isArray(step.answer);
  const correctSet = useMemo(() => new Set(Array.isArray(step.answer) ? step.answer : [step.answer]), [step.answer]);
  const [sel, setSel] = useState<number[]>(done && !test ? [...correctSet] : []);
  const [result, setResult] = useState<null | boolean>(done && !test ? true : null);
  const [attempts, setAttempts] = useState(0);
  const fb = useFeedbackSound();
  const locked = result === true || (!!test && result !== null);

  const toggle = (i: number) => {
    if (locked) return;
    setResult(null);
    setSel((s) => (multi ? (s.includes(i) ? s.filter((x) => x !== i) : [...s, i]) : [i]));
  };
  const submit = () => {
    const ok = sel.length === correctSet.size && sel.every((i) => correctSet.has(i));
    const n = attempts + 1;
    setAttempts(n);
    setResult(ok);
    fb(ok);
    if (test) test.onAnswer(ok, sel.join(','));
    else if (ok) onDone?.({ attempts: n, hints: 0, revealed: false });
  };

  return (
    <div className="space-y-3">
      <Markdown md={step.question} className="text-fg" />
      {step.sql && <CodeBlock sql={step.sql.trim()} />}
      {multi && <div className="text-xs font-semibold text-muted">Select all that apply.</div>}
      <div className="grid gap-2">
        {step.options.map((o, i) => {
          const picked = sel.includes(i);
          const showRight = !test && locked && correctSet.has(i);
          const showWrong = !test && result !== null && picked && !correctSet.has(i);
          return (
            <button
              key={i}
              onClick={() => toggle(i)}
              className={`flex items-center gap-3 rounded-xl border-2 px-4 py-3 text-left text-sm transition ${
                showRight
                  ? 'border-success bg-success-soft'
                  : showWrong
                    ? 'border-danger bg-danger-soft'
                    : picked
                      ? 'border-primary bg-primary-soft'
                      : 'border-line bg-surface hover:border-line-strong hover:bg-surface-2'
              }`}
            >
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center ${multi ? 'rounded-md' : 'rounded-full'} border-2 text-xs font-bold ${
                  picked ? 'border-primary bg-primary text-primary-fg' : 'border-line-strong text-muted'
                }`}
              >
                {picked ? <Check size={13} /> : String.fromCharCode(65 + i)}
              </span>
              <Markdown md={o} inline className="min-w-0" />
            </button>
          );
        })}
      </div>
      {!locked && (
        <button className="btn btn-primary" disabled={sel.length === 0} onClick={submit}>
          {test ? 'Submit answer' : 'Check'}
        </button>
      )}
      {test && result !== null && <Saved />}
      {!test && result !== null && <Feedback ok={result} explanation={step.explanation} retry={!result && attempts < 2} />}
      {!test && result === false && attempts >= 2 && (
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => {
            setSel([...correctSet]);
            setResult(true);
            onDone?.({ attempts, hints: 0, revealed: true });
          }}
        >
          Show me the answer
        </button>
      )}
      {step.sql && locked && !test && <RunIt sql={step.sql} dataset={step.dataset ?? dataset} />}
    </div>
  );
}

// ---------------------------------------------------------------- Predict
export function PredictView({ step, dataset, done, onDone, test }: GradedProps & { step: PredictStep }) {
  const [sel, setSel] = useState<number | null>(done && !test ? step.answer : null);
  const [result, setResult] = useState<null | boolean>(done && !test ? true : null);
  const [attempts, setAttempts] = useState(0);
  const fb = useFeedbackSound();
  const locked = result === true || (!!test && result !== null);
  const submit = (i: number) => {
    if (locked) return;
    setSel(i);
    const ok = i === step.answer;
    const n = attempts + 1;
    setAttempts(n);
    setResult(ok);
    fb(ok);
    if (test) test.onAnswer(ok, String(i));
    else if (ok) onDone?.({ attempts: n, hints: 0, revealed: false });
  };
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-xs font-bold tracking-wide text-primary uppercase">🔮 Predict the result</div>
      <Markdown md={step.question} className="text-fg" />
      <CodeBlock sql={step.sql.trim()} />
      <div className="grid gap-2 sm:grid-cols-2">
        {step.options.map((o, i) => {
          const right = !test && locked && i === step.answer;
          const wrong = !test && result !== null && sel === i && i !== step.answer;
          const chosen = !!test && sel === i;
          return (
            <button
              key={i}
              onClick={() => submit(i)}
              className={`rounded-xl border-2 px-4 py-3 text-left text-sm font-medium transition ${
                right ? 'border-success bg-success-soft' : wrong ? 'border-danger bg-danger-soft' : chosen ? 'border-primary bg-primary-soft' : 'border-line bg-surface hover:border-primary/50 hover:bg-primary-soft/40'
              }`}
            >
              <Markdown md={o} inline />
            </button>
          );
        })}
      </div>
      {test && result !== null && <Saved />}
      {!test && result !== null && <Feedback ok={result} explanation={step.explanation} retry={!result && attempts < 2} />}
      {!test && result === false && attempts >= 2 && (
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => {
            setSel(step.answer);
            setResult(true);
            onDone?.({ attempts, hints: 0, revealed: true });
          }}
        >
          Show me the answer
        </button>
      )}
      {locked && !test && <RunIt sql={step.sql} dataset={step.dataset ?? dataset} label="Run it to check" />}
    </div>
  );
}

// ---------------------------------------------------------------- Fill in the blanks
const norm = (s: string) =>
  s
    .trim()
    .replace(/;+$/, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*([(),=<>*+\-/])\s*/g, '$1')
    .toLowerCase();

export function FillView({ step, dataset, done, onDone, test }: GradedProps & { step: FillStep }) {
  const parts = step.template.split('___');
  const [vals, setVals] = useState<string[]>(() => (done && !test ? step.answers.map((a) => a[0]) : step.answers.map(() => '')));
  const [checked, setChecked] = useState<boolean[] | null>(done && !test ? step.answers.map(() => true) : null);
  const [attempts, setAttempts] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const fb = useFeedbackSound();
  const allOk = checked?.every(Boolean) ?? false;
  const locked = allOk || (!!test && checked !== null);

  const submit = () => {
    const res = vals.map((v, i) => step.answers[i].some((a) => norm(a) === norm(v)));
    const ok = res.every(Boolean);
    const n = attempts + 1;
    setAttempts(n);
    setChecked(res);
    fb(ok);
    if (test) test.onAnswer(ok, vals.join(' | '));
    else if (ok) onDone?.({ attempts: n, hints: 0, revealed: false });
  };
  const filled = parts.reduce((acc, p, i) => acc + p + (i < vals.length ? vals[i] : ''), '');

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-xs font-bold tracking-wide text-primary uppercase">✏️ Fill in the blanks</div>
      <Markdown md={step.prompt} className="text-fg" />
      <pre className="overflow-x-auto rounded-xl border border-line bg-code px-4 py-3 font-mono text-[13.5px] leading-[2.1] whitespace-pre-wrap">
        {parts.map((p, i) => (
          <span key={i}>
            {p}
            {i < parts.length - 1 && (
              <input
                value={vals[i]}
                disabled={locked}
                onChange={(e) => {
                  const v = [...vals];
                  v[i] = e.target.value;
                  setVals(v);
                  if (checked && !test) setChecked(null);
                }}
                onKeyDown={(e) => e.key === 'Enter' && !locked && vals.every((v) => v.trim()) && submit()}
                spellCheck={false}
                autoCapitalize="off"
                style={{ width: `${Math.max(4, (vals[i] || '').length + 2, Math.min(18, step.answers[i][0].length + 2))}ch` }}
                className={`mx-0.5 rounded-md border-2 bg-surface px-1.5 py-0.5 font-mono text-[13px] outline-none ${
                  checked && !test ? (checked[i] ? 'border-success bg-success-soft' : 'border-danger bg-danger-soft') : 'border-primary/40 focus:border-primary'
                }`}
                aria-label={`Blank ${i + 1}`}
              />
            )}
          </span>
        ))}
      </pre>
      {!locked && (
        <button className="btn btn-primary" disabled={vals.some((v) => !v.trim())} onClick={submit}>
          {test ? 'Submit answer' : 'Check'}
        </button>
      )}
      {test && checked && <Saved />}
      {!test && checked && <Feedback ok={allOk} explanation={step.explanation} retry={!allOk && attempts < 3} />}
      {!test && checked && !allOk && attempts >= 2 && !revealed && (
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => {
            setVals(step.answers.map((a) => a[0]));
            setChecked(step.answers.map(() => true));
            setRevealed(true);
            onDone?.({ attempts, hints: 0, revealed: true });
          }}
        >
          Show me the answer
        </button>
      )}
      {locked && !test && <RunIt sql={filled} dataset={step.dataset ?? dataset} label="Run the completed query" />}
    </div>
  );
}

// ---------------------------------------------------------------- Parsons (put lines in order)
function seededShuffle<T>(arr: T[], seedStr: string): T[] {
  let seed = 0;
  for (const c of seedStr) seed = (seed * 31 + c.charCodeAt(0)) | 0;
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const j = seed % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function ParsonsView({ step, dataset, done, onDone, test }: GradedProps & { step: ParsonsStep }) {
  const all = useMemo(() => {
    const items = [...step.lines.map((l, i) => ({ text: l, key: `l${i}`, correct: i })), ...(step.distractors ?? []).map((d, i) => ({ text: d, key: `d${i}`, correct: -1 }))];
    let shuffled = seededShuffle(items, step.id);
    if (shuffled.every((x, i) => x.correct === i)) shuffled = [...shuffled.slice(1), shuffled[0]];
    return shuffled;
  }, [step]);
  const solvedOrder = step.lines.map((_, i) => `l${i}`);
  const [placed, setPlaced] = useState<string[]>(done && !test ? solvedOrder : []);
  const [result, setResult] = useState<null | boolean>(done && !test ? true : null);
  const [attempts, setAttempts] = useState(0);
  const fb = useFeedbackSound();
  const locked = result === true || (!!test && result !== null);
  const byKey = (k: string) => all.find((x) => x.key === k)!;
  const pool = all.filter((x) => !placed.includes(x.key));

  const submit = () => {
    const ok = placed.length === step.lines.length && placed.every((k, i) => k === `l${i}`);
    const n = attempts + 1;
    setAttempts(n);
    setResult(ok);
    fb(ok);
    if (test) test.onAnswer(ok, placed.map((k) => byKey(k).text).join('\n'));
    else if (ok) onDone?.({ attempts: n, hints: 0, revealed: false });
  };
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= placed.length) return;
    const p = [...placed];
    [p[i], p[j]] = [p[j], p[i]];
    setPlaced(p);
    setResult(null);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-xs font-bold tracking-wide text-primary uppercase">🧩 Put the lines in order</div>
      <Markdown md={step.prompt} className="text-fg" />
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <div className="mb-1.5 text-xs font-semibold text-muted">Tap a line to add it ↓</div>
          <div className="min-h-24 space-y-1.5 rounded-xl border-2 border-dashed border-line p-2">
            {pool.map((x) => (
              <button
                key={x.key}
                disabled={locked}
                onClick={() => {
                  setPlaced((p) => [...p, x.key]);
                  setResult(null);
                }}
                className="block w-full rounded-lg border border-line bg-surface px-3 py-2 text-left font-mono text-[13px] shadow-sm transition hover:-translate-y-0.5 hover:border-primary/60"
              >
                {x.text}
              </button>
            ))}
            {pool.length === 0 && <div className="py-6 text-center text-xs text-muted">All lines used</div>}
          </div>
        </div>
        <div>
          <div className="mb-1.5 text-xs font-semibold text-muted">Your query (tap ✕ to remove)</div>
          <div className={`min-h-24 space-y-1.5 rounded-xl border-2 p-2 ${!test && result === true ? 'border-success bg-success-soft/40' : !test && result === false ? 'border-danger/60' : 'border-primary/30 bg-primary-soft/30'}`}>
            {placed.map((k, i) => (
              <div key={k} className="flex items-center gap-1 rounded-lg border border-line bg-surface px-2 py-1.5 font-mono text-[13px]">
                <span className="w-5 text-right text-[11px] text-muted">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate px-1">{byKey(k).text}</span>
                {!locked && (
                  <>
                    <button className="rounded px-1 text-muted hover:bg-surface-2 hover:text-fg" onClick={() => move(i, -1)} aria-label="Move up">
                      ↑
                    </button>
                    <button className="rounded px-1 text-muted hover:bg-surface-2 hover:text-fg" onClick={() => move(i, 1)} aria-label="Move down">
                      ↓
                    </button>
                    <button
                      className="rounded px-1 text-muted hover:bg-danger-soft hover:text-danger"
                      onClick={() => {
                        setPlaced((p) => p.filter((x) => x !== k));
                        setResult(null);
                      }}
                      aria-label="Remove"
                    >
                      <X size={13} />
                    </button>
                  </>
                )}
              </div>
            ))}
            {placed.length === 0 && <div className="py-6 text-center text-xs text-muted">Lines you pick appear here</div>}
          </div>
        </div>
      </div>
      {!locked && (
        <button className="btn btn-primary" disabled={placed.length === 0} onClick={submit}>
          {test ? 'Submit answer' : 'Check order'}
        </button>
      )}
      {test && result !== null && <Saved />}
      {!test && result !== null && (
        <Feedback
          ok={result}
          explanation={step.explanation ?? (result ? undefined : (step.distractors?.length ? 'Check the order of clauses — and whether every line belongs in the query.' : 'Check the order of the clauses.'))}
          retry={!result && attempts < 3}
        />
      )}
      {!test && result === false && attempts >= 2 && (
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => {
            setPlaced(solvedOrder);
            setResult(true);
            onDone?.({ attempts, hints: 0, revealed: true });
          }}
        >
          Show me the answer
        </button>
      )}
      {locked && !test && step.runnable !== false && <RunIt sql={step.lines.join('\n')} dataset={step.dataset ?? dataset} />}
    </div>
  );
}
