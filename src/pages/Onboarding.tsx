import { ArrowRight, Brain, CalendarCheck, Laptop, Moon, Puzzle, Sun, Upload, Wand2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { LogoMark } from '../components/Logo.tsx';
import { dayKey } from '../lib/dates.ts';
import { toast } from '../lib/events.ts';
import { parseBackup, useStore, type Theme } from '../state/store.ts';

const GOALS = [
  { min: 10, xp: 30, label: 'Casual', emoji: '🌱' },
  { min: 20, xp: 50, label: 'Regular', emoji: '🌿' },
  { min: 30, xp: 80, label: 'Serious', emoji: '🌳' },
  { min: 45, xp: 120, label: 'Intense', emoji: '🚀' },
];

export function Onboarding() {
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [goal, setGoal] = useState(1);
  const theme = useStore((s) => s.profile.theme);
  const setProfile = useStore((s) => s.setProfile);
  const importData = useStore((s) => s.importData);
  const fileRef = useRef<HTMLInputElement>(null);

  const finish = () => {
    setProfile({ name: name.trim(), dailyGoal: GOALS[goal].xp, minutesGoal: GOALS[goal].min, startedAt: dayKey(), onboarded: true });
    location.hash = '#/lesson/m00-l01';
  };

  const restore = async (f: File) => {
    try {
      const data = parseBackup(await f.text());
      importData({ ...data, profile: { ...data.profile, onboarded: true } });
      toast('Welcome back! Your progress was restored.', 'success');
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-bg p-4 pt-[calc(1rem+var(--safe-top))] pb-[calc(1rem+var(--safe-bottom))]">
      <div className="animate-pop card w-full max-w-xl overflow-hidden">
        <div className="h-1 bg-surface-3">
          <div className="h-full bg-primary transition-all duration-500" style={{ width: `${((step + 1) / 4) * 100}%` }} />
        </div>
        <div className="p-6 sm:p-8">
          {step === 0 && (
            <div className="text-center">
              <div className="animate-float mx-auto w-fit">
                <LogoMark size={84} />
              </div>
              <h1 className="mt-5 text-[30px] font-bold tracking-tight">
                Welcome to SQL <span className="gradient-text">Quest</span>
              </h1>
              <p className="mx-auto mt-3 max-w-md text-fg-2">
                You're going to learn <b>SQL</b> — the language used to ask questions of data — starting from absolute zero, all the way to <b>advanced SQL developer</b>.
              </p>
              <p className="mx-auto mt-2 max-w-md text-sm text-muted">No coding experience needed. A real PostgreSQL database runs right here in your browser, so there's nothing to install.</p>
              <button className="btn btn-primary btn-lg mt-6" onClick={() => setStep(1)}>
                Let's start <ArrowRight size={18} />
              </button>
              <div className="mt-4">
                <button className="inline-flex items-center gap-1 text-xs font-semibold text-muted hover:text-fg" onClick={() => fileRef.current?.click()}>
                  <Upload size={13} /> I have a backup file — restore my progress
                </button>
                <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={(e) => e.target.files?.[0] && restore(e.target.files[0])} />
              </div>
            </div>
          )}
          {step === 1 && (
            <div>
              <div className="text-4xl">👋</div>
              <h2 className="mt-3 text-[22px] font-bold tracking-tight">What should we call you?</h2>
              <p className="mt-1 text-sm text-muted">Your name appears on your dashboard and on your certificate.</p>
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && name.trim() && setStep(2)}
                placeholder="Your first name"
                className="mt-5 w-full rounded-xl bg-surface-2 px-4 py-3 text-lg font-medium outline-none focus:ring-2 focus:ring-primary/40"
              />
              <div className="mt-6 flex justify-between">
                <button className="btn btn-ghost" onClick={() => setStep(0)}>
                  Back
                </button>
                <button className="btn btn-primary" disabled={!name.trim()} onClick={() => setStep(2)}>
                  Continue <ArrowRight size={16} />
                </button>
              </div>
            </div>
          )}
          {step === 2 && (
            <div>
              <h2 className="text-[22px] font-bold tracking-tight">How much time can you give each day, {name.trim()}?</h2>
              <p className="mt-1 text-sm text-muted">Little and often beats long and rare. You can change this any time.</p>
              <div className="mt-5 grid grid-cols-2 gap-3">
                {GOALS.map((g, i) => (
                  <button
                    key={g.label}
                    onClick={() => setGoal(i)}
                    className={`rounded-2xl p-4 text-left transition ${goal === i ? 'bg-primary-soft ring-2 ring-primary' : 'bg-surface-2 hover:bg-surface-3'}`}
                  >
                    <div className="text-2xl">{g.emoji}</div>
                    <div className="mt-1 font-bold">{g.label}</div>
                    <div className="text-xs text-muted">
                      ~{g.min} min/day · {g.xp} XP goal
                    </div>
                  </button>
                ))}
              </div>
              <div className="mt-5">
                <div className="mb-2 text-sm font-semibold">Look & feel</div>
                <div className="flex gap-2">
                  {(
                    [
                      ['light', Sun, 'Light'],
                      ['dark', Moon, 'Dark'],
                      ['system', Laptop, 'Auto'],
                    ] as const
                  ).map(([t, Icon, label]) => (
                    <button key={t} onClick={() => setProfile({ theme: t as Theme })} className={`btn btn-sm ${theme === t ? 'btn-primary' : 'btn-outline'}`}>
                      <Icon size={14} /> {label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="mt-6 flex justify-between">
                <button className="btn btn-ghost" onClick={() => setStep(1)}>
                  Back
                </button>
                <button className="btn btn-primary" onClick={() => setStep(3)}>
                  Continue <ArrowRight size={16} />
                </button>
              </div>
            </div>
          )}
          {step === 3 && (
            <div>
              <h2 className="text-[22px] font-bold tracking-tight">Here's how you'll learn</h2>
              <div className="mt-5 space-y-3">
                {[
                  [Wand2, 'Learn by doing', 'Short lessons with hundreds of runnable examples and exercises that check your answer instantly.'],
                  [Brain, 'Daily review', "Exercises you've solved come back at just the right time (spaced repetition), so you don't forget."],
                  [CalendarCheck, 'Weekly & monthly tests', 'Every 7 days a weekly test, every 4 weeks a bigger monthly test — they focus on what you find hardest.'],
                  [Puzzle, 'Challenges & real projects', 'Hundreds of practice problems and realistic projects take you to advanced level.'],
                ].map(([Icon, title, text]) => {
                  const I = Icon as typeof Wand2;
                  return (
                    <div key={title as string} className="flex gap-3 rounded-2xl bg-surface-2 p-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">
                        <I size={20} />
                      </div>
                      <div>
                        <div className="font-bold">{title as string}</div>
                        <div className="text-sm text-muted">{text as string}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
              <p className="mt-4 rounded-2xl bg-surface-2 p-3 text-xs text-muted">
                💾 Progress saves automatically in this browser. Download a backup from <b>Settings</b> now and then.
                <br />📱 On iPhone: tap <b>Share → Add to Home Screen</b> to use SQL Quest like an app (works offline too).
              </p>
              <div className="mt-6 flex justify-between">
                <button className="btn btn-ghost" onClick={() => setStep(2)}>
                  Back
                </button>
                <button className="btn btn-primary btn-lg" onClick={finish}>
                  Start my first lesson 🚀
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
