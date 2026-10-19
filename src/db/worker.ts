/// <reference lib="webworker" />
// Runs PostgreSQL (PGlite) off the main thread so long queries never freeze the page.
import { PGlite } from '@electric-sql/pglite';
import { tablefunc } from '@electric-sql/pglite/contrib/tablefunc';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { Engine, type CheckSpec } from './engine.ts';
import { PARSERS } from './values.ts';

export type WorkerRequest =
  | { type: 'init'; id: number; datasetBase: string }
  | { type: 'run'; id: number; dataset: string; sql: string; setup?: string; persistent?: boolean }
  | { type: 'check'; id: number; spec: CheckSpec }
  | { type: 'schema'; id: number; dataset: string; persistent?: boolean }
  | { type: 'reset'; id: number; dataset: string };

export type WorkerResponse = { id: number; ok: true; data: unknown } | { id: number; ok: false; error: string };

let engine: Engine | null = null;
let datasetBase = '';
const datasetCache = new Map<string, string>();

async function loadDataset(id: string): Promise<string> {
  const cached = datasetCache.get(id);
  if (cached !== undefined) return cached;
  const res = await fetch(new URL(`${id}.sql`, datasetBase).href);
  if (!res.ok) throw new Error(`Could not load dataset "${id}" (${res.status})`);
  const text = await res.text();
  datasetCache.set(id, text);
  return text;
}

async function init(base: string) {
  datasetBase = base;
  const db = new PGlite({ extensions: { tablefunc, pg_trgm }, parsers: PARSERS });
  await db.waitReady;
  engine = new Engine(db, loadDataset);
}

async function handle(msg: WorkerRequest): Promise<unknown> {
  if (msg.type === 'init') {
    await init(msg.datasetBase);
    return true;
  }
  if (!engine) throw new Error('Database is not ready yet');
  switch (msg.type) {
    case 'run': {
      if (msg.persistent) {
        if (engine.current !== msg.dataset) await engine.reset(msg.dataset);
      } else await engine.use(msg.dataset);
      if (msg.setup) {
        engine.dirty = true;
        const s = await engine.run(msg.setup);
        if (!s.ok) return s;
      }
      return engine.run(msg.sql);
    }
    case 'check':
      return engine.check(msg.spec);
    case 'schema':
      if (msg.persistent) {
        if (engine.current !== msg.dataset) await engine.reset(msg.dataset);
      } else await engine.use(msg.dataset);
      return engine.schema();
    case 'reset':
      await engine.reset(msg.dataset);
      return true;
  }
}

// Requests are processed strictly one at a time.
let queue: Promise<void> = Promise.resolve();
self.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const msg = ev.data;
  queue = queue.then(async () => {
    try {
      const data = await handle(msg);
      (self as unknown as Worker).postMessage({ id: msg.id, ok: true, data } satisfies WorkerResponse);
    } catch (e) {
      (self as unknown as Worker).postMessage({ id: msg.id, ok: false, error: (e as Error).message ?? String(e) } satisfies WorkerResponse);
    }
  });
};
