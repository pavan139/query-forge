import { useMemo, useState } from 'react';

type Cell = string | number | null;
const DEFAULT = {
  table: {
    name: 'orders',
    columns: ['customer', 'item', 'amount'],
    rows: [
      ['Ana', 'Latte', 4.5],
      ['Ben', 'Muffin', 3],
      ['Ana', 'Bagel', 2.5],
      ['Chen', 'Tea', 3.5],
      ['Ben', 'Latte', 4.5],
      ['Ana', 'Cookie', 2],
      ['Chen', 'Juice', 5],
    ] as Cell[][],
  },
  groupBy: 'customer',
  aggregates: ['count', 'sum', 'avg', 'min', 'max'],
  column: 'amount',
};

const COLORS = ['#6366f1', '#ec4899', '#10b981', '#f59e0b', '#06b6d4', '#8b5cf6', '#ef4444'];
type Agg = 'count' | 'sum' | 'avg' | 'min' | 'max';

function aggregate(fn: Agg, values: Cell[]): string {
  const nums = values.filter((v) => v !== null).map(Number);
  if (fn === 'count') return String(values.length);
  if (!nums.length) return 'NULL';
  if (fn === 'sum') return String(Math.round(nums.reduce((a, b) => a + b, 0) * 100) / 100);
  if (fn === 'avg') return (nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(2);
  if (fn === 'min') return String(Math.min(...nums));
  return String(Math.max(...nums));
}

export function GroupByViz({ config }: { config?: Record<string, unknown> }) {
  const cfg = { ...DEFAULT, ...(config ?? {}) } as typeof DEFAULT;
  const t = cfg.table;
  const gi = Math.max(0, t.columns.indexOf(cfg.groupBy));
  const vi = Math.max(0, t.columns.indexOf(cfg.column));
  const aggs = (cfg.aggregates as Agg[]) ?? ['count', 'sum'];
  const [phase, setPhase] = useState(0);
  const [agg, setAgg] = useState<Agg>(aggs.includes('sum') ? 'sum' : aggs[0]);

  const groups = useMemo(() => {
    const m = new Map<Cell, Cell[][]>();
    for (const r of t.rows) m.set(r[gi], [...(m.get(r[gi]) ?? []), r]);
    return [...m.entries()];
  }, [t, gi]);
  const colorOf = (k: Cell) => COLORS[groups.findIndex(([g]) => g === k) % COLORS.length];
  const rowsOrdered = phase === 0 ? t.rows : groups.flatMap(([, rs]) => rs);
  const fnLabel = `${agg.toUpperCase()}(${agg === 'count' ? '*' : cfg.column})`;

  const phases = ['1 · The original rows', '2 · Sort rows into groups', '3 · Squash each group into one row'];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {phases.map((p, i) => (
          <button key={p} className={`btn btn-sm ${i === phase ? 'btn-primary' : 'btn-outline'}`} onClick={() => setPhase(i)}>
            {p}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className="font-semibold text-muted">Aggregate:</span>
        {aggs.map((a) => (
          <button key={a} className={`chip cursor-pointer ${a === agg ? '!bg-primary !text-primary-fg' : ''}`} onClick={() => setAgg(a)}>
            {a.toUpperCase()}
          </button>
        ))}
      </div>
      <code className="block rounded-lg bg-code px-3 py-2 font-mono text-xs text-fg-2">
        SELECT {cfg.groupBy}, {fnLabel} FROM {t.name} GROUP BY {cfg.groupBy};
      </code>
      <div className="grid items-start gap-4 md:grid-cols-[1fr_auto_1fr]">
        <div>
          <div className="mb-1 font-mono text-xs font-bold text-muted">{t.name}</div>
          <table className="w-full overflow-hidden rounded-lg border border-line font-mono text-xs">
            <thead>
              <tr className="bg-surface-2">
                {t.columns.map((c, i) => (
                  <th key={c} className={`px-2 py-1 text-left ${i === gi ? 'text-primary' : ''} ${i === vi && phase > 0 ? 'text-pink' : ''}`}>
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rowsOrdered.map((r, i) => {
                const firstOfGroup = phase > 0 && (i === 0 || rowsOrdered[i - 1][gi] !== r[gi]);
                return (
                  <tr
                    key={i + String(r[gi]) + phase}
                    className={`animate-fade-up ${firstOfGroup && i > 0 ? 'border-t-4 border-bg' : 'border-t border-line'}`}
                    style={{ background: phase > 0 ? `color-mix(in srgb, ${colorOf(r[gi])} 14%, transparent)` : undefined, animationDelay: `${i * 30}ms` }}
                  >
                    {r.map((v, ci) => (
                      <td key={ci} className="px-2 py-1" style={{ color: ci === gi && phase > 0 ? colorOf(r[gi]) : undefined, fontWeight: ci === gi ? 700 : 400 }}>
                        {v === null ? <span className="null-badge">NULL</span> : String(v)}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="hidden self-center text-3xl text-muted md:block">{phase === 2 ? '➜' : ''}</div>
        <div>
          {phase === 2 ? (
            <>
              <div className="mb-1 font-mono text-xs font-bold text-muted">result</div>
              <table className="w-full overflow-hidden rounded-lg border border-line font-mono text-xs">
                <thead>
                  <tr className="bg-surface-2">
                    <th className="px-2 py-1 text-left text-primary">{cfg.groupBy}</th>
                    <th className="px-2 py-1 text-left text-pink">{fnLabel}</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map(([k, rs], i) => (
                    <tr key={String(k)} className="animate-pop border-t border-line" style={{ background: `color-mix(in srgb, ${colorOf(k)} 14%, transparent)`, animationDelay: `${i * 80}ms` }}>
                      <td className="px-2 py-1.5 font-bold" style={{ color: colorOf(k) }}>
                        {k === null ? 'NULL' : String(k)}
                      </td>
                      <td className="px-2 py-1.5">
                        <span className="font-bold">{aggregate(agg, rs.map((r) => r[vi]))}</span>
                        <span className="ml-2 text-[10px] text-muted">
                          {agg === 'count' ? `${rs.length} rows` : `from ${rs.map((r) => r[vi] ?? 'NULL').join(', ')}`}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : (
            <div className="rounded-lg border border-dashed border-line p-4 text-sm text-muted">
              {phase === 0
                ? `GROUP BY ${cfg.groupBy} will put rows with the same ${cfg.groupBy} into the same bucket. Click step 2.`
                : `There are ${groups.length} different values of ${cfg.groupBy}, so there will be ${groups.length} groups → ${groups.length} result rows. Click step 3.`}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
