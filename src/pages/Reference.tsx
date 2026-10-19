import { Bookmark, NotebookPen, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CodeBlock } from '../components/CodeBlock.tsx';
import { Markdown } from '../components/Markdown.tsx';
import { Page, PageHeader } from '../components/ui.tsx';
import { lessonLocation, useAllModules, useGlossary } from '../content/load.ts';
import { useStore } from '../state/store.ts';

type Tab = 'cheats' | 'glossary' | 'notes';

export default function Reference() {
  const mods = useAllModules();
  const glossary = useGlossary();
  const notes = useStore((s) => s.notes);
  const bookmarks = useStore((s) => s.bookmarks);
  const [tab, setTab] = useState<Tab>('cheats');
  const [q, setQ] = useState('');
  const query = q.toLowerCase();

  const cheats = useMemo(
    () =>
      (mods ?? []).map((m) => ({
        m,
        entries: m.lessons.flatMap((l) => (l.cheatsheet ?? []).map((c) => ({ ...c, lesson: l }))).filter((c) => !query || `${c.title} ${c.sql} ${c.note ?? ''}`.toLowerCase().includes(query)),
      })),
    [mods, query],
  );
  const terms = (glossary ?? []).filter((g) => !query || `${g.term} ${g.definition}`.toLowerCase().includes(query));
  const noteEntries = Object.entries(notes).filter(([, t]) => t.trim());

  return (
    <Page wide>
      <PageHeader icon="📌" title="Cheat sheet & glossary" subtitle="Everything you've learned, in one searchable place." />
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex gap-1.5">
          {(
            [
              ['cheats', 'Syntax cheat sheet'],
              ['glossary', `Glossary${glossary ? ` (${glossary.length})` : ''}`],
              ['notes', 'My notes & bookmarks'],
            ] as const
          ).map(([t, label]) => (
            <button key={t} className={`btn btn-sm ${tab === t ? 'btn-primary' : 'btn-outline'}`} onClick={() => setTab(t)}>
              {label}
            </button>
          ))}
        </div>
        <div className="flex flex-1 items-center gap-2 rounded-xl border border-line bg-surface px-3">
          <Search size={16} className="text-muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" className="w-full bg-transparent py-2 text-sm outline-none" />
        </div>
      </div>

      {tab === 'cheats' && (
        <div className="space-y-8">
          {cheats
            .filter((c) => c.entries.length)
            .map(({ m, entries }) => (
              <section key={m.id}>
                <h2 className="mb-3 flex items-center gap-2 text-lg font-bold">
                  <span>{m.icon}</span> {m.title}
                </h2>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {entries.map((c, i) => (
                    <div key={i} className="card p-4">
                      <div className="mb-2 flex items-start justify-between gap-2">
                        <div className="text-sm font-bold">{c.title}</div>
                        <Link to={`/lesson/${c.lesson.id}`} className="shrink-0 text-[11px] font-semibold text-primary">
                          lesson →
                        </Link>
                      </div>
                      <CodeBlock sql={c.sql.trim()} />
                      {c.note && <div className="mt-2 text-xs text-muted">{c.note}</div>}
                    </div>
                  ))}
                </div>
              </section>
            ))}
          {!mods && <div className="text-sm text-muted">Loading…</div>}
        </div>
      )}

      {tab === 'glossary' && (
        <div className="grid gap-3 md:grid-cols-2">
          {terms.map((g) => (
            <div key={g.term} className="card p-4">
              <div className="font-bold text-primary">{g.term}</div>
              <Markdown md={g.definition} className="mt-1 text-sm" />
              {g.example && <CodeBlock sql={g.example} className="mt-2" />}
            </div>
          ))}
        </div>
      )}

      {tab === 'notes' && (
        <div className="grid gap-6 lg:grid-cols-2">
          <section>
            <h2 className="mb-3 flex items-center gap-2 font-bold">
              <NotebookPen size={16} /> My notes
            </h2>
            {noteEntries.length === 0 && <div className="text-sm text-muted">Use the ✏️ button at the top of any lesson to write notes.</div>}
            <div className="space-y-2">
              {noteEntries.map(([lid, text]) => {
                const l = lessonLocation(lid);
                return (
                  <Link key={lid} to={`/lesson/${lid}`} className="card block p-4 hover:border-primary/40">
                    <div className="text-sm font-bold">
                      {l?.module.icon} {l?.lesson.title}
                    </div>
                    <p className="mt-1 text-sm whitespace-pre-wrap text-fg-2">{text}</p>
                  </Link>
                );
              })}
            </div>
          </section>
          <section>
            <h2 className="mb-3 flex items-center gap-2 font-bold">
              <Bookmark size={16} /> Bookmarked lessons
            </h2>
            {bookmarks.length === 0 && <div className="text-sm text-muted">Bookmark lessons you want to come back to.</div>}
            <div className="space-y-2">
              {bookmarks.map((lid) => {
                const l = lessonLocation(lid);
                return l ? (
                  <Link key={lid} to={`/lesson/${lid}`} className="card flex items-center gap-3 p-3 hover:border-primary/40">
                    <span className="text-xl">{l.module.icon}</span>
                    <div>
                      <div className="text-sm font-bold">{l.lesson.title}</div>
                      <div className="text-xs text-muted">{l.module.title}</div>
                    </div>
                  </Link>
                ) : null;
              })}
            </div>
          </section>
        </div>
      )}
    </Page>
  );
}
