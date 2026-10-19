import { useEffect, useMemo, useRef, useState } from 'react';

const CELLS = 200;

export function IndexViz({ config }: { config?: Record<string, unknown> }) {
  const total = Number(config?.rows ?? 1000);
  const perCell = Math.ceil(total / CELLS);
  // A shuffled heap: where each id physically lives in the table.
  const placement = useMemo(() => {
    const arr = Array.from({ length: CELLS }, (_, i) => i);
    let seed = 7;
    for (let i = arr.length - 1; i > 0; i--) {
      seed = (seed * 16807) % 2147483647;
      const j = seed % (i + 1);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }, []);
  const [target, setTarget] = useState(Math.round(total * 0.73));
  const [scan, setScan] = useState(-1);
  const [found, setFound] = useState(false);
  const [treeStep, setTreeStep] = useState(-1);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const targetCell = placement.indexOf(Math.min(CELLS - 1, Math.floor((target - 1) / perCell)));
  const depth = Math.max(2, Math.ceil(Math.log(total) / Math.log(200)) + 1);

  useEffect(() => () => {
    if (timer.current) clearInterval(timer.current);
  }, []);

  const start = () => {
    if (timer.current) clearInterval(timer.current);
    setFound(false);
    setScan(0);
    setTreeStep(0);
    let i = 0;
    let t = 0;
    timer.current = setInterval(() => {
      i += 3;
      t += 1;
      setTreeStep((s) => (t % 6 === 0 && s < depth ? s + 1 : s));
      if (i >= CELLS) {
        // Seq scan always reads the whole table (it can't know there isn't another match).
        setScan(CELLS);
        setFound(true);
        if (timer.current) clearInterval(timer.current);
        setTreeStep(depth);
      } else setScan(i);
    }, 30);
  };

  const levels = ['root', ...Array.from({ length: depth - 2 }, () => 'branch'), 'leaf'];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm font-semibold">
          Find the row with id ={' '}
          <input
            type="number"
            min={1}
            max={total}
            value={target}
            onChange={(e) => setTarget(Math.max(1, Math.min(total, Number(e.target.value) || 1)))}
            className="w-24 rounded-lg border border-line bg-surface px-2 py-1 font-mono"
          />
        </label>
        <button className="btn btn-primary btn-sm" onClick={start}>
          ▶ Race them!
        </button>
        <code className="font-mono text-xs text-muted">SELECT * FROM orders WHERE id = {target};</code>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-line bg-surface p-3">
          <div className="mb-1 flex items-center justify-between">
            <div className="text-sm font-bold">🐢 Without an index: Seq Scan</div>
            <span className="chip">{Math.min(total, Math.max(0, scan) * perCell).toLocaleString()} rows read</span>
          </div>
          <p className="mb-2 text-xs text-muted">Reads every row of the table, one by one, like flipping through every page of a book.</p>
          <div className="grid grid-cols-20 gap-[2px]" style={{ gridTemplateColumns: 'repeat(20, minmax(0, 1fr))' }}>
            {Array.from({ length: CELLS }, (_, i) => (
              <div
                key={i}
                className="aspect-square rounded-[2px] transition-colors"
                style={{
                  background: i === targetCell && scan >= i ? 'var(--c-success)' : scan > i ? 'color-mix(in srgb, var(--c-accent) 70%, transparent)' : 'var(--c-surface-3)',
                }}
              />
            ))}
          </div>
        </div>
        <div className="rounded-xl border border-line bg-surface p-3">
          <div className="mb-1 flex items-center justify-between">
            <div className="text-sm font-bold">🚀 With an index: Index Scan</div>
            <span className="chip">{Math.max(0, Math.min(treeStep, depth))} pages read</span>
          </div>
          <p className="mb-2 text-xs text-muted">A B-tree is like a book's index: jump from the root to the right branch, then to the exact leaf.</p>
          <div className="space-y-2">
            {levels.map((lvl, d) => {
              const nodes = d === 0 ? 1 : d === levels.length - 1 ? 8 : 4;
              const active = Math.min(nodes - 1, Math.floor(((target - 1) / total) * nodes));
              return (
                <div key={d} className="flex items-center gap-2">
                  <span className="w-12 text-[10px] font-semibold text-muted uppercase">{lvl}</span>
                  <div className="flex flex-1 justify-center gap-1">
                    {Array.from({ length: nodes }, (_, n) => {
                      const lo = Math.floor((n / nodes) * total) + 1;
                      const hi = Math.floor(((n + 1) / nodes) * total);
                      const on = treeStep > d && n === active;
                      return (
                        <div key={n} className={`flex-1 rounded-md border px-1 py-1 text-center font-mono text-[9px] transition ${on ? 'border-success bg-success text-white' : 'border-line bg-surface-2 text-muted'}`}>
                          {lo}–{hi}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
          {treeStep >= depth && <div className="mt-2 text-xs font-semibold text-success-fg">Found id {target} after reading just {depth} pages!</div>}
        </div>
      </div>
      {found && (
        <p className="animate-fade-up text-sm text-fg-2">
          The sequential scan read <b>all {total.toLocaleString()} rows</b>. The index needed about <b>{depth} page reads</b>. With 10 million rows, an index lookup still needs only ~4 — that's why indexes make lookups fast. The price: indexes take space and make INSERT/UPDATE a bit slower.
        </p>
      )}
    </div>
  );
}
