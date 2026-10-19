import { ArrowLeft, CheckCircle2, ChevronDown, XCircle } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CodeBlock } from '../components/CodeBlock.tsx';
import { Markdown } from '../components/Markdown.tsx';
import { Empty, Page, ProgressRing } from '../components/ui.tsx';
import { findItem, lessonLocation, useAllModules } from '../content/load.ts';
import type { Step } from '../content/types.ts';
import { friendlyDate } from '../lib/dates.ts';
import { useStore, type TestItemResult } from '../state/store.ts';

function correctAnswer(step: Step): { sql?: string; text?: string } {
  switch (step.type) {
    case 'exercise':
      return { sql: step.solution.trim() };
    case 'quiz':
      return { text: (Array.isArray(step.answer) ? step.answer : [step.answer]).map((a) => step.options[a]).join(' · ') };
    case 'predict':
      return { text: step.options[step.answer] };
    case 'fill': {
      let k = 0;
      return { sql: step.template.replace(/___/g, () => step.answers[k++][0]).trim() };
    }
    case 'parsons':
      return { sql: step.lines.join('\n') };
    default:
      return {};
  }
}

function questionText(step: Step): string {
  switch (step.type) {
    case 'exercise':
    case 'fill':
    case 'parsons':
      return step.prompt;
    case 'quiz':
    case 'predict':
      return step.question;
    default:
      return '';
  }
}

function ItemReview({ r, n }: { r: TestItemResult; n: number }) {
  const mods = useAllModules();
  const [open, setOpen] = useState(!r.correct);
  const f = mods ? findItem(mods, r.id) : undefined;
  const step = f?.item as Step | undefined;
  const ans = step ? correctAnswer(step) : {};
  const response = (() => {
    if (!step || r.response === undefined) return undefined;
    if (step.type === 'quiz')
      return r.response
        .split(',')
        .filter(Boolean)
        .map((i) => step.options[Number(i)])
        .join(' · ');
    if (step.type === 'predict') return step.options[Number(r.response)];
    return r.response;
  })();
  const explanation = step && 'explanation' in step ? step.explanation : undefined;
  return (
    <div className={`card overflow-hidden ${r.correct ? '' : 'border-danger/30'}`}>
      <button className="flex w-full items-center gap-3 p-4 text-left" onClick={() => setOpen((o) => !o)}>
        {r.correct ? <CheckCircle2 className="shrink-0 text-success" size={20} /> : <XCircle className="shrink-0 text-danger" size={20} />}
        <span className="text-xs font-bold text-muted">Q{n}</span>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{step ? questionText(step).replace(/[`*#>]/g, '').split('\n')[0] : r.id}</span>
        <ChevronDown size={16} className={`text-muted transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && step && (
        <div className="space-y-3 border-t border-line p-4">
          <Markdown md={questionText(step)} />
          {'sql' in step && step.sql && <CodeBlock sql={step.sql.trim()} />}
          {response !== undefined && (
            <div>
              <div className="mb-1 text-xs font-semibold text-muted">Your answer</div>
              {step.type === 'exercise' || step.type === 'parsons' ? <CodeBlock sql={response || '(empty)'} /> : <div className="rounded-lg bg-surface-2 px-3 py-2 text-sm">{response || '(empty)'}</div>}
            </div>
          )}
          <div>
            <div className="mb-1 text-xs font-semibold text-success-fg">{step.type === 'exercise' ? 'A correct solution' : 'Correct answer'}</div>
            {ans.sql ? <CodeBlock sql={ans.sql} /> : <div className="rounded-lg bg-success-soft px-3 py-2 text-sm">{ans.text}</div>}
          </div>
          {explanation && (
            <div className="rounded-xl bg-primary-soft/50 p-3 text-sm">
              <Markdown md={explanation} />
            </div>
          )}
          {f?.lesson && (
            <Link to={`/lesson/${f.lesson.id}`} className="inline-block text-sm font-semibold text-primary">
              Revisit lesson: {f.lesson.title} →
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

export default function TestResult() {
  const { attemptId } = useParams();
  const t = useStore((s) => s.tests.find((x) => x.id === attemptId));
  if (!t) {
    return (
      <Page>
        <Empty icon="🤔" title="Test not found" />
      </Page>
    );
  }
  const byLesson = new Map<string, { c: number; n: number }>();
  for (const it of t.items) {
    const e = byLesson.get(it.lesson) ?? { c: 0, n: 0 };
    e.n++;
    if (it.correct) e.c++;
    byLesson.set(it.lesson, e);
  }
  const pass = t.score >= 70;
  const msg = t.score >= 90 ? 'Outstanding! 🌟' : t.score >= 70 ? 'Great job — you passed! 🎉' : t.score >= 50 ? 'Good effort — a little more review and you’ll ace it. 💪' : "Tough one! That's how learning works — review the misses below. 🌱";

  return (
    <Page>
      <Link to="/tests" className="mb-4 inline-flex items-center gap-1 text-sm font-semibold text-muted hover:text-fg">
        <ArrowLeft size={15} /> Tests
      </Link>
      <div className="card overflow-hidden">
        <div className={`flex flex-col items-center gap-5 p-6 sm:flex-row ${pass ? 'bg-success-soft' : 'bg-warn-soft'}`}>
          <ProgressRing value={t.score / 100} size={110} stroke={10} color={pass ? 'var(--c-success)' : 'var(--c-accent)'}>
            <span className="text-2xl font-extrabold">{t.score}%</span>
          </ProgressRing>
          <div className="text-center sm:text-left">
            <div className="text-sm font-semibold text-muted">
              {t.title} · {friendlyDate(t.finishedAt)}
            </div>
            <h1 className="text-2xl font-extrabold">{msg}</h1>
            <p className="mt-1 text-sm text-fg-2">
              {t.correct} of {t.total} correct · +{t.xp} XP. Every question you missed has been added to your Daily Review for tomorrow.
            </p>
          </div>
        </div>
        <div className="p-6">
          <h2 className="mb-3 font-bold">By topic</h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {[...byLesson.entries()].map(([lid, e]) => {
              const l = lessonLocation(lid);
              const pct = e.c / e.n;
              return (
                <Link key={lid} to={`/lesson/${lid}`} className="flex items-center gap-3 rounded-xl border border-line px-3 py-2 hover:border-primary/40">
                  <span>{l?.module.icon}</span>
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">{l?.lesson.title ?? lid}</span>
                  <span className={`text-xs font-bold ${pct >= 0.7 ? 'text-success-fg' : 'text-danger-fg'}`}>
                    {e.c}/{e.n}
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      </div>
      <h2 className="mt-8 mb-3 text-lg font-bold">Question by question</h2>
      <div className="space-y-2">
        {t.items.map((r, i) => (
          <ItemReview key={r.id} r={r} n={i + 1} />
        ))}
      </div>
    </Page>
  );
}
