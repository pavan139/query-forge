import { useMemo, useState } from 'react';

type Cell = string | number | null;
interface MiniTable {
  name: string;
  columns: string[];
  rows: Cell[][];
}
type JoinType = 'inner' | 'left' | 'right' | 'full' | 'cross';

const DEFAULT = {
  left: { name: 'customers', columns: ['id', 'name'], rows: [[1, 'Ana'], [2, 'Ben'], [3, 'Chen'], [4, 'Dee']] },
  right: { name: 'orders', columns: ['order_id', 'customer_id', 'total'], rows: [[101, 1, 25], [102, 1, 8], [103, 3, 40], [104, 5, 12]] },
  on: ['id', 'customer_id'],
  types: ['inner', 'left', 'right', 'full', 'cross'],
};

const PALETTE = ['#6366f1', '#ec4899', '#10b981', '#f59e0b', '#06b6d4', '#8b5cf6', '#ef4444', '#84cc16'];
const LABEL: Record<JoinType, string> = { inner: 'INNER JOIN', left: 'LEFT JOIN', right: 'RIGHT JOIN', full: 'FULL OUTER JOIN', cross: 'CROSS JOIN' };
const EXPLAIN: Record<JoinType, string> = {
  inner: 'Only rows that have a match on both sides. Unmatched rows disappear.',
  left: 'Every row from the LEFT table, plus matches from the right. No match → NULLs on the right side.',
  right: 'Every row from the RIGHT table, plus matches from the left. No match → NULLs on the left side.',
  full: 'Every row from both tables. Matches are joined; anything unmatched gets NULLs on the other side.',
  cross: 'Every left row paired with every right row — no ON condition.',
};

export function JoinViz({ config }: { config?: Record<string, unknown> }) {
  const cfg = { ...DEFAULT, ...(config ?? {}) } as typeof DEFAULT;
  const left = cfg.left as MiniTable;
  const right = cfg.right as MiniTable;
  const [lc, rc] = cfg.on;
  const li = left.columns.indexOf(lc);
  const ri = right.columns.indexOf(rc);
  const types = (cfg.types as JoinType[]) ?? (DEFAULT.types as JoinType[]);
  const [type, setType] = useState<JoinType>(types[0]);
  const [hover, setHover] = useState<number | null>(null);

  const keyColor = useMemo(() => {
    const keys = [...new Set([...left.rows.map((r) => r[li]), ...right.rows.map((r) => r[ri])])];
    const shared = keys.filter((k) => left.rows.some((r) => r[li] === k) && right.rows.some((r) => r[ri] === k));
    return new Map(shared.map((k, i) => [k, PALETTE[i % PALETTE.length]]));
  }, [left, right, li, ri]);

  const result = useMemo(() => {
    const out: { l: number | null; r: number | null }[] = [];
    if (type === 'cross') {
      left.rows.forEach((_, a) => right.rows.forEach((__, b) => out.push({ l: a, r: b })));
      return out;
    }
    const matchedRight = new Set<number>();
    left.rows.forEach((lr, a) => {
      let any = false;
      right.rows.forEach((rr, b) => {
        if (lr[li] !== null && lr[li] === rr[ri]) {
          out.push({ l: a, r: b });
          matchedRight.add(b);
          any = true;
        }
      });
      if (!any && (type === 'left' || type === 'full')) out.push({ l: a, r: null });
    });
    if (type === 'right' || type === 'full') right.rows.forEach((_, b) => !matchedRight.has(b) && out.push({ l: null, r: b }));
    if (type === 'right') out.sort((x, y) => (x.r ?? 0) - (y.r ?? 0));
    return out;
  }, [type, left, right, li, ri]);

  const inResult = (side: 'l' | 'r', idx: number) => result.some((x) => x[side] === idx);
  const hoverRow = hover !== null ? result[hover] : null;

  const tableView = (t: MiniTable, side: 'l' | 'r', keyIdx: number) => (
    <div className="min-w-0 flex-1">
      <div className="mb-1 font-mono text-xs font-bold text-muted">{t.name}</div>
      <table className="w-full overflow-hidden rounded-lg border border-line font-mono text-xs">
        <thead>
          <tr className="bg-surface-2">
            {t.columns.map((c, i) => (
              <th key={c} className={`px-2 py-1 text-left font-semibold ${i === keyIdx ? 'text-primary' : ''}`}>
                {c}
                {i === keyIdx && ' 🔑'}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {t.rows.map((r, idx) => {
            const color = keyColor.get(r[keyIdx]);
            const kept = inResult(side, idx);
            const hl = hoverRow && hoverRow[side] === idx;
            return (
              <tr
                key={idx}
                className={`border-t border-line transition ${kept ? '' : 'opacity-35'} ${hl ? 'bg-primary-soft' : ''}`}
                style={{ boxShadow: color && type !== 'cross' ? `inset 4px 0 0 ${color}` : undefined }}
              >
                {r.map((v, i) => (
                  <td key={i} className="px-2 py-1">
                    {v === null ? <span className="null-badge">NULL</span> : String(v)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5">
        {types.map((t) => (
          <button key={t} className={`btn btn-sm ${t === type ? 'btn-primary' : 'btn-outline'}`} onClick={() => setType(t)}>
            {LABEL[t]}
          </button>
        ))}
      </div>
      <div className="flex flex-col items-center gap-4 sm:flex-row">
        <Venn type={type} a={left.name} b={right.name} />
        <p className="text-sm text-fg-2">
          {EXPLAIN[type]}
          {type === 'cross' && ` ${left.rows.length} × ${right.rows.length} = ${left.rows.length * right.rows.length} rows!`}
        </p>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row">
        {tableView(left, 'l', li)}
        {tableView(right, 'r', ri)}
      </div>
      <div>
        <div className="mb-1 flex items-center justify-between">
          <code className="font-mono text-xs text-fg-2">
            SELECT * FROM {left.name} {LABEL[type]} {right.name}
            {type !== 'cross' && ` ON ${left.name}.${lc} = ${right.name}.${rc}`}
          </code>
          <span className="chip bg-primary-soft text-primary">{result.length} rows</span>
        </div>
        <div className="max-h-72 overflow-auto rounded-lg border border-line">
          <table className="w-full font-mono text-xs">
            <thead className="sticky top-0">
              <tr className="bg-surface-2">
                {left.columns.map((c) => (
                  <th key={'l' + c} className="px-2 py-1 text-left font-semibold">
                    {c}
                  </th>
                ))}
                {right.columns.map((c) => (
                  <th key={'r' + c} className="border-l-2 border-primary/30 px-2 py-1 text-left font-semibold">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.map((x, i) => {
                const key = x.l !== null ? left.rows[x.l][li] : x.r !== null ? right.rows[x.r][ri] : null;
                const color = type !== 'cross' && x.l !== null && x.r !== null ? keyColor.get(key) : undefined;
                return (
                  <tr key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} className="animate-fade-up border-t border-line hover:bg-primary-soft/60" style={{ boxShadow: color ? `inset 4px 0 0 ${color}` : undefined, animationDelay: `${i * 25}ms` }}>
                    {left.columns.map((_, c) => (
                      <td key={'l' + c} className="px-2 py-1">
                        {x.l === null ? <span className="null-badge">NULL</span> : String(left.rows[x.l][c] ?? 'NULL')}
                      </td>
                    ))}
                    {right.columns.map((_, c) => (
                      <td key={'r' + c} className="border-l-2 border-primary/30 px-2 py-1">
                        {x.r === null ? <span className="null-badge">NULL</span> : String(right.rows[x.r][c] ?? 'NULL')}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-1.5 text-xs text-muted">Faded rows in the source tables are left out of the result. Coloured stripes show which rows matched. Hover a result row to see where it came from.</p>
      </div>
    </div>
  );
}

function Venn({ type, a, b }: { type: JoinType; a: string; b: string }) {
  const on = 'var(--c-primary)';
  const off = 'transparent';
  const leftOnly = type === 'left' || type === 'full' || type === 'cross';
  const rightOnly = type === 'right' || type === 'full' || type === 'cross';
  return (
    <svg viewBox="0 0 200 120" className="h-28 w-48 shrink-0" role="img" aria-label={`Venn diagram for ${type} join`}>
      <defs>
        <clipPath id="vl">
          <circle cx="75" cy="60" r="45" />
        </clipPath>
        <clipPath id="vr">
          <circle cx="125" cy="60" r="45" />
        </clipPath>
      </defs>
      <circle cx="75" cy="60" r="45" fill={leftOnly ? on : off} fillOpacity="0.55" />
      <circle cx="125" cy="60" r="45" fill={rightOnly ? on : off} fillOpacity="0.55" />
      <g clipPath="url(#vl)">
        <circle cx="125" cy="60" r="45" fill={on} fillOpacity={0.85} />
      </g>
      <circle cx="75" cy="60" r="45" fill="none" stroke="var(--c-fg-2)" strokeWidth="2" />
      <circle cx="125" cy="60" r="45" fill="none" stroke="var(--c-fg-2)" strokeWidth="2" />
      <text x="45" y="64" fontSize="11" fill="var(--c-fg)" fontFamily="monospace" textAnchor="middle">
        {a.slice(0, 9)}
      </text>
      <text x="155" y="64" fontSize="11" fill="var(--c-fg)" fontFamily="monospace" textAnchor="middle">
        {b.slice(0, 9)}
      </text>
    </svg>
  );
}
