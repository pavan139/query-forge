import { useEffect, useState } from 'react';
import { useStore } from '../state/store.ts';
import { dayKey } from './dates.ts';
import { dueCards } from '../state/srs.ts';
import { slotStatus } from '../state/tests.ts';

/** Apply light/dark theme to <html>. */
export function useThemeSync() {
  const theme = useStore((s) => s.profile.theme);
  const font = useStore((s) => s.profile.editorFont);
  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && mq.matches);
      document.documentElement.classList.toggle('dark', dark);
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0d0e1a' : '#5b4cf0');
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);
  useEffect(() => {
    document.documentElement.style.setProperty('--editor-font', `${font}px`);
  }, [font]);
}

/** Counts active study minutes (tab visible and some interaction in the last 2 minutes). */
export function useActivityTracker() {
  const tick = useStore((s) => s.tickMinute);
  useEffect(() => {
    let last = Date.now();
    const bump = () => (last = Date.now());
    const events = ['keydown', 'pointerdown', 'scroll', 'mousemove'];
    events.forEach((e) => window.addEventListener(e, bump, { passive: true }));
    const id = setInterval(() => {
      if (document.visibilityState === 'visible' && Date.now() - last < 120_000) tick();
    }, 60_000);
    return () => {
      clearInterval(id);
      events.forEach((e) => window.removeEventListener(e, bump));
    };
  }, [tick]);
}

/** Re-render at midnight / every few minutes so "today" stays correct. */
export function useToday(): string {
  const [d, setD] = useState(dayKey());
  useEffect(() => {
    const id = setInterval(() => setD(dayKey()), 5 * 60_000);
    return () => clearInterval(id);
  }, []);
  return d;
}

export function useDueCount(): number {
  const srs = useStore((s) => s.srs);
  const today = useToday();
  return dueCards(srs, today).length;
}

export function useTestBadges() {
  const startedAt = useStore((s) => s.profile.startedAt);
  const tests = useStore((s) => s.tests);
  const anyLesson = useStore((s) => Object.values(s.lessons).some((l) => l.completed));
  const today = useToday();
  const weekly = slotStatus('weekly', startedAt, tests, today);
  const monthly = slotStatus('monthly', startedAt, tests, today);
  return { weekly, monthly, ready: anyLesson && (weekly.available || monthly.available) };
}

export function useMediaQuery(q: string): boolean {
  const [m, setM] = useState(() => matchMedia(q).matches);
  useEffect(() => {
    const mq = matchMedia(q);
    const f = () => setM(mq.matches);
    mq.addEventListener('change', f);
    return () => mq.removeEventListener('change', f);
  }, [q]);
  return m;
}
