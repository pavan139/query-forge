import { ArrowDown, ArrowRight, Bookmark, BookmarkCheck, CheckCircle2, ChevronLeft, Clock, NotebookPen, PartyPopper, SkipForward, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { CodeBlock } from '../components/CodeBlock.tsx';
import { STEP_LABEL, StepView } from '../components/steps/StepView.tsx';
import { Page } from '../components/ui.tsx';
import { lessonDataset, lessonLocation, nextLessonId, useModule, isGraded } from '../content/load.ts';
import type { Step } from '../content/types.ts';
import { subscribe } from '../lib/events.ts';
import { useStore, type StepKind } from '../state/store.ts';

function stepKey(lessonId: string, s: Step, i: number) {
  return 'id' in s && s.id ? s.id : `${lessonId}#${i}`;
}

export default function LessonPage() {
  const { lessonId = '' } = useParams();
  const loc = lessonLocation(lessonId);
  const mod = useModule(loc?.module.id);
  const lesson = mod?.lessons.find((l) => l.id === lessonId);
  const progress = useStore((s) => s.lessons[lessonId]);
  const steps = useStore((s) => s.steps);
  const setLessonStep = useStore((s) => s.setLessonStep);
  const completeStep = useStore((s) => s.completeStep);
  const completeLesson = useStore((s) => s.completeLesson);
  const bookmarks = useStore((s) => s.bookmarks);
  const toggleBookmark = useStore((s) => s.toggleBookmark);
  const note = useStore((s) => s.notes[lessonId] ?? '');
  const setNote = useStore((s) => s.setNote);
  const nav = useNavigate();
  const [sessionXp, setSessionXp] = useState(0);
  const [showNotes, setShowNotes] = useState(false);
  const stepRefs = useRef<(HTMLDivElement | null)[]>([]);
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => subscribe((e) => e.type === 'xp' && setSessionXp((x) => x + e.amount)), []);
  useEffect(() => setSessionXp(0), [lessonId]);
  useEffect(() => {
    if (lesson && !progress) setLessonStep(lessonId, 0);
  }, [lesson, progress, lessonId, setLessonStep]);

  const total = lesson?.steps.length ?? 0;
  const completed = !!progress?.completed;
  const revealedUpTo = completed ? total - 1 : Math.min(total - 1, progress?.maxStep ?? 0);
  const keys = useMemo(() => lesson?.steps.map((s, i) => stepKey(lessonId, s, i)) ?? [], [lesson, lessonId]);
  const doneCount = keys.filter((k) => steps[k]?.done).length;

  if (!loc) return <Page>Lesson not found.</Page>;
  if (!mod || !lesson) {
    return (
      <Page>
        <div className="h-8 w-64 animate-pulse rounded-lg bg-surface-3" />
        <div className="mt-6 h-64 animate-pulse rounded-2xl bg-surface-2" />
      </Page>
    );
  }

  const next = nextLessonId(lessonId);
  const nextLoc = next ? lessonLocation(next) : undefined;
  const isCurrent = (i: number) => i === revealedUpTo && !completed;
  const atEnd = revealedUpTo === total - 1;

  const advance = (i: number) => {
    const s = lesson.steps[i];
    const k = keys[i];
    if (!isGraded(s) && !steps[k]?.done) completeStep({ id: k, kind: s.type as StepKind, ref: lessonId, attempts: 1, hints: 0 });
    if (i === total - 1) {
      const exerciseKeys = lesson.steps.map((st, j) => (st.type === 'exercise' ? keys[j] : null)).filter(Boolean) as string[];
      const st = useStore.getState().steps;
      const perfect = exerciseKeys.length > 0 && exerciseKeys.every((x) => st[x]?.firstTry);
      completeLesson(lessonId, perfect);
      setTimeout(() => endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
      return;
    }
    setLessonStep(lessonId, i + 1);
    setTimeout(() => stepRefs.current[i + 1]?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
  };

  return (
    <div className="min-h-full pb-24">
      {/* Sticky lesson bar */}
      <div className="sticky top-0 z-20 border-b border-line bg-surface/90 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center gap-3 px-4 py-2.5">
          <Link to={`/learn/${mod.id}`} className="btn btn-ghost btn-sm !px-2" title="Back to module">
            <X size={18} />
          </Link>
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-semibold text-muted">
              {mod.icon} {mod.title}
            </div>
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-surface-3">
              <div className="h-full rounded-full bg-gradient-to-r from-primary to-pink transition-all duration-500" style={{ width: `${((completed ? total : revealedUpTo) / total) * 100}%` }} />
            </div>
          </div>
          {sessionXp > 0 && <span className="chip bg-accent-soft font-bold text-accent">+{sessionXp} XP</span>}
          <button className="btn btn-ghost btn-sm !px-2" onClick={() => setShowNotes((v) => !v)} title="My notes">
            <NotebookPen size={18} className={note ? 'text-primary' : ''} />
          </button>
          <button className="btn btn-ghost btn-sm !px-2" onClick={() => toggleBookmark(lessonId)} title="Bookmark this lesson">
            {bookmarks.includes(lessonId) ? <BookmarkCheck size={18} className="text-primary" /> : <Bookmark size={18} />}
          </button>
        </div>
        {showNotes && (
          <div className="mx-auto max-w-4xl px-4 pb-3">
            <textarea
              value={note}
              onChange={(e) => setNote(lessonId, e.target.value)}
              placeholder="Write notes in your own words — explaining things to yourself is one of the best ways to remember them."
              className="h-28 w-full rounded-xl border border-line bg-surface p-3 text-sm outline-none focus:border-primary"
            />
          </div>
        )}
      </div>

      <div className="mx-auto max-w-4xl px-4 pt-6">
        <div className="mb-6">
          <div className="text-xs font-bold tracking-widest text-primary uppercase">
            Lesson {loc.index + 1} of {mod.lessons.length}
          </div>
          <h1 className="mt-1 text-3xl font-extrabold tracking-tight">{lesson.title}</h1>
          <p className="mt-1 text-muted">{lesson.summary}</p>
          <div className="mt-2 flex gap-3 text-xs text-muted">
            <span className="flex items-center gap-1">
              <Clock size={12} /> ~{lesson.minutes} min
            </span>
            <span>
              {doneCount}/{total} steps done
            </span>
          </div>
        </div>

        <div className="space-y-5">
          {lesson.steps.slice(0, revealedUpTo + 1).map((s, i) => {
            const k = keys[i];
            const done = !!steps[k]?.done;
            const graded = isGraded(s);
            const lbl = STEP_LABEL[s.type];
            const current = isCurrent(i);
            return (
              <div
                key={k}
                ref={(el) => {
                  stepRefs.current[i] = el;
                }}
                className={`card scroll-mt-24 p-5 sm:p-6 ${current ? 'animate-fade-up ring-2 ring-primary/30' : ''}`}
              >
                <div className="mb-3 flex items-center gap-2">
                  <span className={`chip ${graded ? 'bg-primary-soft text-primary' : ''}`}>
                    {lbl.icon} {lbl.label}
                  </span>
                  {graded && done && (
                    <span className="chip bg-success-soft text-success-fg">
                      <CheckCircle2 size={12} /> {steps[k]?.revealed ? 'Seen solution' : 'Done'}
                    </span>
                  )}
                  <span className="ml-auto text-[11px] text-muted">
                    {i + 1}/{total}
                  </span>
                </div>
                <StepView
                  step={s}
                  dataset={lessonDataset(mod, lesson, 'dataset' in s ? s : undefined)}
                  done={done}
                  draftKey={s.type === 'exercise' ? k : undefined}
                  onDone={(r) => completeStep({ id: k, kind: s.type as StepKind, ref: lessonId, attempts: r.attempts, hints: r.hints, revealed: r.revealed })}
                />
                {current && (
                  <div className="mt-5 flex items-center justify-end gap-3 border-t border-line pt-4">
                    {graded && !done && (
                      <button className="btn btn-ghost btn-sm text-muted" onClick={() => advance(i)} title="Skip for now — it won't count as solved">
                        <SkipForward size={14} /> Skip for now
                      </button>
                    )}
                    <button className="btn btn-primary" disabled={graded && !done} onClick={() => advance(i)}>
                      {i === total - 1 ? 'Finish lesson' : 'Continue'} {i === total - 1 ? <PartyPopper size={16} /> : <ArrowDown size={16} />}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {completed && (
          <div ref={endRef} className="animate-pop card mt-8 scroll-mt-24 overflow-hidden">
            <div className="gradient-hero p-6 text-center text-white">
              <div className="text-5xl">🎉</div>
              <h2 className="mt-2 text-2xl font-extrabold">Lesson complete!</h2>
              <p className="opacity-90">{lesson.title}</p>
            </div>
            <div className="space-y-5 p-6">
              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="rounded-xl bg-surface-2 p-3">
                  <div className="text-2xl font-extrabold text-accent">+{sessionXp}</div>
                  <div className="text-xs text-muted">XP this visit</div>
                </div>
                <div className="rounded-xl bg-surface-2 p-3">
                  <div className="text-2xl font-extrabold">{doneCount}</div>
                  <div className="text-xs text-muted">steps done</div>
                </div>
                <div className="rounded-xl bg-surface-2 p-3">
                  <div className="text-2xl font-extrabold">{keys.filter((k, i) => lesson.steps[i].type === 'exercise' && steps[k]?.firstTry).length}</div>
                  <div className="text-xs text-muted">first-try solves</div>
                </div>
              </div>
              <p className="text-center text-sm text-muted">The exercises you solved will show up in your Daily Review over the coming days so they stick. 🧠</p>
              {lesson.cheatsheet && lesson.cheatsheet.length > 0 && (
                <div>
                  <div className="mb-2 font-bold">📌 Remember</div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {lesson.cheatsheet.map((c, i) => (
                      <div key={i} className="rounded-xl border border-line p-3">
                        <div className="mb-1 text-sm font-semibold">{c.title}</div>
                        <CodeBlock sql={c.sql.trim()} />
                        {c.note && <div className="mt-1 text-xs text-muted">{c.note}</div>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="flex flex-col gap-2 sm:flex-row sm:justify-between">
                <Link to={`/learn/${mod.id}`} className="btn btn-outline">
                  <ChevronLeft size={16} /> Module overview
                </Link>
                {next && nextLoc ? (
                  <button className="btn btn-primary btn-lg" onClick={() => nav(`/lesson/${next}`)}>
                    Next: {nextLoc.lesson.title} <ArrowRight size={18} />
                  </button>
                ) : (
                  <Link to="/certificate" className="btn btn-primary btn-lg">
                    🎓 See your certificate
                  </Link>
                )}
              </div>
            </div>
          </div>
        )}
        {!completed && atEnd && null}
      </div>
    </div>
  );
}
