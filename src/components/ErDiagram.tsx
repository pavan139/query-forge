import { useMemo, useState } from 'react';
import type { SchemaInfo } from '../db/engine.ts';

const BOX_W = 210;
const ROW_H = 20;
const HEAD_H = 30;
const GAP_X = 70;
const GAP_Y = 40;

/** Auto-laid-out entity–relationship diagram from the live schema (tables, keys, foreign keys). */
export function ErDiagram({ schema, onTable }: { schema: SchemaInfo; onTable?: (t: string) => void }) {
  const [hover, setHover] = useState<string | null>(null);
  const tables = schema.tables.filter((t) => t.kind === 'table');
  const layout = useMemo(() => {
    // Order tables so that referenced (parent) tables come first, then children.
    const refs = new Map<string, Set<string>>();
    for (const t of tables) refs.set(t.name, new Set(t.columns.filter((c) => c.fk).map((c) => c.fk!.split('.')[0]).filter((x) => x !== t.name)));
    const depth = new Map<string, number>();
    const d = (n: string, seen = new Set<string>()): number => {
      if (depth.has(n)) return depth.get(n)!;
      if (seen.has(n)) return 0;
      seen.add(n);
      const parents = [...(refs.get(n) ?? [])];
      const v = parents.length ? 1 + Math.max(...parents.map((p) => d(p, seen))) : 0;
      depth.set(n, v);
      return v;
    };
    tables.forEach((t) => d(t.name));
    const cols = Math.max(...[...depth.values(), 0]) + 1;
    const byCol: string[][] = Array.from({ length: cols }, () => []);
    for (const t of tables) byCol[depth.get(t.name) ?? 0].push(t.name);
    const pos = new Map<string, { x: number; y: number; h: number }>();
    let height = 0;
    byCol.forEach((names, ci) => {
      let y = 10;
      for (const n of names) {
        const t = tables.find((x) => x.name === n)!;
        const h = HEAD_H + t.columns.length * ROW_H + 8;
        pos.set(n, { x: 10 + ci * (BOX_W + GAP_X), y, h });
        y += h + GAP_Y;
      }
      height = Math.max(height, y);
    });
    return { pos, width: 20 + cols * (BOX_W + GAP_X) - GAP_X, height };
  }, [tables]);

  const links: { from: string; col: number; to: string; key: string }[] = [];
  for (const t of tables)
    t.columns.forEach((c, i) => {
      if (c.fk) links.push({ from: t.name, col: i, to: c.fk.split('.')[0], key: `${t.name}.${c.name}` });
    });

  return (
    <div className="overflow-auto rounded-xl border border-line bg-surface-2/40">
      <svg width={layout.width} height={layout.height} className="font-mono">
        {links.map((l) => {
          const a = layout.pos.get(l.from);
          const b = layout.pos.get(l.to);
          if (!a || !b) return null;
          const y1 = a.y + HEAD_H + l.col * ROW_H + ROW_H / 2;
          const self = l.from === l.to;
          const x1 = a.x;
          const x2 = b.x + BOX_W;
          const y2 = b.y + HEAD_H / 2;
          const active = hover === l.from || hover === l.to;
          const path = self
            ? `M${a.x + BOX_W},${y1} C${a.x + BOX_W + 40},${y1} ${a.x + BOX_W + 40},${y2} ${a.x + BOX_W},${y2}`
            : `M${x1},${y1} C${x1 - GAP_X / 2},${y1} ${x2 + GAP_X / 2},${y2} ${x2},${y2}`;
          return <path key={l.key} d={path} fill="none" stroke={active ? 'var(--c-primary)' : 'var(--c-border-strong)'} strokeWidth={active ? 2.5 : 1.5} />;
        })}
        {tables.map((t) => {
          const p = layout.pos.get(t.name)!;
          const active = hover === t.name;
          return (
            <g key={t.name} transform={`translate(${p.x},${p.y})`} onMouseEnter={() => setHover(t.name)} onMouseLeave={() => setHover(null)} onClick={() => onTable?.(t.name)} className="cursor-pointer">
              <rect width={BOX_W} height={p.h} rx={10} fill="var(--c-surface)" stroke={active ? 'var(--c-primary)' : 'var(--c-border)'} strokeWidth={active ? 2 : 1} />
              <path d={`M0,10 a10,10 0 0 1 10,-10 h${BOX_W - 20} a10,10 0 0 1 10,10 v${HEAD_H - 10} h-${BOX_W} z`} fill="var(--c-primary)" />
              <text x={10} y={20} fontSize={12.5} fontWeight={700} fill="var(--c-primary-fg)">
                {t.name}
              </text>
              {t.columns.map((c, i) => (
                <g key={c.name} transform={`translate(0,${HEAD_H + i * ROW_H})`}>
                  <text x={10} y={14} fontSize={11} fill={c.pk ? 'var(--c-accent)' : c.fk ? 'var(--c-primary)' : 'var(--c-fg)'} fontWeight={c.pk ? 700 : 400}>
                    {c.pk ? '🔑 ' : c.fk ? '🔗 ' : '   '}
                    {c.name}
                  </text>
                  <text x={BOX_W - 8} y={14} fontSize={9.5} fill="var(--c-muted)" textAnchor="end">
                    {c.type.replace('character varying', 'varchar').replace(' without time zone', '').slice(0, 14)}
                  </text>
                </g>
              ))}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
