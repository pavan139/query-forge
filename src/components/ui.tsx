import type { ReactNode } from 'react';

export function Page({ children, wide }: { children: ReactNode; wide?: boolean }) {
  return <div className={`mx-auto w-full px-4 py-6 sm:px-6 lg:py-8 ${wide ? 'max-w-7xl' : 'max-w-5xl'}`}>{children}</div>;
}

export function PageHeader({ title, subtitle, icon, actions }: { title: ReactNode; subtitle?: ReactNode; icon?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex items-start gap-3">
        {icon && <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary-soft text-2xl">{icon}</div>}
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-muted sm:text-base">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function ProgressRing({ value, size = 48, stroke = 5, children, color = 'var(--c-primary)' }: { value: number; size?: number; stroke?: number; children?: ReactNode; color?: string }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value));
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="var(--c-surface-3)" strokeWidth={stroke} fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - v)}
          style={{ transition: 'stroke-dashoffset 0.6s ease' }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center text-xs font-bold">{children}</div>
    </div>
  );
}

export function Bar({ value, className, color }: { value: number; className?: string; color?: string }) {
  return (
    <div className={`h-2 overflow-hidden rounded-full bg-surface-3 ${className ?? ''}`}>
      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`, background: color ?? 'linear-gradient(90deg, var(--c-primary), var(--c-pink))' }} />
    </div>
  );
}

export function Stat({ label, value, icon, hint }: { label: string; value: ReactNode; icon?: ReactNode; hint?: ReactNode }) {
  return (
    <div className="card p-4">
      <div className="flex items-center gap-2 text-xs font-semibold text-muted">
        {icon}
        {label}
      </div>
      <div className="mt-1 text-2xl font-extrabold tabular-nums">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-muted">{hint}</div>}
    </div>
  );
}

export function Empty({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="card flex flex-col items-center px-6 py-12 text-center">
      <div className="mb-3 text-5xl">{icon}</div>
      <div className="text-lg font-bold">{title}</div>
      {children && <div className="mt-2 max-w-md text-sm text-muted">{children}</div>}
    </div>
  );
}

export function Modal({ open, onClose, children, title }: { open: boolean; onClose: () => void; children: ReactNode; title?: string }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="animate-pop card max-h-[90vh] w-full max-w-lg overflow-y-auto p-6" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        {title && <h2 className="mb-3 text-lg font-bold">{title}</h2>}
        {children}
      </div>
    </div>
  );
}

export const LEVEL_STYLE: Record<string, { label: string; cls: string }> = {
  beginner: { label: 'Beginner', cls: 'bg-success-soft text-success-fg' },
  intermediate: { label: 'Intermediate', cls: 'bg-info-soft text-sky-700 dark:text-sky-300' },
  advanced: { label: 'Advanced', cls: 'bg-primary-soft text-primary' },
  expert: { label: 'Expert', cls: 'bg-pink/15 text-pink' },
};

export function LevelChip({ level }: { level: string }) {
  const s = LEVEL_STYLE[level] ?? LEVEL_STYLE.beginner;
  return <span className={`chip ${s.cls}`}>{s.label}</span>;
}
