import { CheckCircle2, Columns3, Eye, KeyRound, Lightbulb, Loader2, Play, RotateCcw, Sparkles, Wand2, XCircle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { db, TimeoutError } from '../db/client.ts';
import type { CheckOutput, RunOutput } from '../db/engine.ts';
import { useStore } from '../state/store.ts';
import { playSound } from '../lib/sound.ts';
import { useShortcutLabels } from '../lib/hooks.ts';
import { Markdown } from './Markdown.tsx';
import { ErrorBox, ResultsPanel } from './ResultsPanel.tsx';
import { ResultTable } from './ResultTable.tsx';
import { SchemaPanel, useSchema } from './SchemaPanel.tsx';
import { SqlEditor, type SqlEditorHandle } from './SqlEditor.tsx';
import { CodeBlock } from './CodeBlock.tsx';

export interface ExerciseSpec {
  solution: string;
  setup?: string;
  check?: string;
  ordered?: boolean;
  columnNames?: boolean;
  hints?: string[];
  explanation?: string;
}

export interface PassInfo {
  attempts: number;
  hints: number;
  revealed: boolean;
  sql: string;
}

interface Props {
  /** Key used to save the draft (omit to not persist). */
  draftKey?: string;
  dataset: string;
  initialSql: string;
  /** Hidden SQL run before every Run (exercise setup). */
  setup?: string;
  exercise?: ExerciseSpec;
  mode?: 'example' | 'exercise' | 'playground' | 'test' | 'review';
  onPass?: (info: PassInfo) => void;
  onFail?: (info: { attempts: number; sql: string }) => void;
  /** Called after a test answer is submitted (test mode: one submission, no hints). */
  onSubmit?: (correct: boolean, sql: string) => void;
  onRunDone?: (run: RunOutput) => void;
  solved?: boolean;
  showSchema?: boolean;
  editorMinHeight?: number;
  persistent?: boolean;
  schemaVersion?: number;
  /** Disable revealing the solution (tests). */
  noSolution?: boolean;
  autoRun?: boolean;
}

type Status = 'idle' | 'running' | 'checking';

export function Workbench(p: Props) {
  const mode = p.mode ?? (p.exercise ? 'exercise' : 'example');
  const isTest = mode === 'test';
  const draft = useStore((s) => (p.draftKey ? s.drafts[p.draftKey] : undefined));
  const setDraft = useStore((s) => s.setDraft);
  const countRun = useStore((s) => s.countRun);
  const sound = useStore((s) => s.profile.sound);
  const [sql, setSql] = useState<string>(draft ?? p.initialSql);
  const [status, setStatus] = useState<Status>('idle');
  const [run, setRun] = useState<RunOutput | null>(null);
  const [ranSql, setRanSql] = useState('');
  const [check, setCheck] = useState<CheckOutput | null>(null);
  const [attempts, setAttempts] = useState(0);
  const [hintsShown, setHintsShown] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [showExpected, setShowExpected] = useState(false);
  const [expectedPreview, setExpectedPreview] = useState<CheckOutput['expected']>(null);
  const [schemaOpen, setSchemaOpen] = useState(p.showSchema ?? false);
  const [passed, setPassed] = useState(!!p.solved);
  const [submitted, setSubmitted] = useState(false);
  const [shake, setShake] = useState(false);
  const lastErrored = useRef(false);
  const editor = useRef<SqlEditorHandle>(null);
  const schema = useSchema(p.dataset, { persistent: p.persistent, version: p.schemaVersion });
  const keys = useShortcutLabels();

  useEffect(() => {
    if (p.autoRun) void doRun();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onChange = (v: string) => {
    setSql(v);
    if (p.draftKey) setDraft(p.draftKey, v);
  };

  const errorMessage = (e: unknown): RunOutput => ({
    ok: false,
    results: [],
    notices: [],
    ms: 0,
    mutated: false,
    error: { message: (e as Error).message, code: e instanceof TimeoutError ? 'TIMEOUT' : undefined },
  });

  async function doRun() {
    if (status !== 'idle') return;
    setStatus('running');
    setCheck(null);
    const text = editor.current?.getValue() ?? sql;
    try {
      const out = await db.run(p.dataset, text, { setup: p.setup ?? p.exercise?.setup, persistent: p.persistent });
      setRun(out);
      setRanSql(text);
      countRun({ error: !out.ok, fixed: out.ok && lastErrored.current, playground: mode === 'playground' });
      lastErrored.current = !out.ok;
      if (!out.ok && sound) playSound('error');
      p.onRunDone?.(out);
    } catch (e) {
      setRun(errorMessage(e));
      setRanSql(text);
    } finally {
      setStatus('idle');
    }
  }

  async function doCheck() {
    if (!p.exercise || status !== 'idle') return;
    if (isTest && submitted) return;
    setStatus('checking');
    const text = editor.current?.getValue() ?? sql;
    const n = attempts + 1;
    setAttempts(n);
    try {
      const res = await db.check({
        dataset: p.dataset,
        solution: p.exercise.solution,
        learner: text,
        setup: p.exercise.setup,
        check: p.exercise.check,
        ordered: p.exercise.ordered,
        columnNames: p.exercise.columnNames,
      });
      setCheck(res);
      setRun(res.run ?? null);
      setRanSql(text);
      if (res.expected) setExpectedPreview(res.expected);
      countRun({ error: !!res.error, fixed: !res.error && lastErrored.current });
      lastErrored.current = !!res.error;
      if (isTest) {
        setSubmitted(true);
        p.onSubmit?.(res.pass, text);
        return;
      }
      if (res.pass) {
        if (sound) playSound('success');
        setPassed(true);
        p.onPass?.({ attempts: n, hints: hintsShown, revealed, sql: text });
      } else {
        if (sound) playSound('wrong');
        setShake(true);
        setTimeout(() => setShake(false), 450);
        p.onFail?.({ attempts: n, sql: text });
      }
    } catch (e) {
      setRun(errorMessage(e));
      setRanSql(text);
    } finally {
      setStatus('idle');
    }
  }

  async function loadExpected() {
    if (!p.exercise) return;
    setShowExpected((s) => !s);
    if (expectedPreview) return;
    try {
      // Checking the solution against itself returns the expected result without touching the learner's state.
      const res = await db.check({
        dataset: p.dataset,
        solution: p.exercise.solution,
        learner: p.exercise.solution,
        setup: p.exercise.setup,
        check: p.exercise.check,
      });
      setExpectedPreview(res.expected ?? null);
    } catch {
      /* ignore */
    }
  }

  async function format() {
    const { format: fmt } = await import('sql-formatter');
    try {
      const out = fmt(editor.current?.getValue() ?? sql, { language: 'postgresql', keywordCase: 'upper', tabWidth: 4 });
      editor.current?.setValue(out);
    } catch {
      /* leave as is when it can't be parsed */
    }
  }

  function reset() {
    editor.current?.setValue(p.initialSql);
    setRun(null);
    setCheck(null);
  }

  function reveal() {
    setRevealed(true);
  }

  const hints = p.exercise?.hints ?? [];
  const busy = status !== 'idle';
  const failed = check && !check.pass && !isTest;
  const canReveal = !isTest && !p.noSolution && p.exercise && (attempts >= 2 || hintsShown >= hints.length);
  const shownSql = ranSql || sql;

  return (
    <div className="space-y-3">
      <div className={`flex flex-col gap-3 lg:flex-row ${shake ? 'animate-shake' : ''}`}>
        <div className="min-w-0 flex-1 space-y-2">
          <SqlEditor
            ref={editor}
            value={sql}
            onChange={onChange}
            onRun={doRun}
            onCheck={p.exercise ? doCheck : doRun}
            schema={schema}
            minHeight={p.editorMinHeight ?? (mode === 'example' ? 80 : 130)}
            maxHeight={520}
            errorAt={run?.error?.position ?? null}
            placeholder="Write your SQL here…"
            readOnly={isTest && submitted}
          />
          <div className="flex flex-wrap items-center gap-2">
            <button className="btn btn-primary" onClick={doRun} disabled={busy} title="Run (Ctrl/Cmd + Enter)">
              {status === 'running' ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} className="fill-current" />}
              Run
              {keys && <span className="ml-0.5 text-[11px] font-medium opacity-60">{keys.run}</span>}
            </button>
            {p.exercise && (
              <button
                className={`btn ${passed && !isTest ? 'btn-success' : 'btn-outline'}`}
                onClick={doCheck}
                disabled={busy || (isTest && submitted)}
                title="Check answer (Ctrl/Cmd + Shift + Enter)"
              >
                {status === 'checking' ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} className={passed ? '' : 'text-success'} />}
                {isTest ? (submitted ? 'Submitted' : 'Submit answer') : passed ? 'Solved · Check again' : 'Check answer'}
                {keys && !passed && !submitted && <span className="ml-0.5 hidden text-[11px] font-medium opacity-50 sm:inline">{keys.check}</span>}
              </button>
            )}
            <div className="ml-auto flex items-center gap-1">
              {p.exercise && !isTest && (
                <button className="btn btn-ghost btn-sm" onClick={loadExpected} title="See what the correct result looks like">
                  <Eye size={15} /> <span className="hidden sm:inline">Expected</span>
                </button>
              )}
              <button className="btn btn-ghost btn-sm" onClick={format} title="Tidy up formatting">
                <Wand2 size={15} /> <span className="hidden sm:inline">Format</span>
              </button>
              {!isTest && (
                <button className="btn btn-ghost btn-sm" onClick={reset} title="Reset the editor to the starting code">
                  <RotateCcw size={15} />
                </button>
              )}
              <button className={`btn btn-sm ${schemaOpen ? 'btn-outline' : 'btn-ghost'}`} onClick={() => setSchemaOpen((o) => !o)} title="Show tables & columns">
                <Columns3 size={15} /> <span className="hidden sm:inline">Tables</span>
              </button>
            </div>
          </div>
        </div>
        {schemaOpen && (
          <div className="h-72 shrink-0 lg:h-auto lg:max-h-[420px] lg:w-64">
            <SchemaPanel
              dataset={p.dataset}
              schema={schema}
              onInsert={(t) => editor.current?.insert(t)}
              onPreview={(q) => {
                editor.current?.setValue(q);
                setTimeout(doRun, 0);
              }}
            />
          </div>
        )}
      </div>

      {showExpected && p.exercise && (
        <div className="animate-fade-up space-y-1">
          <div className="text-xs font-semibold text-muted">Expected result (your query should produce this):</div>
          {expectedPreview ? <ResultTable result={expectedPreview} maxHeight={240} compact /> : <div className="text-xs text-muted">Loading…</div>}
        </div>
      )}

      {check && !check.error && !check.solutionError && (isTest ? null : check.pass ? <PassBanner explanation={p.exercise?.explanation} /> : null)}

      {failed && check?.outcome && !check.outcome.ok && (
        <div className="animate-fade-up rounded-xl border border-danger/30 bg-danger-soft p-4">
          <div className="flex items-start gap-3">
            <XCircle size={20} className="mt-0.5 shrink-0 text-danger" />
            <div className="min-w-0 flex-1">
              <div className="font-bold text-danger-fg">Not quite yet — you're close!</div>
              <p className="mt-1 text-sm text-fg-2">{check.outcome.message}</p>
              <div className="mt-3 grid gap-3 xl:grid-cols-2">
                {check.actual && <ResultTable result={check.actual} badRows={check.outcome.extraRows} maxHeight={220} compact caption="Your result (red = rows that don't match)" />}
                {check.expected && <ResultTable result={check.expected} missingRows={check.outcome.missingRows} maxHeight={220} compact caption="Expected result (green = rows you're missing)" />}
              </div>
            </div>
          </div>
        </div>
      )}

      {check?.solutionError && (
        <div className="rounded-xl border border-accent/40 bg-warn-soft p-3 text-sm">
          Sorry — this exercise has a problem on our side (its solution failed: {check.solutionError.message}). Skip it for now.
        </div>
      )}

      {run && (!check || check.error || !check.outcome || check.pass || isTest) && <ResultsPanel run={run} sql={shownSql} schema={schema} />}
      {check?.error && (!run || run.ok) && <ErrorBox error={check.error} sql={shownSql} schema={schema} />}

      {p.exercise && !isTest && (hints.length > 0 || canReveal) && !passed && (
        <div className="flex flex-col gap-2">
          {hints.slice(0, hintsShown).map((h, i) => (
            <div key={i} className="animate-fade-up flex gap-2 rounded-xl border border-accent/30 bg-accent-soft/60 px-3 py-2 text-sm">
              <Lightbulb size={16} className="mt-0.5 shrink-0 text-accent" />
              <div className="min-w-0">
                <span className="mr-1 font-semibold">Hint {i + 1}:</span>
                <Markdown md={h} inline />
              </div>
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            {hintsShown < hints.length && (
              <button className="btn btn-outline btn-sm" onClick={() => setHintsShown((n) => n + 1)}>
                <Lightbulb size={14} className="text-accent" /> {hintsShown === 0 ? 'Get a hint' : 'Another hint'} ({hints.length - hintsShown} left)
              </button>
            )}
            {canReveal && !revealed && (
              <button className="btn btn-ghost btn-sm" onClick={reveal}>
                <KeyRound size={14} /> Show me the solution
              </button>
            )}
          </div>
        </div>
      )}

      {revealed && p.exercise && !passed && (
        <div className="animate-fade-up rounded-xl border border-line bg-surface-2 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-semibold">One possible solution</span>
            <button className="btn btn-outline btn-sm" onClick={() => editor.current?.setValue(p.exercise!.solution.trim())}>
              Copy into editor
            </button>
          </div>
          <CodeBlock sql={p.exercise.solution.trim()} />
          <p className="mt-2 text-xs text-muted">
            Read it line by line, then try typing it yourself and press <b>Check</b>. This exercise will come back in your daily review so it sticks.
          </p>
        </div>
      )}
    </div>
  );
}

function PassBanner({ explanation }: { explanation?: string }) {
  return (
    <div className="animate-pop rounded-xl border border-success/40 bg-success-soft p-4">
      <div className="flex items-start gap-3">
        <div className="rounded-full bg-success p-1.5 text-white">
          <Sparkles size={16} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-bold text-success-fg">{cheer()}</div>
          {explanation && (
            <div className="mt-1 text-sm">
              <Markdown md={explanation} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const CHEERS = ['Correct! 🎉', 'Nailed it! 🙌', 'Perfect! ✨', 'You got it! 💪', 'Brilliant! 🌟', 'Spot on! 🎯', 'Exactly right! 🥳'];
function cheer() {
  return CHEERS[Math.floor(Math.random() * CHEERS.length)];
}
