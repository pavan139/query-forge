import { useMemo, useState } from 'react';

// ------------------------------------------------------------------ Execution order
const CLAUSES = [
  { k: 'SELECT', written: 1, run: 6, what: 'Pick (and calculate) the columns to show. Aliases are created here — that is why WHERE cannot use them.' },
  { k: 'DISTINCT', written: 2, run: 7, what: 'Remove duplicate rows from the result.' },
  { k: 'FROM', written: 3, run: 1, what: 'Choose the table(s). Everything starts here: SQL first gathers the rows.' },
  { k: 'JOIN … ON', written: 4, run: 2, what: 'Combine rows from other tables that match the ON condition.' },
  { k: 'WHERE', written: 5, run: 3, what: 'Throw away individual rows that do not pass the condition (before any grouping).' },
  { k: 'GROUP BY', written: 6, run: 4, what: 'Put the remaining rows into groups (buckets).' },
  { k: 'HAVING', written: 7, run: 5, what: 'Throw away whole groups that do not pass the condition (can use COUNT, SUM…).' },
  { k: 'ORDER BY', written: 8, run: 8, what: 'Sort the final rows. Runs after SELECT, so it CAN use aliases.' },
  { k: 'LIMIT / OFFSET', written: 9, run: 9, what: 'Keep only the first N rows of the sorted result.' },
];

export function ExecutionOrderViz({ config }: { config?: Record<string, unknown> }) {
  const highlight = new Set(((config?.highlight as string[]) ?? []).map((s) => s.toUpperCase()));
  const [order, setOrder] = useState<'written' | 'run'>('written');
  const [active, setActive] = useState<string | null>(null);
  const sorted = [...CLAUSES].sort((a, b) => a[order] - b[order]);
  const ROW = 46;
  return (
    <div className="space-y-3">
      <div className="flex gap-1.5">
        <button className={`btn btn-sm ${order === 'written' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setOrder('written')}>
          ✍️ Order you WRITE it
        </button>
        <button className={`btn btn-sm ${order === 'run' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setOrder('run')}>
          ⚙️ Order the database RUNS it
        </button>
      </div>
      <div className="grid gap-4 md:grid-cols-[minmax(0,280px)_1fr]">
        <div className="relative" style={{ height: CLAUSES.length * ROW }}>
          {CLAUSES.map((c) => {
            const pos = sorted.findIndex((x) => x.k === c.k);
            const hl = highlight.has(c.k) || highlight.has(c.k.split(' ')[0]);
            return (
              <button
                key={c.k}
                onClick={() => setActive(c.k)}
                className={`absolute right-0 left-0 flex items-center gap-3 rounded-xl border-2 px-3 py-2 text-left font-mono text-sm font-bold transition-all duration-500 ${
                  active === c.k ? 'border-primary bg-primary text-primary-fg' : hl ? 'border-pink bg-pink/10' : 'border-line bg-surface hover:border-primary/50'
                }`}
                style={{ top: pos * ROW, height: ROW - 8 }}
              >
                <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs ${active === c.k ? 'bg-white/25' : 'bg-surface-2 text-muted'}`}>{pos + 1}</span>
                {c.k}
              </button>
            );
          })}
        </div>
        <div className="rounded-xl border border-line bg-surface-2 p-4 text-sm">
          {active ? (
            <>
              <div className="mb-1 font-mono font-bold text-primary">{active}</div>
              <p className="text-fg-2">{CLAUSES.find((c) => c.k === active)?.what}</p>
              <p className="mt-3 text-xs text-muted">
                Written position: {CLAUSES.find((c) => c.k === active)?.written} · Run position: {CLAUSES.find((c) => c.k === active)?.run}
              </p>
            </>
          ) : (
            <p className="text-fg-2">
              We <b>write</b> SQL starting with SELECT, but the database <b>runs</b> it starting with FROM. Switch between the two orders and click any clause to learn what it does.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ NULL logic
type TV = 'TRUE' | 'FALSE' | 'NULL';
const TVS: TV[] = ['TRUE', 'FALSE', 'NULL'];
const and = (a: TV, b: TV): TV => (a === 'FALSE' || b === 'FALSE' ? 'FALSE' : a === 'NULL' || b === 'NULL' ? 'NULL' : 'TRUE');
const or = (a: TV, b: TV): TV => (a === 'TRUE' || b === 'TRUE' ? 'TRUE' : a === 'NULL' || b === 'NULL' ? 'NULL' : 'FALSE');
const not = (a: TV): TV => (a === 'NULL' ? 'NULL' : a === 'TRUE' ? 'FALSE' : 'TRUE');
const toneOf = (v: TV) => (v === 'TRUE' ? 'bg-success-soft text-success-fg' : v === 'FALSE' ? 'bg-danger-soft text-danger-fg' : 'bg-surface-3 text-muted italic');

export function NullLogicViz() {
  const [a, setA] = useState<TV>('TRUE');
  const [b, setB] = useState<TV>('NULL');
  const pick = (v: TV, set: (v: TV) => void, cur: TV) => (
    <button key={v} onClick={() => set(v)} className={`btn btn-sm ${cur === v ? 'btn-primary' : 'btn-outline'}`}>
      {v}
    </button>
  );
  const Pill = ({ v }: { v: TV }) => <span className={`inline-block min-w-14 rounded-md px-2 py-0.5 text-center font-mono text-xs font-bold ${toneOf(v)}`}>{v}</span>;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-sm font-bold">A =</span>
          {TVS.map((v) => pick(v, setA, a))}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-sm font-bold">B =</span>
          {TVS.map((v) => pick(v, setB, b))}
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ['A AND B', and(a, b)],
          ['A OR B', or(a, b)],
          ['NOT A', not(a)],
          ['A = B', a === 'NULL' || b === 'NULL' ? 'NULL' : a === b ? 'TRUE' : 'FALSE'],
        ].map(([label, v]) => (
          <div key={label} className="rounded-xl border border-line bg-surface p-3 text-center">
            <div className="font-mono text-xs text-muted">{label}</div>
            <div className="mt-1.5">
              <Pill v={v as TV} />
            </div>
          </div>
        ))}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {(['AND', 'OR'] as const).map((op) => (
          <table key={op} className="w-full overflow-hidden rounded-lg border border-line text-center text-xs">
            <thead>
              <tr className="bg-surface-2">
                <th className="px-2 py-1 font-mono">{op}</th>
                {TVS.map((v) => (
                  <th key={v} className="px-2 py-1 font-mono">
                    {v}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {TVS.map((x) => (
                <tr key={x} className="border-t border-line">
                  <th className="bg-surface-2 px-2 py-1 font-mono">{x}</th>
                  {TVS.map((y) => {
                    const v = op === 'AND' ? and(x, y) : or(x, y);
                    const hl = x === a && y === b;
                    return (
                      <td key={y} className={`px-2 py-1 ${hl ? 'outline-2 -outline-offset-2 outline-primary' : ''}`}>
                        <Pill v={v} />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        ))}
      </div>
      <p className="text-sm text-fg-2">
        NULL means <b>“unknown”</b>. Is unknown = unknown? We don't know → <b>NULL</b>. A WHERE clause only keeps rows where the condition is <b>TRUE</b> — so rows that evaluate to NULL are dropped too. That's why you must write <code className="font-mono">IS NULL</code>.
      </p>
    </div>
  );
}

// ------------------------------------------------------------------ Set operations
type SetOp = 'UNION' | 'UNION ALL' | 'INTERSECT' | 'EXCEPT';
export function SetOpsViz({ config }: { config?: Record<string, unknown> }) {
  const a = (config?.a as { name: string; values: string[] }) ?? { name: 'cafe_fans', values: ['Ana', 'Ben', 'Chen', 'Ana'] };
  const b = (config?.b as { name: string; values: string[] }) ?? { name: 'shop_fans', values: ['Ben', 'Dee', 'Chen'] };
  const [op, setOp] = useState<SetOp>('UNION');
  const result = useMemo(() => {
    const A = a.values.map(String);
    const B = b.values.map(String);
    const uniq = (x: string[]) => [...new Set(x)];
    if (op === 'UNION ALL') return [...A, ...B];
    if (op === 'UNION') return uniq([...A, ...B]);
    if (op === 'INTERSECT') return uniq(A.filter((x) => B.includes(x)));
    return uniq(A.filter((x) => !B.includes(x)));
  }, [a, b, op]);
  const inBoth = (v: string) => a.values.map(String).includes(v) && b.values.map(String).includes(v);
  const regions = { left: op !== 'INTERSECT', mid: op !== 'EXCEPT', right: op === 'UNION' || op === 'UNION ALL' };
  const EXPL: Record<SetOp, string> = {
    UNION: 'Everything from both lists, duplicates removed.',
    'UNION ALL': 'Everything from both lists, duplicates kept (and faster — no de-duplication work).',
    INTERSECT: 'Only values that appear in both lists.',
    EXCEPT: `Values in ${a.name} that are NOT in ${b.name}. Order matters!`,
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {(['UNION', 'UNION ALL', 'INTERSECT', 'EXCEPT'] as SetOp[]).map((o) => (
          <button key={o} className={`btn btn-sm ${o === op ? 'btn-primary' : 'btn-outline'}`} onClick={() => setOp(o)}>
            {o}
          </button>
        ))}
      </div>
      <div className="flex flex-col items-center gap-4 sm:flex-row">
        <svg viewBox="0 0 200 120" className="h-28 w-48 shrink-0">
          <defs>
            <clipPath id="sa">
              <circle cx="75" cy="60" r="45" />
            </clipPath>
          </defs>
          <circle cx="75" cy="60" r="45" fill={regions.left ? 'var(--c-primary)' : 'transparent'} fillOpacity="0.5" />
          <circle cx="125" cy="60" r="45" fill={regions.right ? 'var(--c-primary)' : 'transparent'} fillOpacity="0.5" />
          <g clipPath="url(#sa)">
            <circle cx="125" cy="60" r="45" fill={regions.mid ? 'var(--c-primary)' : 'var(--c-bg)'} fillOpacity={regions.mid ? 0.85 : 1} />
          </g>
          <circle cx="75" cy="60" r="45" fill="none" stroke="var(--c-fg-2)" strokeWidth="2" />
          <circle cx="125" cy="60" r="45" fill="none" stroke="var(--c-fg-2)" strokeWidth="2" />
          <text x="45" y="64" fontSize="10" fill="var(--c-fg)" textAnchor="middle" fontFamily="monospace">
            A
          </text>
          <text x="155" y="64" fontSize="10" fill="var(--c-fg)" textAnchor="middle" fontFamily="monospace">
            B
          </text>
        </svg>
        <p className="text-sm text-fg-2">{EXPL[op]}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {[
          [`A: ${a.name}`, a.values.map(String)],
          [`B: ${b.name}`, b.values.map(String)],
          [`A ${op} B`, result],
        ].map(([title, vals], i) => (
          <div key={i} className={`rounded-xl border p-2 ${i === 2 ? 'border-primary/40 bg-primary-soft/40' : 'border-line bg-surface'}`}>
            <div className="mb-1 font-mono text-xs font-bold text-muted">
              {title as string} <span className="font-normal">({(vals as string[]).length})</span>
            </div>
            <div className="flex flex-wrap gap-1">
              {(vals as string[]).map((v, j) => (
                <span key={j} className={`animate-pop rounded-md px-2 py-0.5 font-mono text-xs ${inBoth(v) ? 'bg-pink/15 text-pink' : 'bg-surface-2'}`} style={{ animationDelay: `${j * 40}ms` }}>
                  {v}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted">Pink values appear in both lists.</p>
    </div>
  );
}
