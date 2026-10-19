// Small, dependency-free SVG charts: single-hue sequential heatmap, bars with goal line, score line.
import { useState } from 'react';
import { addDays, dayKey, friendlyDate, lastNDays, parseDay } from '../../lib/dates.ts';

const STEPS = ['var(--c-surface-3)', 'color-mix(in srgb, var(--c-primary) 30%, var(--c-surface))', 'color-mix(in srgb, var(--c-primary) 55%, var(--c-surface))', 'color-mix(in srgb, var(--c-primary) 80%, var(--c-surface))', 'var(--c-primary)'];

function Tip({ x, y, children }: { x: number; y: number; children: React.ReactNode }) {
  return (
    <div className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-lg bg-fg px-2 py-1 text-[11px] font-semibold whitespace-nowrap text-bg shadow-pop" style={{ left: x, top: y - 6 }}>
      {children}
    </div>
  );
}

export function ActivityHeatmap({ xpByDay, weeks = 16 }: { xpByDay: Record<string, number>; weeks?: number }) {
  const today = dayKey();
  // Start on a Sunday so columns are calendar weeks.
  const startDay = addDays(today, -(weeks * 7 - 1));
  const first = addDays(startDay, -parseDay(startDay).getDay());
  const cells: { day: string; xp: number }[] = [];
  for (let d = first; d <= today; d = addDays(d, 1)) cells.push({ day: d, xp: xpByDay[d] ?? 0 });
  const max = Math.max(50, ...cells.map((c) => c.xp));
  const level = (xp: number) => (xp <= 0 ? 0 : xp < max * 0.25 ? 1 : xp < max * 0.5 ? 2 : xp < max * 0.8 ? 3 : 4);
  const cols = Math.ceil(cells.length / 7);
  const size = 13;
  const gap = 3;
  const [hover, setHover] = useState<{ x: number; y: number; c: { day: string; xp: number } } | null>(null);
  const activeDays = cells.filter((c) => c.xp > 0).length;
  return (
    <div className="relative">
      <div className="overflow-x-auto pb-1">
        <svg width={cols * (size + gap)} height={7 * (size + gap)} role="img" aria-label={`Study activity: ${activeDays} active days in the last ${weeks} weeks`}>
          {cells.map((c, i) => {
            const col = Math.floor(i / 7);
            const row = i % 7;
            const x = col * (size + gap);
            const y = row * (size + gap);
            return (
              <rect
                key={c.day}
                x={x}
                y={y}
                width={size}
                height={size}
                rx={3}
                fill={STEPS[level(c.xp)]}
                stroke={c.day === today ? 'var(--c-fg)' : 'none'}
                strokeWidth={c.day === today ? 1.5 : 0}
                onMouseEnter={() => setHover({ x: x + size / 2, y, c })}
                onMouseLeave={() => setHover(null)}
              />
            );
          })}
        </svg>
      </div>
      {hover && (
        <Tip x={hover.x} y={hover.y}>
          {friendlyDate(hover.c.day)}: {hover.c.xp} XP
        </Tip>
      )}
      <div className="mt-2 flex items-center justify-between text-[11px] text-muted">
        <span>{activeDays} active days in the last {weeks} weeks</span>
        <span className="flex items-center gap-1">
          Less
          {STEPS.map((s, i) => (
            <span key={i} className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ background: s }} />
          ))}
          More
        </span>
      </div>
    </div>
  );
}

export function XpBars({ xpByDay, days = 14, goal }: { xpByDay: Record<string, number>; days?: number; goal: number }) {
  const list = lastNDays(days).map((d) => ({ d, xp: xpByDay[d] ?? 0 }));
  const max = Math.max(goal * 1.2, ...list.map((x) => x.xp), 10);
  const H = 110;
  const W = 100 / days;
  const [hover, setHover] = useState<number | null>(null);
  const goalY = H - (goal / max) * H;
  return (
    <div className="relative">
      <svg viewBox={`0 0 100 ${H + 14}`} preserveAspectRatio="none" className="h-36 w-full" role="img" aria-label="XP earned per day">
        <line x1="0" x2="100" y1={goalY} y2={goalY} stroke="var(--c-accent)" strokeWidth="0.6" strokeDasharray="1.5 1.5" vectorEffect="non-scaling-stroke" />
        {list.map((x, i) => {
          const h = (x.xp / max) * H;
          const met = x.xp >= goal;
          return (
            <g key={x.d} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={i * W} y={0} width={W} height={H} fill="transparent" />
              <rect x={i * W + W * 0.2} y={H - h} width={W * 0.6} height={Math.max(h, x.xp > 0 ? 1.5 : 0)} rx={1} fill={met ? 'var(--c-primary)' : 'color-mix(in srgb, var(--c-primary) 45%, var(--c-surface))'} opacity={hover === null || hover === i ? 1 : 0.6} />
            </g>
          );
        })}
      </svg>
      <div className="flex justify-between text-[10px] text-muted">
        <span>{friendlyDate(list[0].d).replace(/, \d{4}/, '')}</span>
        <span className="text-accent">— daily goal {goal} XP</span>
        <span>Today</span>
      </div>
      {hover !== null && (
        <div className="pointer-events-none absolute top-0 rounded-lg bg-fg px-2 py-1 text-[11px] font-semibold text-bg shadow-pop" style={{ left: `${Math.min(80, hover * W)}%` }}>
          {friendlyDate(list[hover].d).replace(/, \d{4}/, '')}: {list[hover].xp} XP
        </div>
      )}
    </div>
  );
}

export function ScoreLine({ points }: { points: { label: string; score: number }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  if (points.length === 0) return <div className="py-8 text-center text-sm text-muted">No tests taken yet.</div>;
  const W = 300;
  const H = 120;
  const pad = 14;
  const x = (i: number) => (points.length === 1 ? W / 2 : pad + (i / (points.length - 1)) * (W - pad * 2));
  const y = (s: number) => H - pad - (s / 100) * (H - pad * 2);
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i)},${y(p.score)}`).join(' ');
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-40 w-full" role="img" aria-label="Test scores over time">
        {[0, 50, 70, 100].map((g) => (
          <g key={g}>
            <line x1={pad} x2={W - pad} y1={y(g)} y2={y(g)} stroke="var(--c-border)" strokeWidth="1" strokeDasharray={g === 70 ? '4 3' : undefined} />
            <text x={2} y={y(g) + 3} fontSize="7" fill="var(--c-muted)">
              {g}
            </text>
          </g>
        ))}
        <path d={path} fill="none" stroke="var(--c-primary)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {points.map((p, i) => (
          <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            <circle cx={x(i)} cy={y(p.score)} r={10} fill="transparent" />
            <circle cx={x(i)} cy={y(p.score)} r={hover === i ? 5 : 4} fill="var(--c-primary)" stroke="var(--c-surface)" strokeWidth="2" />
          </g>
        ))}
      </svg>
      {hover !== null && (
        <div className="pointer-events-none absolute top-0 rounded-lg bg-fg px-2 py-1 text-[11px] font-semibold text-bg shadow-pop" style={{ left: `${(x(hover) / W) * 100}%`, transform: 'translateX(-50%)' }}>
          {points[hover].label}: {points[hover].score}%
        </div>
      )}
      <div className="text-[10px] text-muted">Dashed line = 70% pass mark</div>
    </div>
  );
}
