import { Loader2, Play } from 'lucide-react';
import { lazy, Suspense, useState } from 'react';
import type { ExampleStep, ExerciseStep, ReadStep, Step, StepperStep, VizStep } from '../../content/types.ts';
import { db } from '../../db/client.ts';
import type { RunOutput } from '../../db/engine.ts';
import { CodeBlock } from '../CodeBlock.tsx';
import { Markdown } from '../Markdown.tsx';
import { ResultsPanel } from '../ResultsPanel.tsx';
import { Workbench, type PassInfo } from '../Workbench.tsx';
import { FillView, ParsonsView, PredictView, QuizView, type GradedProps } from './QuizSteps.tsx';

const JoinViz = lazy(() => import('../viz/JoinViz.tsx').then((m) => ({ default: m.JoinViz })));
const GroupByViz = lazy(() => import('../viz/GroupByViz.tsx').then((m) => ({ default: m.GroupByViz })));
const WindowViz = lazy(() => import('../viz/WindowViz.tsx').then((m) => ({ default: m.WindowViz })));
const IndexViz = lazy(() => import('../viz/IndexViz.tsx').then((m) => ({ default: m.IndexViz })));
const TransactionViz = lazy(() => import('../viz/TransactionViz.tsx').then((m) => ({ default: m.TransactionViz })));
const ExecutionOrderViz = lazy(() => import('../viz/SmallViz.tsx').then((m) => ({ default: m.ExecutionOrderViz })));
const NullLogicViz = lazy(() => import('../viz/SmallViz.tsx').then((m) => ({ default: m.NullLogicViz })));
const SetOpsViz = lazy(() => import('../viz/SmallViz.tsx').then((m) => ({ default: m.SetOpsViz })));

export interface StepViewProps {
  step: Step;
  dataset: string;
  done: boolean;
  draftKey?: string;
  onDone: (r: { attempts: number; hints: number; revealed: boolean }) => void;
  test?: GradedProps['test'];
}

export const STEP_LABEL: Record<Step['type'], { label: string; icon: string }> = {
  read: { label: 'Read', icon: '📖' },
  example: { label: 'Example', icon: '▶️' },
  exercise: { label: 'Your turn', icon: '✍️' },
  quiz: { label: 'Quick check', icon: '❓' },
  predict: { label: 'Predict', icon: '🔮' },
  fill: { label: 'Fill in', icon: '✏️' },
  parsons: { label: 'Order it', icon: '🧩' },
  viz: { label: 'Explore', icon: '🎛️' },
  stepper: { label: 'Step by step', icon: '🪜' },
};

export function StepView({ step, dataset, done, draftKey, onDone, test }: StepViewProps) {
  const ds = ('dataset' in step && step.dataset) || dataset;
  switch (step.type) {
    case 'read':
      return <ReadView step={step} />;
    case 'example':
      return <ExampleView step={step} dataset={ds} onRan={() => onDone({ attempts: 1, hints: 0, revealed: false })} />;
    case 'exercise':
      return <ExerciseView step={step} dataset={ds} done={done} draftKey={draftKey} onDone={onDone} test={test} />;
    case 'quiz':
      return <QuizView step={step} dataset={ds} done={done} onDone={onDone} test={test} />;
    case 'predict':
      return <PredictView step={step} dataset={ds} done={done} onDone={onDone} test={test} />;
    case 'fill':
      return <FillView step={step} dataset={ds} done={done} onDone={onDone} test={test} />;
    case 'parsons':
      return <ParsonsView step={step} dataset={ds} done={done} onDone={onDone} test={test} />;
    case 'viz':
      return <VizView step={step} />;
    case 'stepper':
      return <StepperView step={step} dataset={ds} />;
  }
}

function ReadView({ step }: { step: ReadStep }) {
  return (
    <div>
      {step.title && <h3 className="mb-2 text-lg font-bold">{step.title}</h3>}
      <Markdown md={step.md} />
    </div>
  );
}

function ExampleView({ step, dataset, onRan }: { step: ExampleStep; dataset: string; onRan: () => void }) {
  const [ran, setRan] = useState(false);
  return (
    <div className="space-y-3">
      {step.title && <h3 className="text-lg font-bold">{step.title}</h3>}
      {step.md && <Markdown md={step.md} />}
      <Workbench
        dataset={dataset}
        initialSql={step.sql.trim()}
        mode="example"
        onRunDone={() => {
          if (!ran) onRan();
          setRan(true);
        }}
      />
      {ran && step.after && (
        <div className="animate-fade-up rounded-xl border-l-4 border-primary bg-primary-soft/50 px-4 py-3">
          <Markdown md={step.after} />
        </div>
      )}
      {!ran && <p className="text-xs text-muted">Press <b>Run</b> (or <kbd>Ctrl</kbd>+<kbd>Enter</kbd>) to see the result. Feel free to change the query and run it again!</p>}
    </div>
  );
}

function ExerciseView({ step, dataset, done, draftKey, onDone, test }: { step: ExerciseStep; dataset: string; done: boolean; draftKey?: string; onDone: StepViewProps['onDone']; test?: GradedProps['test'] }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        {step.title && <h3 className="text-lg font-bold">{step.title}</h3>}
        {step.difficulty && !test && <Difficulty d={step.difficulty} />}
      </div>
      <Markdown md={step.prompt} className="text-fg" />
      <Workbench
        draftKey={draftKey}
        dataset={dataset}
        initialSql={(step.starter ?? '').trim()}
        setup={step.setup}
        exercise={step}
        mode={test ? 'test' : 'exercise'}
        solved={done && !test}
        onPass={(p: PassInfo) => onDone({ attempts: p.attempts, hints: p.hints, revealed: p.revealed })}
        onSubmit={(correct, sql) => test?.onAnswer(correct, sql)}
        showSchema={typeof window !== 'undefined' && window.innerWidth >= 1280}
      />
    </div>
  );
}

export function Difficulty({ d }: { d: number }) {
  const label = d === 1 ? 'Warm-up' : d === 2 ? 'Practice' : 'Stretch';
  return (
    <span className="chip" title={`Difficulty ${d}/3`}>
      {'●'.repeat(d)}
      <span className="opacity-40">{'●'.repeat(3 - d)}</span> {label}
    </span>
  );
}

function VizView({ step }: { step: VizStep }) {
  const c = step.config;
  return (
    <div className="space-y-3">
      {step.title && <h3 className="text-lg font-bold">{step.title}</h3>}
      {step.md && <Markdown md={step.md} />}
      <div className="rounded-2xl border border-line bg-surface-2/50 p-4">
        <Suspense fallback={<Loader2 className="animate-spin text-muted" />}>
          {step.viz === 'join' && <JoinViz config={c} />}
          {step.viz === 'groupby' && <GroupByViz config={c} />}
          {step.viz === 'window' && <WindowViz config={c} />}
          {step.viz === 'execution-order' && <ExecutionOrderViz config={c} />}
          {step.viz === 'null-logic' && <NullLogicViz />}
          {step.viz === 'set-ops' && <SetOpsViz config={c} />}
          {step.viz === 'index' && <IndexViz config={c} />}
          {step.viz === 'transaction' && <TransactionViz config={c} />}
        </Suspense>
      </div>
    </div>
  );
}

function StepperView({ step, dataset }: { step: StepperStep; dataset: string }) {
  const [i, setI] = useState(0);
  const [runs, setRuns] = useState<Record<number, RunOutput>>({});
  const [busy, setBusy] = useState(false);
  const stage = step.stages[i];
  const run = async (k: number) => {
    setBusy(true);
    try {
      const out = await db.run(dataset, step.stages[k].sql);
      setRuns((r) => ({ ...r, [k]: out }));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-3">
      <h3 className="text-lg font-bold">{step.title}</h3>
      {step.md && <Markdown md={step.md} />}
      <div className="flex flex-wrap gap-1.5">
        {step.stages.map((s, k) => (
          <button key={k} className={`btn btn-sm ${k === i ? 'btn-primary' : runs[k] ? 'btn-outline border-success/50' : 'btn-outline'}`} onClick={() => setI(k)}>
            <span className="opacity-60">{k + 1}</span> {s.label}
          </button>
        ))}
      </div>
      <div key={i} className="animate-fade-up space-y-2 rounded-2xl border border-line bg-surface-2/40 p-4">
        <Markdown md={stage.md} />
        <CodeBlock sql={stage.sql.trim()} />
        <div className="flex gap-2">
          <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => run(i)}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />} Run stage {i + 1}
          </button>
          {i < step.stages.length - 1 && (
            <button
              className="btn btn-outline btn-sm"
              onClick={() => {
                setI(i + 1);
                void run(i + 1);
              }}
            >
              Next stage →
            </button>
          )}
        </div>
        {runs[i] && <ResultsPanel run={runs[i]} sql={stage.sql} maxHeight={260} />}
      </div>
    </div>
  );
}
