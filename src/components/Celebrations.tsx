import { useEffect, useState } from 'react';
import confetti from 'canvas-confetti';
import { subscribe, type AppEvent } from '../lib/events.ts';
import { playSound } from '../lib/sound.ts';
import { useStore } from '../state/store.ts';

interface Toast {
  id: number;
  e: AppEvent;
}

let nextId = 1;

export function burst() {
  void confetti({ particleCount: 90, spread: 75, origin: { y: 0.7 }, colors: ['#6d5cff', '#a748f0', '#ec4899', '#fbbf24', '#10b981'] });
}

export function Celebrations() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [level, setLevel] = useState<Extract<AppEvent, { type: 'level' }> | null>(null);
  const sound = useStore((s) => s.profile.sound);

  useEffect(
    () =>
      subscribe((e) => {
        if (e.type === 'confetti') return burst();
        if (e.type === 'level') {
          setLevel(e);
          burst();
          if (sound) playSound('level');
          return;
        }
        // Tiny XP amounts (reading a step) count silently.
        if (e.type === 'xp' && e.amount < 5) return;
        const id = nextId++;
        setToasts((t) => [...t.slice(-4), { id, e }]);
        setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), e.type === 'achievement' ? 5000 : e.type === 'xp' ? 1800 : 3500);
      }),
    [sound],
  );

  return (
    <>
      <div className="pointer-events-none fixed inset-x-4 bottom-[calc(var(--tabbar-h)+var(--safe-bottom)+12px)] z-[60] flex flex-col items-center gap-2 lg:inset-x-auto lg:right-6 lg:bottom-6 lg:items-end">
        {toasts.map(({ id, e }) => {
          if (e.type === 'xp')
            return (
              <div key={id} className="animate-pop rounded-full bg-surface px-3.5 py-1.5 text-sm font-semibold shadow-pop">
                <span className="text-accent">+{e.amount} XP</span>{e.reason ? <span className="ml-1 font-medium text-muted">· {e.reason}</span> : null}
              </div>
            );
          if (e.type === 'achievement')
            return (
              <div key={id} className="animate-pop pointer-events-auto flex max-w-xs items-center gap-3 rounded-2xl bg-surface p-3 shadow-pop ring-1 ring-line">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-2xl">{e.icon}</div>
                <div>
                  <div className="text-[11px] font-semibold text-accent">Achievement unlocked</div>
                  <div className="font-semibold">{e.title}</div>
                  <div className="text-xs text-muted">{e.description}</div>
                </div>
              </div>
            );
          if (e.type === 'toast')
            return (
              <div
                key={id}
                className={`animate-pop pointer-events-auto max-w-sm rounded-xl px-4 py-2.5 text-sm font-semibold shadow-pop ${
                  e.tone === 'error' ? 'bg-danger text-white' : e.tone === 'success' ? 'bg-success text-white' : 'bg-fg text-bg'
                }`}
              >
                {e.message}
              </div>
            );
          return null;
        })}
      </div>
      {level && (
        <div className="animate-fade-in fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm" onClick={() => setLevel(null)}>
          <div className="animate-pop card w-full max-w-sm overflow-hidden text-center" onClick={(ev) => ev.stopPropagation()}>
            <div className="hero-soft px-6 py-8">
              <div className="animate-float text-6xl">{level.icon}</div>
              <div className="mt-3 text-sm font-medium text-muted">Level up</div>
              <div className="text-5xl font-bold tracking-tight">{level.level}</div>
            </div>
            <div className="p-6">
              <div className="text-sm text-muted">Your new title</div>
              <div className="text-xl font-bold tracking-tight">{level.title}</div>
              <button className="btn btn-primary btn-lg mt-5 w-full" onClick={() => setLevel(null)}>
                Keep going 🚀
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
