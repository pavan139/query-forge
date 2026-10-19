import { AlertTriangle, CheckCircle2, ChevronDown, Info, Lightbulb, MessageSquareWarning } from 'lucide-react';
import { useState } from 'react';
import type { RunOutput, SchemaInfo, SqlError, StatementResult } from '../db/engine.ts';
import { explainError } from '../db/explain-error.ts';
import { ResultTable } from './ResultTable.tsx';

export function namesFrom(schema?: SchemaInfo | null) {
  return {
    tables: schema?.tables.map((t) => t.name) ?? [],
    columns: [...new Set(schema?.tables.flatMap((t) => t.columns.map((c) => c.name)) ?? [])],
  };
}

export function ErrorBox({ error, sql, schema }: { error: SqlError; sql: string; schema?: SchemaInfo | null }) {
  const [raw, setRaw] = useState(false);
  const f = explainError(error, sql, namesFrom(schema));
  return (
    <div className="animate-fade-up rounded-xl border border-danger/30 bg-danger-soft p-4">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 rounded-lg bg-danger/15 p-1.5 text-danger">
          <MessageSquareWarning size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-bold text-danger-fg">{f.title}</div>
          <p className="mt-1 text-sm text-fg-2">{f.explanation}</p>
          {f.tips.length > 0 && (
            <ul className="mt-2 space-y-1">
              {f.tips.map((t, i) => (
                <li key={i} className="flex gap-2 text-sm text-fg-2">
                  <Lightbulb size={15} className="mt-0.5 shrink-0 text-accent" />
                  <span>{t}</span>
                </li>
              ))}
            </ul>
          )}
          {error.statementIndex !== undefined && error.statementIndex > 0 && (
            <p className="mt-2 text-xs text-muted">
              Statement {error.statementIndex + 1} failed. The {error.statementIndex} statement{error.statementIndex > 1 ? 's' : ''} before it ran fine.
            </p>
          )}
          <button className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-muted hover:text-fg" onClick={() => setRaw((r) => !r)}>
            <ChevronDown size={14} className={raw ? 'rotate-180 transition' : 'transition'} /> PostgreSQL's exact message
          </button>
          {raw && (
            <pre className="mt-1 overflow-x-auto rounded-lg bg-surface p-2 font-mono text-xs whitespace-pre-wrap text-fg-2">
              ERROR: {error.message}
              {error.code ? `\nSQLSTATE: ${error.code}` : ''}
              {error.detail ? `\nDETAIL: ${error.detail}` : ''}
              {error.hint ? `\nHINT: ${error.hint}` : ''}
              {error.where ? `\nCONTEXT: ${error.where}` : ''}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}

function PlanView({ result }: { result: StatementResult }) {
  const lines = result.rows.map((r) => String(r[0] ?? ''));
  const json = lines.length === 1 && lines[0].trim().startsWith('[');
  const text = json ? JSON.stringify(JSON.parse(lines[0]), null, 2) : lines.join('\n');
  const timing = /Execution Time: ([\d.]+) ms/.exec(text)?.[1];
  const tone = (l: string) =>
    /Seq Scan/.test(l)
      ? 'text-amber-600 dark:text-amber-300'
      : /Index Only Scan|Index Scan|Bitmap/.test(l)
        ? 'text-emerald-600 dark:text-emerald-300'
        : /Join|Nested Loop|Hash|Merge|Sort|Aggregate|Limit|Unique|WindowAgg|Append|CTE/.test(l)
          ? 'text-primary'
          : 'text-fg-2';
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface">
      <div className="flex items-center justify-between border-b border-line bg-surface-2 px-3 py-1.5 text-xs font-semibold text-muted">
        <span>Query plan — read from the most indented line upwards</span>
        {timing && <span className="chip bg-primary-soft text-primary">⏱ {timing} ms</span>}
      </div>
      <pre className="max-h-96 overflow-auto p-3 font-mono text-[12.5px] leading-relaxed">
        {text.split('\n').map((l, i) => (
          <div key={i} className={tone(l)}>
            {l || ' '}
          </div>
        ))}
      </pre>
    </div>
  );
}

function StatementSummary({ r }: { r: StatementResult }) {
  const verb = r.command.split(' ')[0];
  let text = `${r.command} completed`;
  if (verb === 'INSERT') text = `INSERT — ${r.affectedRows} row${r.affectedRows === 1 ? '' : 's'} added`;
  else if (verb === 'UPDATE') text = `UPDATE — ${r.affectedRows} row${r.affectedRows === 1 ? '' : 's'} changed`;
  else if (verb === 'DELETE') text = `DELETE — ${r.affectedRows} row${r.affectedRows === 1 ? '' : 's'} removed`;
  else if (verb === 'MERGE') text = `MERGE — ${r.affectedRows} row${r.affectedRows === 1 ? '' : 's'} affected`;
  return (
    <div className="flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg-2">
      <CheckCircle2 size={16} className="text-success" />
      <span className="font-medium">{text}</span>
      <code className="ml-auto max-w-[50%] truncate font-mono text-xs text-muted">{r.sql.split('\n')[0]}</code>
    </div>
  );
}

export function ResultsPanel({ run, sql, schema, maxHeight }: { run: RunOutput; sql: string; schema?: SchemaInfo | null; maxHeight?: number }) {
  const withRows = run.results.filter((r) => r.columns.length > 0);
  const [tab, setTab] = useState<number | null>(null);
  const active = tab !== null && tab < withRows.length ? tab : withRows.length - 1;
  const shown = withRows[active];
  const others = run.results.filter((r) => r.columns.length === 0);

  return (
    <div className="space-y-2">
      {run.error && <ErrorBox error={run.error} sql={sql} schema={schema} />}
      {others.length > 0 && others.length <= 6 && others.map((r) => <StatementSummary key={r.index} r={r} />)}
      {others.length > 6 && (
        <div className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg-2">
          <CheckCircle2 size={16} className="mr-1 inline text-success" /> {others.length} statements ran successfully.
        </div>
      )}
      {run.notices.length > 0 && (
        <div className="rounded-lg border border-line bg-info-soft px-3 py-2 font-mono text-xs text-fg-2">
          <div className="mb-1 flex items-center gap-1.5 font-sans font-semibold">
            <Info size={14} /> Messages
          </div>
          {run.notices.slice(0, 50).map((n, i) => (
            <div key={i}>{n}</div>
          ))}
        </div>
      )}
      {withRows.length > 1 && (
        <div className="flex flex-wrap gap-1">
          {withRows.map((r, i) => (
            <button key={r.index} onClick={() => setTab(i)} className={`btn btn-sm ${i === active ? 'btn-primary' : 'btn-outline'}`}>
              Result {i + 1}
              <span className="opacity-70">({r.rowCount})</span>
            </button>
          ))}
        </div>
      )}
      {shown &&
        (shown.command === 'EXPLAIN' && shown.columns.length === 1 ? (
          <PlanView result={shown} />
        ) : (
          <>
            <ResultTable result={shown} maxHeight={maxHeight} />
            <div className="flex items-center gap-3 px-1 text-xs text-muted">
              <span>
                {shown.rowCount.toLocaleString()} row{shown.rowCount === 1 ? '' : 's'}
              </span>
              <span>·</span>
              <span>{run.ms < 1 ? '<1' : Math.round(run.ms)} ms</span>
            </div>
          </>
        ))}
      {!run.error && withRows.length === 0 && others.length === 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-muted">
          <AlertTriangle size={15} /> Nothing to run — the editor only has comments or is empty.
        </div>
      )}
    </div>
  );
}
