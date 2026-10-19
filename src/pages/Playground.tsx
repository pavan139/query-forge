import { RotateCcw, Save, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { CodeBlock } from '../components/CodeBlock.tsx';
import { Page, PageHeader } from '../components/ui.tsx';
import { Workbench } from '../components/Workbench.tsx';
import { datasets } from '../content/load.ts';
import { db } from '../db/client.ts';
import { friendlyDate } from '../lib/dates.ts';
import { toast } from '../lib/events.ts';
import { useStore } from '../state/store.ts';

const STARTERS: Record<string, string> = {
  blank: `-- An empty database: build anything!
CREATE TABLE pets (
    pet_id   integer PRIMARY KEY,
    name     text NOT NULL,
    species  text,
    born_on  date
);

INSERT INTO pets VALUES
    (1, 'Biscuit', 'dog', '2020-04-01'),
    (2, 'Mochi', 'cat', '2021-09-15');

SELECT * FROM pets;`,
};

export default function Playground() {
  const [dataset, setDataset] = useState(() => localStorageGet('pg-dataset') ?? 'shop');
  const [version, setVersion] = useState(0);
  const [key, setKey] = useState(0);
  const snippets = useStore((s) => s.snippets);
  const saveSnippet = useStore((s) => s.saveSnippet);
  const deleteSnippet = useStore((s) => s.deleteSnippet);
  const draft = useStore((s) => s.drafts[`playground:${dataset}`]);
  const setDraft = useStore((s) => s.setDraft);
  const info = datasets.find((d) => d.id === dataset);
  const initial = STARTERS[dataset] ?? `-- ${info?.name}: ${info?.tagline ?? ''}\n-- Try anything! Changes stay until you press "Reset data".\nSELECT *\nFROM ${info?.tables[0]?.name ?? 'table_name'}\nLIMIT 10;`;

  const choose = (d: string) => {
    setDataset(d);
    localStorageSet('pg-dataset', d);
    setKey((k) => k + 1);
  };

  return (
    <Page wide>
      <PageHeader
        icon="🛠️"
        title="Playground"
        subtitle="Your free-play SQL sandbox. Unlike lessons, changes you make here (new tables, updates…) stay until you reset."
        actions={
          <>
            <button
              className="btn btn-outline btn-sm"
              onClick={async () => {
                await db.reset(dataset);
                setVersion((v) => v + 1);
                toast('Data reset to the original dataset.', 'success');
              }}
            >
              <RotateCcw size={14} /> Reset data
            </button>
            <button
              className="btn btn-primary btn-sm"
              onClick={() => {
                const title = prompt('Name this query:', 'My query');
                if (title) {
                  saveSnippet({ title, sql: draft ?? initial, dataset });
                  toast('Saved to your snippets.', 'success');
                }
              }}
            >
              <Save size={14} /> Save query
            </button>
          </>
        }
      />
      <div className="mb-4 flex flex-wrap gap-1.5">
        {datasets.map((d) => (
          <button key={d.id} onClick={() => choose(d.id)} className={`btn btn-sm ${dataset === d.id ? 'btn-primary' : 'btn-outline'}`} title={d.tagline}>
            {d.icon} {d.name}
          </button>
        ))}
      </div>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="card p-4">
          <Workbench
            key={`${dataset}:${key}`}
            draftKey={`playground:${dataset}`}
            dataset={dataset}
            initialSql={initial}
            mode="playground"
            persistent
            showSchema
            schemaVersion={version}
            editorMinHeight={220}
            onRunDone={(r) => r.mutated && setVersion((v) => v + 1)}
          />
        </div>
        <aside className="space-y-3">
          <div className="text-sm font-bold">💾 Saved queries</div>
          {snippets.length === 0 && <div className="rounded-xl border border-dashed border-line p-4 text-xs text-muted">Save useful queries here to build your personal library.</div>}
          {snippets.map((s) => (
            <div key={s.id} className="card p-3">
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-bold">{s.title}</div>
                  <div className="text-[11px] text-muted">
                    {datasets.find((d) => d.id === s.dataset)?.icon} {s.dataset} · {friendlyDate(s.at)}
                  </div>
                </div>
                <button
                  className="btn btn-ghost btn-sm !px-1.5"
                  onClick={() => {
                    setDraft(`playground:${s.dataset}`, s.sql);
                    choose(s.dataset);
                  }}
                >
                  Open
                </button>
                <button className="btn btn-ghost btn-sm !px-1.5 text-muted hover:text-danger" onClick={() => confirm('Delete this saved query?') && deleteSnippet(s.id)}>
                  <Trash2 size={14} />
                </button>
              </div>
              <CodeBlock sql={s.sql.split('\n').slice(0, 4).join('\n')} className="mt-2 text-xs" copy={false} />
            </div>
          ))}
        </aside>
      </div>
    </Page>
  );
}

function localStorageGet(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function localStorageSet(k: string, v: string) {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* ignore */
  }
}
