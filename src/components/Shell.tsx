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
  MoreHorizontal,
  Puzzle,
  Settings,
  TerminalSquare,
  Trophy,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { ErrorBoundary } from './ErrorBoundary.tsx';
import { useDueCount, useTestBadges } from '../lib/hooks.ts';
import { useStore } from '../state/store.ts';
import { levelFromXp, titleFor } from '../state/xp.ts';
import { DbStatusDot } from './DbStatus.tsx';
import { Logo } from './Logo.tsx';

interface NavDef {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
  badge?: 'review' | 'tests';
}

const PRIMARY: NavDef[] = [
  { to: '/', label: 'Home', icon: Home, end: true },
  { to: '/learn', label: 'Learn', icon: Map },
  { to: '/review', label: 'Review', icon: Brain, badge: 'review' },
  { to: '/tests', label: 'Tests', icon: ClipboardCheck, badge: 'tests' },
];
const SECONDARY: NavDef[] = [
  { to: '/practice', label: 'Practice', icon: Puzzle },
  { to: '/projects', label: 'Projects', icon: Briefcase },
  { to: '/playground', label: 'Playground', icon: TerminalSquare },
  { to: '/reference', label: 'Cheat Sheet', icon: BookMarked },
  { to: '/datasets', label: 'Datasets', icon: Database },
  { to: '/progress', label: 'Progress', icon: LineChart },
  { to: '/achievements', label: 'Achievements', icon: Trophy },
  { to: '/settings', label: 'Settings', icon: Settings },
];

function Badge({ kind }: { kind?: NavDef['badge'] }) {
  const due = useDueCount();
  const { ready } = useTestBadges();
  if (kind === 'review' && due > 0)
    return <span className="min-w-5 rounded-full bg-danger px-1.5 text-center text-[10px] leading-5 font-semibold text-white">{due > 99 ? '99+' : due}</span>;
  if (kind === 'tests' && ready) return <span className="h-2 w-2 rounded-full bg-danger" />;
  return null;
}

function SidebarLink({ n }: { n: NavDef }) {
  return (
    <NavLink
      to={n.to}
      end={n.end}
      className={({ isActive }) =>
        `flex items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-[13.5px] font-medium transition-colors ${
          isActive ? 'bg-primary/12 text-primary' : 'text-fg-2 hover:bg-fg/5'
        }`
      }
    >
      <n.icon size={17} strokeWidth={1.9} />
      <span className="flex-1">{n.label}</span>
      <Badge kind={n.badge} />
    </NavLink>
  );
}

function ProfileCard() {
  const xp = useStore((s) => s.totalXp);
  const streak = useStore((s) => s.streak);
  const name = useStore((s) => s.profile.name);
  const lv = levelFromXp(xp);
  const t = titleFor(lv.level);
  return (
    <NavLink to="/progress" className="block rounded-xl p-2.5 transition hover:bg-fg/5">
      <div className="flex items-center gap-2.5">
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-2 text-lg">{t.icon}</div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold">{name || 'Learner'}</div>
          <div className="truncate text-[11px] text-muted">
            Level {lv.level} · {t.title}
          </div>
        </div>
        <div className="flex items-center gap-0.5 text-[13px] font-semibold text-accent" title={`${streak.current}-day streak`}>
          <Flame size={15} className={streak.current > 0 ? 'fill-accent' : ''} />
          {streak.current}
        </div>
      </div>
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-surface-3">
        <div className="h-full rounded-full bg-primary transition-all duration-700" style={{ width: `${Math.round(lv.progress * 100)}%` }} />
      </div>
    </NavLink>
  );
}

function TabBar({ onMore, moreActive }: { onMore: () => void; moreActive: boolean }) {
  return (
    <nav className="glass no-print fixed inset-x-0 bottom-0 z-40 border-t border-line pb-safe lg:hidden" aria-label="Main">
      <div className="mx-auto grid h-[var(--tabbar-h)] max-w-lg grid-cols-5">
        {PRIMARY.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.end}
            className={({ isActive }) => `relative flex flex-col items-center justify-center gap-0.5 text-[10.5px] font-medium ${isActive ? 'text-primary' : 'text-muted'}`}
          >
            <span className="relative">
              <n.icon size={23} strokeWidth={1.8} />
              <span className="absolute -top-1 -right-2.5">
                <Badge kind={n.badge} />
              </span>
            </span>
            {n.label}
          </NavLink>
        ))}
        <button onClick={onMore} className={`flex flex-col items-center justify-center gap-0.5 text-[10.5px] font-medium ${moreActive ? 'text-primary' : 'text-muted'}`}>
          <MoreHorizontal size={23} strokeWidth={1.8} />
          More
        </button>
      </div>
    </nav>
  );
}

function MoreSheet({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true">
      <div className="animate-fade-in absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="animate-sheet absolute inset-x-0 bottom-0 rounded-t-[22px] bg-surface px-4 pt-2 shadow-pop pb-safe">
        <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-surface-3" />
        <ProfileCard />
        <div className="mt-2 grid grid-cols-4 gap-1 pb-4">
          {SECONDARY.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              onClick={onClose}
              className={({ isActive }) => `flex flex-col items-center gap-1.5 rounded-2xl px-1 py-3 text-[11px] font-medium ${isActive ? 'bg-primary-soft text-primary' : 'text-fg-2 active:bg-surface-2'}`}
            >
              <n.icon size={22} strokeWidth={1.8} />
              {n.label}
            </NavLink>
          ))}
        </div>
      </div>
    </div>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const [more, setMore] = useState(false);
  const loc = useLocation();
  const immersive = loc.pathname.startsWith('/lesson/') || loc.pathname.startsWith('/tests/run');
  const streak = useStore((s) => s.streak.current);
  useEffect(() => setMore(false), [loc.pathname]);
  const moreActive = SECONDARY.some((n) => loc.pathname.startsWith(n.to));

  return (
    <div className="flex min-h-[100dvh]">
      {/* MacBook / desktop: translucent sidebar */}
      <aside className={`glass no-print sticky top-0 hidden h-[100dvh] w-[232px] shrink-0 flex-col border-r border-line px-3 pt-5 pb-3 ${immersive ? 'xl:flex' : 'lg:flex'}`}>
        <NavLink to="/" className="mb-6 px-2.5">
          <Logo />
        </NavLink>
        <div className="flex-1 space-y-5 overflow-y-auto">
          <div className="space-y-0.5">
            {PRIMARY.map((n) => (
              <SidebarLink key={n.to} n={n} />
            ))}
          </div>
          <div>
            <div className="mb-1 px-2.5 text-[11px] font-semibold text-muted">Explore</div>
            <div className="space-y-0.5">
              {SECONDARY.map((n) => (
                <SidebarLink key={n.to} n={n} />
              ))}
            </div>
          </div>
        </div>
        <div className="mt-3 space-y-1 border-t border-line pt-3">
          <ProfileCard />
          <DbStatusDot />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* iPhone: compact large-title style top bar */}
        {!immersive && (
          <header className="glass no-print sticky top-0 z-30 border-b border-line pt-safe lg:hidden">
            <div className="flex h-12 items-center justify-between px-4">
              <NavLink to="/">
                <Logo small />
              </NavLink>
              <NavLink to="/progress" className="flex items-center gap-1 text-[15px] font-semibold text-accent">
                <Flame size={18} className={streak > 0 ? 'fill-accent' : ''} />
                {streak}
              </NavLink>
            </div>
          </header>
        )}
        <main id="main-scroll" key={loc.pathname} className={`animate-fade-in min-w-0 flex-1 ${immersive ? '' : 'pb-tabbar'}`}>
          <ErrorBoundary
            resetKey={loc.pathname}
            what="this page"
            action={
              <a className="btn btn-primary btn-sm" href="#/">
                Go home
              </a>
            }
          >
            {children}
          </ErrorBoundary>
        </main>
      </div>

      {!immersive && <TabBar onMore={() => setMore(true)} moreActive={moreActive} />}
      {more && <MoreSheet onClose={() => setMore(false)} />}
    </div>
  );
}
