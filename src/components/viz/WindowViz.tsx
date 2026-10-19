import { useMemo, useState } from 'react';

type Cell = string | number | null;
type Fn = 'row_number' | 'rank' | 'dense_rank' | 'running_sum' | 'moving_avg_3' | 'lag' | 'lead' | 'partition_sum' | 'partition_avg';

const DEFAULT = {
  table: {
    name: 'sales',
    columns: ['region', 'month', 'amount'],
    rows: [
      ['East', 1, 100],
      ['East', 2, 80],
      ['East', 3, 80],
      ['East', 4, 120],
      ['West', 1, 50],
      ['West', 2, 90],
      ['West', 3, 70],
    ] as Cell[][],
  },
  partitionBy: 'region',
  orderBy: 'month',
  value: 'amount',
  functions: ['row_number', 'rank', 'dense_rank', 'running_sum', 'moving_avg_3', 'lag', 'lead', 'partition_sum'],
};

const SQL: Record<Fn, (v: string) => string> = {
  row_number: () => 'ROW_NUMBER()',
  rank: () => 'RANK()',
  dense_rank: () => 'DENSE_RANK()',
  running_sum: (v) => `SUM(${v})`,
  moving_avg_3: (v) => `AVG(${v})`,
  lag: (v) => `LAG(${v})`,
  lead: (v) => `LEAD(${v})`,
  partition_sum: (v) => `SUM(${v})`,
  partition_avg: (v) => `AVG(${v})`,
};
const LABEL: Record<Fn, string> = {
  row_number: 'ROW_NUMBER',
  rank: 'RANK',
  dense_rank: 'DENSE_RANK',
  running_sum: 'Running SUM',
  moving_avg_3: '3-row moving AVG',
  lag: 'LAG',
  lead: 'LEAD',
  partition_sum: 'SUM per group',
  partition_avg: 'AVG per group',
};
const EXPLAIN: Record<Fn, string> = {
  row_number: 'Numbers the rows 1, 2, 3… in order. Ties still get different numbers.',
  rank: 'Like a race: ties share a rank, and the next rank skips (1, 2, 2, 4).',
  dense_rank: 'Ties share a rank, and no numbers are skipped (1, 2, 2, 3).',
  running_sum: 'Adds up everything from the first row of the window up to the current row.',
  moving_avg_3: 'Average of the current row and the 2 rows before it.',
  lag: 'Looks one row back. The first row has nothing before it → NULL.',
  lead: 'Looks one row ahead. The last row has nothing after it → NULL.',
  partition_sum: 'Total of the whole group, shown on every row (rows are NOT collapsed).',
  partition_avg: 'Average of the whole group, shown on every row.',
};

export function WindowViz({ config }: { config?: Record<string, unknown> }) {
  const cfg = { ...DEFAULT, ...(config ?? {}) } as typeof DEFAULT;
  const t = cfg.table;
  const pi = cfg.partitionBy ? t.columns.indexOf(cfg.partitionBy) : -1;
  const oi = t.columns.indexOf(cfg.orderBy);
  const vi = t.columns.indexOf(cfg.value);
  const fns = (cfg.functions as Fn[]) ?? (DEFAULT.functions as Fn[]);
  const [fn, setFn] = useState<Fn>(fns[0]);
  const [usePartition, setUsePartition] = useState(pi >= 0);
  const [sel, setSel] = useState(2);
  const usesValueOrder = fn === 'rank' || fn === 'dense_rank';
  // Ranking demos order by the value (desc) so ties are visible; others by the order column.
  const sortIdx = usesValueOrder ? vi : oi;

  const rows = useMemo(() => {
    const idx = t.rows.map((r, i) => ({ r, i }));
    idx.sort((a, b) => {
      if (usePartition && pi >= 0) {
        const pa = String(a.r[pi]);
        const pb = String(b.r[pi]);
        if (pa !== pb) return pa < pb ? -1 : 1;
      }
      const va = a.r[sortIdx] as number;
      const vb = b.r[sortIdx] as number;
      return usesValueOrder ? vb - va : va - vb;
    });
    return idx.map((x) => x.r);
  }, [t, pi, sortIdx, usePartition, usesValueOrder]);

  const part = (i: number) => (usePartition && pi >= 0 ? String(rows[i][pi]) : '*');
  const partRange = (i: number) => {
    let s = i;
    let e = i;
    while (s > 0 && part(s - 1) === part(i)) s--;
    while (e < rows.length - 1 && part(e + 1) === part(i)) e++;
    return [s, e];
  };

  const values = useMemo(() => {
    return rows.map((_, i) => {
      const [s, e] = partRange(i);
      const v = (k: number) => Number(rows[k][vi]);
      switch (fn) {
        case 'row_number':
          return String(i - s + 1);
        case 'rank': {
          let k = s;
          while (k < i && v(k) !== v(i)) k++;
          return String(k - s + 1);
        }
        case 'dense_rank': {
          const distinct = new Set<number>();
          for (let k = s; k <= i; k++) distinct.add(v(k));
          return String(distinct.size);
        }
        case 'running_sum': {
          let sum = 0;
          for (let k = s; k <= i; k++) sum += v(k);
          return String(sum);
        }
        case 'moving_avg_3': {
          const from = Math.max(s, i - 2);
          let sum = 0;
          for (let k = from; k <= i; k++) sum += v(k);
          return (sum / (i - from + 1)).toFixed(1);
        }
        case 'lag':
          return i > s ? String(v(i - 1)) : 'NULL';
        case 'lead':
          return i < e ? String(v(i + 1)) : 'NULL';
        case 'partition_sum': {
          let sum = 0;
          for (let k = s; k <= e; k++) sum += v(k);
          return String(sum);
        }
        case 'partition_avg': {
          let sum = 0;
          for (let k = s; k <= e; k++) sum += v(k);
          return (sum / (e - s + 1)).toFixed(1);
        }
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, fn, usePartition]);

  const selected = Math.min(sel, rows.length - 1);
  const [ps, pe] = partRange(selected);
  const inFrame = (i: number) => {
    if (i < ps || i > pe) return false;
    switch (fn) {
      case 'running_sum':
        return i <= selected;
      case 'moving_avg_3':
        return i <= selected && i >= Math.max(ps, selected - 2);
      case 'lag':
        return i === selected - 1;
      case 'lead':
        return i === selected + 1;
      default:
        return true;
    }
  };
  const partitionColors = ['#6366f1', '#ec4899', '#10b981', '#f59e0b'];
  const partNames = [...new Set(rows.map((_, i) => part(i)))];
  const over = [
    usePartition && pi >= 0 ? `PARTITION BY ${cfg.partitionBy}` : '',
    fn === 'partition_sum' || fn === 'partition_avg' ? '' : `ORDER BY ${usesValueOrder ? cfg.value + ' DESC' : cfg.orderBy}`,
    fn === 'moving_avg_3' ? 'ROWS BETWEEN 2 PRECEDING AND CURRENT ROW' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {fns.map((f) => (
          <button key={f} className={`btn btn-sm ${f === fn ? 'btn-primary' : 'btn-outline'}`} onClick={() => setFn(f)}>
            {LABEL[f]}
          </button>
        ))}
      </div>
      {pi >= 0 && (
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" checked={usePartition} onChange={(e) => setUsePartition(e.target.checked)} className="h-4 w-4 accent-[var(--c-primary)]" />
          Use <code className="font-mono text-xs">PARTITION BY {cfg.partitionBy}</code> (separate window for each {cfg.partitionBy})
        </label>
      )}
      <code className="block rounded-lg bg-code px-3 py-2 font-mono text-xs text-fg-2">
        SELECT *, {SQL[fn](cfg.value)} OVER ({over}) AS result FROM {t.name};
      </code>
      <p className="text-sm text-fg-2">{EXPLAIN[fn]}</p>
      <div className="overflow-x-auto">
        <table className="w-full overflow-hidden rounded-lg border border-line font-mono text-xs">
          <thead>
            <tr className="bg-surface-2">
              {t.columns.map((c) => (
                <th key={c} className="px-2 py-1 text-left">
                  {c}
                </th>
              ))}
              <th className="bg-primary-soft px-2 py-1 text-left text-primary">result</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const pColor = partitionColors[partNames.indexOf(part(i)) % partitionColors.length];
              const frame = inFrame(i);
              const isSel = i === selected;
              return (
                <tr
                  key={i}
                  onClick={() => setSel(i)}
                  className={`cursor-pointer border-t border-line transition ${isSel ? 'outline-2 -outline-offset-2 outline-primary' : ''}`}
                  style={{
                    background: frame ? `color-mix(in srgb, ${pColor} 22%, transparent)` : i >= ps && i <= pe ? `color-mix(in srgb, ${pColor} 6%, transparent)` : undefined,
                    boxShadow: usePartition && pi >= 0 ? `inset 4px 0 0 ${pColor}` : undefined,
                  }}
                >
                  {r.map((v, ci) => (
                    <td key={ci} className="px-2 py-1.5">
                      {String(v)}
                    </td>
                  ))}
                  <td className={`px-2 py-1.5 font-bold ${isSel ? 'text-primary' : ''}`}>{values[i] === 'NULL' ? <span className="null-badge">NULL</span> : values[i]}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted">Click any row: the rows used to calculate its result light up. Notice that no rows disappear — that's the magic of window functions.</p>
    </div>
  );
}
