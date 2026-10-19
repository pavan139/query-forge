import { Eye, KeyRound, Link2, TerminalSquare } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ErDiagram } from '../components/ErDiagram.tsx';
import { ResultsPanel } from '../components/ResultsPanel.tsx';
import { useSchema } from '../components/SchemaPanel.tsx';
import { Page, PageHeader } from '../components/ui.tsx';
import { datasets } from '../content/load.ts';
import { db } from '../db/client.ts';
import type { RunOutput } from '../db/engine.ts';
import { useStore } from '../state/store.ts';

export default function Datasets() {
  const { datasetId } = useParams();
  const nav = useNavigate();
  const id = datasetId ?? datasets[0]?.id ?? 'cafe';
  const info = datasets.find((d) => d.id === id);
  const schema = useSchema(id);
  const viewDataset = useStore((s) => s.viewDataset);
  const setDraft = useStore((s) => s.setDraft);
  const [preview, setPreview] = useState<{ table: string; run: RunOutput } | null>(null);
  useEffect(() => {
    viewDataset(id);
    setPreview(null);
  }, [id, viewDataset]);

  const show = async (table: string) => {
    const run = await db.run(id, `SELECT * FROM ${table} LIMIT 25;`);
    setPreview({ table, run });
    setTimeout(() => document.getElementById('preview')?.scrollIntoView({ behavior: 'smooth' }), 50);
  };

  return (
    <Page wide>
      <PageHeader icon="🗄️" title="Datasets" subtitle="The practice databases you'll query throughout the course. Each one tells a little story." />
      <div className="mb-6 flex flex-wrap gap-2">
        {datasets.map((d) => (
          <Link key={d.id} to={`/datasets/${d.id}`} className={`btn btn-sm ${d.id === id ? 'btn-primary' : 'btn-outline'}`}>
            {d.icon} {d.name}
          </Link>
        ))}
      </div>
      {info && (
        <>
          <div className="card mb-6 flex flex-col gap-4 p-6 sm:flex-row sm:items-center">
            <div className="text-5xl">{info.icon}</div>
            <div className="flex-1">
              <h2 className="text-2xl font-extrabold">{info.name}</h2>
              <div className="text-sm font-semibold text-primary">{info.tagline}</div>
              <p className="mt-1 text-sm text-fg-2">{info.description}</p>
            </div>
            <button
              className="btn btn-outline"
              onClick={() => {
                setDraft(`playground:${id}`, `SELECT *\nFROM ${info.tables[0]?.name ?? ''}\nLIMIT 10;`);
                try {
                  localStorage.setItem('pg-dataset', id);
                } catch {
                  /* ignore */
                }
                nav('/playground');
              }}
            >
              <TerminalSquare size={16} /> Open in Playground
            </button>
          </div>
          {schema && schema.tables.length > 0 && (
            <section className="mb-6">
              <h3 className="mb-2 font-bold">How the tables connect</h3>
              <p className="mb-3 text-xs text-muted">
                🔑 = primary key (unique id of each row). 🔗 = foreign key (points to a row in another table). Lines show which tables you can JOIN. Click a table to preview it.
              </p>
              <ErDiagram schema={schema} onTable={show} />
            </section>
          )}
          <div className="grid gap-4 md:grid-cols-2">
            {info.tables.map((t) => {
              const live = schema?.tables.find((x) => x.name === t.name);
              return (
                <div key={t.name} className="card p-5">
                  <div className="flex items-center gap-2">
                    <div className="font-mono text-lg font-bold">{t.name}</div>
                    <span className="chip">{t.rowCount.toLocaleString()} rows</span>
                    <button className="btn btn-ghost btn-sm ml-auto" onClick={() => show(t.name)}>
                      <Eye size={14} /> Preview
                    </button>
                  </div>
                  <p className="mt-1 text-sm text-muted">{t.description}</p>
                  <table className="mt-3 w-full text-xs">
                    <tbody>
                      {t.columns.map((c) => {
                        const lc = live?.columns.find((x) => x.name === c.name);
                        return (
                          <tr key={c.name} className="border-t border-line">
                            <td className="py-1.5 pr-2 font-mono font-semibold whitespace-nowrap">
                              {lc?.pk ? <KeyRound size={11} className="mr-1 inline text-accent" /> : lc?.fk ? <Link2 size={11} className="mr-1 inline text-primary" /> : null}
                              {c.name}
                            </td>
                            <td className="py-1.5 pr-2 font-mono whitespace-nowrap text-muted">{c.type}</td>
                            <td className="py-1.5 text-fg-2">{c.description}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              );
            })}
          </div>
          {preview && (
            <section id="preview" className="mt-6 scroll-mt-6">
              <h3 className="mb-2 font-bold">
                Preview: <code className="font-mono">{preview.table}</code> (first 25 rows)
              </h3>
              <ResultsPanel run={preview.run} sql="" />
            </section>
          )}
        </>
      )}
    </Page>
  );
}
