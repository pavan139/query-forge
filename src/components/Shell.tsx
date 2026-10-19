import {
  BookMarked,
  Brain,
  Briefcase,
  ClipboardCheck,
  Database,
  Flame,
  Home,
  LineChart,
  Map,
  Menu,
  Puzzle,
  Settings,
  TerminalSquare,
  Trophy,
  X,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useDueCount, useTestBadges } from '../lib/hooks.ts';
import { useStore } from '../state/store.ts';
import { levelFromXp, titleFor } from '../state/xp.ts';
import { DbStatusDot } from './DbStatus.tsx';
import { Logo } from './Logo.tsx';

const NAV = [
  { to: '/', label: 'Home', icon: Home, end: true },
  { to: '/learn', label: 'Learn', icon: Map },
  { to: '/review', label: 'Daily Review', icon: Brain, badge: 'review' as const },
  { to: '/tests', label: 'Tests', icon: ClipboardCheck, badge: 'tests' as const },
  { to: '/practice', label: 'Practice', icon: Puzzle },
  { to: '/projects', label: 'Projects', icon: Briefcase },
  { to: '/playground', label: 'Playground', icon: TerminalSquare },
  { to: '/reference', label: 'Cheat Sheet', icon: BookMarked },
  { to: '/datasets', label: 'Datasets', icon: Database },
  { to: '/progress', label: 'My Progress', icon: LineChart },
  { to: '/achievements', label: 'Achievements', icon: Trophy },
  { to: '/settings', label: 'Settings', icon: Settings },
];

function NavItems({ onNavigate }: { onNavigate?: () => void }) {
  const due = useDueCount();
  const { ready } = useTestBadges();
  return (
    <nav className="space-y-0.5">
      {NAV.map((n) => (
        <NavLink
          key={n.to}
          to={n.to}
          end={n.end}
          onClick={onNavigate}
          className={({ isActive }) =>
            `group flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-semibold transition ${
              isActive ? 'bg-primary text-primary-fg shadow-sm' : 'text-fg-2 hover:bg-surface-2 hover:text-fg'
            }`
          }
        >
          <n.icon size={18} strokeWidth={2.2} />
          <span className="flex-1">{n.label}</span>
          {n.badge === 'review' && due > 0 && <span className="rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-bold text-white">{due}</span>}
          {n.badge === 'tests' && ready && <span className="h-2 w-2 animate-pulse rounded-full bg-pink" />}
        </NavLink>
      ))}
    </nav>
  );
}

function ProfileCard() {
  const xp = useStore((s) => s.totalXp);
  const streak = useStore((s) => s.streak);
  const name = useStore((s) => s.profile.name);
  const lv = levelFromXp(xp);
  const t = titleFor(lv.level);
  return (
    <NavLink to="/progress" className="block rounded-2xl border border-line bg-surface-2/60 p-3 transition hover:border-primary/40">
      <div className="flex items-center gap-3">
        <div className="relative flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-primary to-pink text-lg text-white">
          {t.icon}
          <span className="absolute -right-1 -bottom-1 rounded-full border-2 border-surface bg-fg px-1 text-[9px] font-bold text-bg">{lv.level}</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-bold">{name || 'Learner'}</div>
          <div className="truncate text-[11px] text-muted">{t.title}</div>
        </div>
        <div className="flex items-center gap-0.5 text-sm font-bold text-accent" title={`${streak.current}-day streak`}>
          <Flame size={16} className={streak.current > 0 ? 'fill-accent' : ''} />
          {streak.current}
        </div>
      </div>
      <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-surface-3">
        <div className="h-full rounded-full bg-gradient-to-r from-primary to-pink transition-all" style={{ width: `${Math.round(lv.progress * 100)}%` }} />
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-muted">
        <span>{xp.toLocaleString()} XP</span>
        <span>
          {lv.needed - lv.into} XP to level {lv.level + 1}
        </span>
      </div>
    </NavLink>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  const immersive = loc.pathname.startsWith('/lesson/') || loc.pathname.startsWith('/tests/run');
  const streak = useStore((s) => s.streak.current);
  useEffect(() => setOpen(false), [loc.pathname]);

  return (
    <div className="flex min-h-full">
      {/* Desktop sidebar */}
      <aside className={`no-print sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-line bg-surface px-3 py-4 ${immersive ? 'xl:flex' : 'lg:flex'}`}>
        <NavLink to="/" className="mb-5 px-2">
          <Logo />
        </NavLink>
        <div className="flex-1 overflow-y-auto">
          <NavItems />
        </div>
        <div className="mt-3 space-y-2">
          <ProfileCard />
          <DbStatusDot />
        </div>
      </aside>

      {/* Mobile top bar */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className={`no-print sticky top-0 z-30 flex items-center justify-between border-b border-line bg-surface/90 px-4 py-2.5 backdrop-blur ${immersive ? 'xl:hidden' : 'lg:hidden'}`}>
          <NavLink to="/">
            <Logo small />
          </NavLink>
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1 text-sm font-bold text-accent">
              <Flame size={16} className={streak > 0 ? 'fill-accent' : ''} />
              {streak}
            </span>
            <button className="btn btn-ghost btn-sm" onClick={() => setOpen(true)} aria-label="Open menu">
              <Menu size={20} />
            </button>
          </div>
        </header>
        {open && (
          <div className="fixed inset-0 z-50 flex" role="dialog">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setOpen(false)} />
            <div className="animate-fade-up relative ml-auto flex h-full w-72 flex-col bg-surface p-4 shadow-pop">
              <div className="mb-4 flex items-center justify-between">
                <Logo small />
                <button className="btn btn-ghost btn-sm" onClick={() => setOpen(false)} aria-label="Close menu">
                  <X size={20} />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto">
                <NavItems onNavigate={() => setOpen(false)} />
              </div>
              <div className="mt-3 space-y-2">
                <ProfileCard />
                <DbStatusDot />
              </div>
            </div>
          </div>
        )}
        <main id="main-scroll" className="min-w-0 flex-1">
          {children}
        </main>
      </div>
    </div>
  );
}
