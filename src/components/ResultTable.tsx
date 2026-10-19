import { useMemo, useState } from 'react';
import type { StatementResult } from '../db/engine.ts';
import { displayValue, isNumericType, typeName } from '../db/values.ts';

interface Props {
  result: StatementResult;
  /** Row indices to highlight as wrong (extra) */
  badRows?: number[];
  /** Row indices to highlight as missing (in the expected table) */
  missingRows?: number[];
  maxHeight?: number;
  compact?: boolean;
  caption?: string;
}

const PAGE = 100;

export function ResultTable({ result, badRows, missingRows, maxHeight = 360, compact, caption }: Props) {
  const [shown, setShown] = useState(PAGE);
  const bad = useMemo(() => new Set(badRows ?? []), [badRows]);
  const missing = useMemo(() => new Set(missingRows ?? []), [missingRows]);
  const rows = result.rows.slice(0, shown);
  const cell = compact ? 'px-2.5 py-1' : 'px-3 py-1.5';

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface">
      {caption && <div className="border-b border-line bg-surface-2 px-3 py-1.5 text-xs font-semibold text-muted">{caption}</div>}
      <div className="overflow-auto" style={{ maxHeight }}>
        <table className="grid-table w-full border-separate border-spacing-0 font-mono text-[13px]">
          <thead>
            <tr>
              <th className={`${cell} w-10 border-b border-line bg-surface-2 text-right text-[11px] font-medium text-muted`}>#</th>
              {result.columns.map((c, i) => (
                <th key={i} className={`${cell} border-b border-l border-line bg-surface-2 text-left font-sans font-semibold whitespace-nowrap text-fg`}>
                  <div className="flex items-baseline gap-1.5">
                    <span>{c.name}</span>
                    <span className="text-[10px] font-normal text-muted">{typeName(c.typeId)}</span>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, ri) => {
              const tone = bad.has(ri) ? 'bg-danger-soft' : missing.has(ri) ? 'bg-success-soft' : ri % 2 ? 'bg-surface-2/40' : '';
              return (
                <tr key={ri} className={`${tone} hover:bg-primary-soft/60`}>
                  <td className={`${cell} border-b border-line text-right text-[11px] text-muted`}>{ri + 1}</td>
                  {r.map((v, ci) => {
                    const t = result.columns[ci]?.typeId ?? 25;
                    const num = isNumericType(t);
                    return (
                      <td key={ci} className={`${cell} max-w-[28rem] truncate border-b border-l border-line whitespace-nowrap ${num ? 'text-right tabular-nums' : ''}`} title={v === null ? 'NULL' : displayValue(v, t)}>
                        {v === null || v === undefined ? <span className="null-badge">NULL</span> : displayValue(v, t)}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            {result.rows.length === 0 && (
              <tr>
                <td colSpan={result.columns.length + 1} className="px-3 py-6 text-center font-sans text-sm text-muted">
                  The query worked, but no rows matched. (0 rows)
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {(result.rows.length > shown || result.truncated) && (
        <div className="flex items-center justify-between border-t border-line bg-surface-2 px-3 py-1.5 text-xs text-muted">
          <span>
            Showing {Math.min(shown, result.rows.length)} of {result.rowCount.toLocaleString()} rows
          </span>
          {result.rows.length > shown && (
            <button className="btn btn-ghost btn-sm" onClick={() => setShown((s) => s + PAGE * 5)}>
              Show more
            </button>
          )}
        </div>
      )}
    </div>
  );
}
