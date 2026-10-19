import { CalendarCheck, CalendarClock, ClipboardList, Crown, History, Play, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ScoreLine } from '../components/charts/Charts.tsx';
import { Page, PageHeader } from '../components/ui.tsx';
import { courseIndex, loadAllModules, loadModule } from '../content/load.ts';
import { friendlyDate } from '../lib/dates.ts';
import { toast } from '../lib/events.ts';
import { useTestBadges } from '../lib/hooks.ts';
import { useStore, type TestKind } from '../state/store.ts';
import { buildTest, SIZES } from '../state/tests.ts';

export async function startTestFlow(opts: { kind: TestKind; title: string; slot?: number; moduleId?: string; moduleIds?: string[]; size?: number }): Promise<boolean> {
  const mods = opts.kind === 'module' ? [await loadModule(opts.moduleId!)] : await loadAllModules();
  const state = useStore.getState();
  const id = `${opts.kind}-${opts.slot ?? opts.moduleId ?? 'p'}-${Date.now().toString(36)}`;
  const items = buildTest(mods, state, { kind: opts.kind, seed: id, moduleId: opts.moduleId, moduleIds: opts.moduleIds, size: opts.size });
  if (!items.length) {
    toast('Finish at least one lesson first — tests are built from what you have learned.', 'error');
    return false;
  }
  state.startTest({
    id,
    kind: opts.kind,
    slot: opts.slot,
    moduleId: opts.moduleId,
    title: opts.title,
    items: items.map((i) => ({ id: i.id, module: i.module, lesson: i.lesson, type: i.type })),
  });
  return true;
}

export default function Tests() {
  const tests = useStore((s) => s.tests);
  const active = useStore((s) => s.activeTest);
  const lessons = useStore((s) => s.lessons);
  const { weekly, monthly } = useTestBadges();
  const nav = useNavigate();
  const anyLesson = Object.values(lessons).some((l) => l.completed);
  const learnedModules = courseIndex.modules.filter((m) => m.lessons.some((l) => lessons[l.id]?.completed));
  const [picked, setPicked] = useState<string[]>([]);
  const [size, setSize] = useState(10);
  const [busy, setBusy] = useState(false);

  const go = async (opts: Parameters<typeof startTestFlow>[0]) => {
    if (active && !confirm('You already have a test in progress. Start a new one and discard it?')) return;
    setBusy(true);
    try {
      if (await startTestFlow(opts)) nav('/tests/run');
    } finally {
      setBusy(false);
    }
  };

  const slotCard = (t: typeof weekly) => {
    const isWeekly = t.kind === 'weekly';
    const Icon = isWeekly ? CalendarCheck : CalendarClock;
    return (
      <div className={`card relative overflow-hidden p-6 ${t.available && anyLesson ? 'ring-2 ring-pink/50' : ''}`}>
        <div className="absolute -top-6 -right-6 text-8xl opacity-10">{isWeekly ? '📝' : '🗂️'}</div>
        <div className="flex items-center gap-2 text-sm font-bold text-muted">
          <Icon size={16} /> {isWeekly ? 'Every 7 days' : 'Every 4 weeks'}
        </div>
        <h2 className="mt-1 text-xl font-extrabold">{isWeekly ? 'Weekly test' : 'Monthly test'}</h2>
        <p className="mt-1 text-sm text-muted">
          {isWeekly
            ? `${SIZES.weekly} questions focused on this week's lessons, plus a few older topics you find tricky.`
            : `${SIZES.monthly} questions across everything you've learned, weighted towards your weak spots.`}
        </p>
        <div className="mt-4">
          {!anyLesson ? (
            <div className="text-sm text-muted">Complete your first lesson to unlock tests.</div>
          ) : t.available ? (
            <button className="btn btn-primary" disabled={busy} onClick={() => go({ kind: t.kind, slot: t.slot, title: `${isWeekly ? 'Weekly' : 'Monthly'} test #${t.slot}` })}>
              <Play size={16} /> Start {isWeekly ? 'weekly' : 'monthly'} test #{t.slot}
            </button>
          ) : (
            <div className="space-y-1 text-sm">
              {t.attempt && (
                <div>
                  ✅ Test #{t.slot} done — <b>{t.attempt.score}%</b>{' '}
                  <Link className="font-semibold text-primary" to={`/tests/result/${t.attempt.id}`}>
                    view
                  </Link>
                </div>
              )}
              <div className="text-muted">
                Next one unlocks <b>{friendlyDate(t.nextUnlockDay)}</b> ({t.daysUntil} day{t.daysUntil === 1 ? '' : 's'}).
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  const history = [...tests].reverse();
  return (
    <Page>
      <PageHeader icon="📝" title="Tests" subtitle="Regular tests are the secret to not forgetting. Missed questions come back in your daily review." />
      {active && (
        <Link to="/tests/run" className="card mb-6 flex items-center gap-3 border-primary/40 bg-primary-soft p-4">
          <ClipboardList className="text-primary" />
          <div className="flex-1">
            <div className="font-bold">Test in progress: {active.title}</div>
            <div className="text-xs text-muted">
              {Object.keys(active.answers).length}/{active.items.length} answered
            </div>
          </div>
          <span className="btn btn-primary btn-sm">Resume</span>
        </Link>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        {slotCard(weekly)}
        {slotCard(monthly)}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section className="card p-6">
          <h2 className="flex items-center gap-2 text-lg font-bold">
            <Crown size={18} className="text-accent" /> Module mastery tests
          </h2>
          <p className="mb-3 text-sm text-muted">Prove you've mastered a module (70%+ earns a crown).</p>
          {learnedModules.length === 0 && <div className="text-sm text-muted">Start a module to unlock its mastery test.</div>}
          <div className="space-y-1.5">
            {learnedModules.map((m) => {
              const best = Math.max(-1, ...tests.filter((t) => t.kind === 'module' && t.moduleId === m.id).map((t) => t.score));
              return (
                <div key={m.id} className="flex items-center gap-3 rounded-xl border border-line px-3 py-2">
                  <span className="text-xl">{m.icon}</span>
                  <span className="flex-1 truncate text-sm font-semibold">{m.title}</span>
                  {best >= 0 && <span className={`text-xs font-bold ${best >= 70 ? 'text-success-fg' : 'text-muted'}`}>{best >= 70 ? '👑 ' : ''}{best}%</span>}
                  <button className="btn btn-outline btn-sm" disabled={busy} onClick={() => go({ kind: 'module', moduleId: m.id, title: `${m.title} — Mastery test` })}>
                    {best >= 0 ? 'Retake' : 'Start'}
                  </button>
                </div>
              );
            })}
          </div>
        </section>

        <section className="card p-6">
          <h2 className="flex items-center gap-2 text-lg font-bold">
            <Sparkles size={18} className="text-primary" /> Practice test
          </h2>
          <p className="mb-3 text-sm text-muted">Build your own quiz any time. Doesn't replace the weekly test.</p>
          <div className="flex flex-wrap gap-1.5">
            {learnedModules.map((m) => (
              <button
                key={m.id}
                onClick={() => setPicked((p) => (p.includes(m.id) ? p.filter((x) => x !== m.id) : [...p, m.id]))}
                className={`chip cursor-pointer !py-1 ${picked.includes(m.id) ? '!bg-primary !text-primary-fg' : ''}`}
              >
                {m.icon} {m.title.split(/[:—]/)[0]}
              </button>
            ))}
          </div>
          <div className="mt-4 flex items-center gap-3">
            <label className="text-sm font-semibold">Questions</label>
            {[5, 10, 20].map((n) => (
              <button key={n} className={`btn btn-sm ${size === n ? 'btn-primary' : 'btn-outline'}`} onClick={() => setSize(n)}>
                {n}
              </button>
            ))}
          </div>
          <button className="btn btn-primary mt-4" disabled={!picked.length || busy} onClick={() => go({ kind: 'practice', moduleIds: picked, size, title: 'Practice test' })}>
            <Play size={16} /> Start practice test
          </button>
        </section>
      </div>

      <section className="card mt-6 p-6">
        <h2 className="mb-3 flex items-center gap-2 text-lg font-bold">
          <History size={18} /> Your test history
        </h2>
        <ScoreLine points={tests.filter((t) => t.kind !== 'practice').map((t) => ({ label: t.title, score: t.score }))} />
        {history.length > 0 && (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th className="py-2">Test</th>
                  <th>Date</th>
                  <th>Score</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {history.map((t) => (
                  <tr key={t.id} className="border-t border-line">
                    <td className="py-2 font-semibold">{t.title}</td>
                    <td className="text-muted">{friendlyDate(t.finishedAt)}</td>
                    <td>
                      <span className={`font-bold ${t.score >= 70 ? 'text-success-fg' : 'text-danger-fg'}`}>{t.score}%</span>{' '}
                      <span className="text-xs text-muted">
                        ({t.correct}/{t.total})
                      </span>
                    </td>
                    <td className="text-right">
                      <Link to={`/tests/result/${t.id}`} className="text-xs font-semibold text-primary">
                        Review →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </Page>
  );
}
