// Main-thread client for the database worker: request/response, timeouts and automatic restart.
import type { CheckOutput, CheckSpec, RunOutput, SchemaInfo } from './engine.ts';
import type { WorkerRequest, WorkerResponse } from './worker.ts';

export type DbStatus = 'idle' | 'starting' | 'ready' | 'busy' | 'error';

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> };
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export class TimeoutError extends Error {
  constructor(seconds: number) {
    super(
      `Your query ran for more than ${seconds} seconds, so we stopped it. ` +
        'This usually means a recursive query never stops, or a join creates a huge number of rows (e.g. a CROSS JOIN by mistake).',
    );
    this.name = 'TimeoutError';
  }
}

class DbClient {
  private worker: Worker | null = null;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private ready: Promise<void> | null = null;
  private listeners = new Set<(s: DbStatus) => void>();
  status: DbStatus = 'idle';
  inFlight = 0;

  onStatus(fn: (s: DbStatus) => void): () => void {
    this.listeners.add(fn);
    fn(this.status);
    return () => this.listeners.delete(fn);
  }

  private setStatus(s: DbStatus) {
    this.status = s;
    for (const l of this.listeners) l(s);
  }

  private spawn(): Promise<void> {
    this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
      const p = this.pending.get(ev.data.id);
      if (!p) return;
      clearTimeout(p.timer);
      this.pending.delete(ev.data.id);
      if (ev.data.ok) p.resolve(ev.data.data);
      else p.reject(new Error(ev.data.error));
    };
    this.worker.onerror = (ev) => {
      console.error('DB worker error', ev);
    };
    this.setStatus('starting');
    const datasetBase = new URL('datasets/', document.baseURI).href;
    return this.send({ type: 'init', datasetBase }, 120_000).then(
      () => this.setStatus('ready'),
      (e) => {
        this.setStatus('error');
        throw e;
      },
    ) as Promise<void>;
  }

  /** Start the database early (e.g. on app load) so the first Run is fast. */
  warmUp(): Promise<void> {
    if (!this.ready) {
      this.ready = this.spawn().catch((e) => {
        this.ready = null;
        throw e;
      });
    }
    return this.ready;
  }

  private send(msg: DistributiveOmit<WorkerRequest, 'id'>, timeoutMs: number): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new TimeoutError(Math.round(timeoutMs / 1000)));
        this.restart();
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.worker!.postMessage({ ...msg, id });
    });
  }

  private restart() {
    this.worker?.terminate();
    this.worker = null;
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error('The database was restarted.'));
    }
    this.pending.clear();
    this.ready = null;
    void this.warmUp().catch(() => undefined);
  }

  private async call<T>(msg: DistributiveOmit<WorkerRequest, 'id'>, timeoutMs: number): Promise<T> {
    await this.warmUp();
    this.inFlight++;
    this.setStatus('busy');
    try {
      return (await this.send(msg, timeoutMs)) as T;
    } finally {
      this.inFlight--;
      if (this.inFlight === 0 && this.status === 'busy') this.setStatus('ready');
    }
  }

  run(dataset: string, sql: string, opts: { setup?: string; persistent?: boolean } = {}): Promise<RunOutput> {
    return this.call<RunOutput>({ type: 'run', dataset, sql, setup: opts.setup, persistent: opts.persistent }, 20_000);
  }

  check(spec: CheckSpec): Promise<CheckOutput> {
    return this.call<CheckOutput>({ type: 'check', spec }, 30_000);
  }

  schema(dataset: string, persistent = false): Promise<SchemaInfo> {
    return this.call<SchemaInfo>({ type: 'schema', dataset, persistent }, 30_000);
  }

  reset(dataset: string): Promise<void> {
    return this.call<void>({ type: 'reset', dataset }, 30_000);
  }
}

export const db = new DbClient();
