import { ChevronRight, Eye, KeyRound, Link2, Table2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { datasetInfo } from '../content/load.ts';
import { db } from '../db/client.ts';
import type { SchemaInfo } from '../db/engine.ts';

const cache = new Map<string, SchemaInfo>();

/** Pristine schema of a dataset (cached). Pass a `version` to force refresh (playground). */
export function useSchema(dataset: string | undefined, opts: { persistent?: boolean; version?: number } = {}) {
  const key = dataset ? `${dataset}:${opts.persistent ? 'p' + (opts.version ?? 0) : 'fresh'}` : '';
  const [schema, setSchema] = useState<SchemaInfo | null>(() => (key ? (cache.get(key) ?? null) : null));
  useEffect(() => {
    if (!dataset) return;
    let alive = true;
    const hit = cache.get(key);
    if (hit) {
      setSchema(hit);
      return;
    }
    db.schema(dataset, opts.persistent)
      .then((s) => {
        if (!opts.persistent) cache.set(key, s);
        if (alive) setSchema(s);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [key, dataset, opts.persistent]);
  return schema;
}

interface Props {
  dataset: string;
  schema: SchemaInfo | null;
  onInsert?: (text: string) => void;
  onPreview?: (sql: string) => void;
  compact?: boolean;
}

export function SchemaPanel({ dataset, schema, onInsert, onPreview, compact }: Props) {
  const info = datasetInfo(dataset);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const tables = schema?.tables ?? [];
  const describe = (table: string, col?: string) => {
    const t = info?.tables.find((x) => x.name === table);
    if (!col) return t?.description;
    return t?.columns.find((c) => c.name === col)?.description;
  };

  return (
    <div className={`flex h-full flex-col ${compact ? '' : 'card'} overflow-hidden`}>
      <div className="border-b border-line px-3 py-2.5">
        <div className="flex items-center gap-2 text-sm font-bold">
          <span className="text-lg">{info?.icon ?? '🗄️'}</span>
          <span>{info?.name ?? dataset}</span>
        </div>
        {info?.tagline && <div className="mt-0.5 text-xs text-muted">{info.tagline}</div>}
      </div>
      <div className="flex-1 overflow-y-auto p-1.5">
        {!schema && <div className="p-3 text-xs text-muted">Loading tables…</div>}
        {schema && tables.length === 0 && (
          <div className="p-3 text-xs text-muted">This database is empty. Create a table with CREATE TABLE!</div>
        )}
        {tables.map((t) => {
          const isOpen = open[t.name] ?? false;
          return (
            <div key={t.name} className="mb-0.5">
              <div className="group flex items-center rounded-lg hover:bg-surface-2">
                <button
                  className="flex min-w-0 flex-1 items-center gap-1.5 px-2 py-1.5 text-left text-sm"
                  onClick={() => setOpen((o) => ({ ...o, [t.name]: !isOpen }))}
                  title={describe(t.name)}
                >
                  <ChevronRight size={14} className={`shrink-0 text-muted transition ${isOpen ? 'rotate-90' : ''}`} />
                  <Table2 size={14} className={`shrink-0 ${t.kind === 'table' ? 'text-primary' : 'text-pink'}`} />
                  <span className="truncate font-mono font-semibold">{t.name}</span>
                  {t.kind !== 'table' && <span className="chip !py-0 text-[10px]">{t.kind}</span>}
                </button>
                {onInsert && (
                  <button className="hidden px-1.5 text-[11px] font-semibold text-muted group-hover:block hover:text-primary" onClick={() => onInsert(t.name)} title="Insert table name">
                    + add
                  </button>
                )}
                {onPreview && (
                  <button className="px-1.5 text-muted hover:text-primary" onClick={() => onPreview(`SELECT *\nFROM ${t.name}\nLIMIT 10;`)} title="Preview 10 rows">
                    <Eye size={14} />
                  </button>
                )}
              </div>
              {isOpen && (
                <div className="mb-1 ml-5 border-l border-line pl-2">
                  {describe(t.name) && <div className="px-1 pb-1 text-[11px] text-muted">{describe(t.name)}</div>}
                  {t.columns.map((c) => (
                    <button
                      key={c.name}
                      className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-0.5 text-left text-xs hover:bg-surface-2"
                      title={describe(t.name, c.name) ?? `${c.type}${c.nullable ? '' : ', required'}`}
                      onClick={() => onInsert?.(c.name)}
                    >
                      {c.pk ? (
                        <KeyRound size={12} className="shrink-0 text-accent" />
                      ) : c.fk ? (
                        <Link2 size={12} className="shrink-0 text-primary" />
                      ) : (
                        <span className="inline-block w-3 shrink-0" />
                      )}
                      <span className="truncate font-mono">{c.name}</span>
                      <span className="ml-auto shrink-0 font-mono text-[10px] text-muted">{shortType(c.type)}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="flex gap-3 border-t border-line px-3 py-1.5 text-[10px] text-muted">
        <span className="flex items-center gap-1">
          <KeyRound size={11} className="text-accent" /> primary key
        </span>
        <span className="flex items-center gap-1">
          <Link2 size={11} className="text-primary" /> links to another table
        </span>
      </div>
    </div>
  );
}

function shortType(t: string): string {
  return t
    .replace('character varying', 'varchar')
    .replace('timestamp without time zone', 'timestamp')
    .replace('timestamp with time zone', 'timestamptz')
    .replace('double precision', 'double');
}
