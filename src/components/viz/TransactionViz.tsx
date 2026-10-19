import { ChevronLeft, ChevronRight, RotateCcw } from 'lucide-react';
import { useState } from 'react';

type Who = 'A' | 'B';
interface TxStep {
  who: Who;
  sql: string;
  note: string;
  /** Committed balances after this step. */
  db: Record<string, number>;
  /** What each session sees (if different from committed). */
  seenA?: Record<string, number>;
  seenB?: Record<string, number>;
  status?: { A?: string; B?: string };
  tone?: 'good' | 'bad' | 'wait';
}
interface Scenario {
  title: string;
  intro: string;
  steps: TxStep[];
  lesson: string;
}

const base = { Alice: 100, Bob: 50 };

const SCENARIOS: Record<string, Scenario> = {
  'commit-rollback': {
    title: 'COMMIT makes it permanent, ROLLBACK undoes it',
    intro: 'Session A moves $30 from Alice to Bob. Session B is another user looking at the same table.',
    lesson: 'Until COMMIT, other sessions keep seeing the old values. ROLLBACK throws away every change since BEGIN, as if nothing happened.',
    steps: [
      { who: 'A', sql: 'BEGIN;', note: 'A starts a transaction: a group of statements that succeed or fail together.', db: base, status: { A: 'in transaction' } },
      { who: 'A', sql: "UPDATE accounts SET balance = balance - 30 WHERE name = 'Alice';", note: 'A takes $30 from Alice. Only A can see this change so far.', db: base, seenA: { Alice: 70, Bob: 50 }, status: { A: 'in transaction' } },
      { who: 'B', sql: 'SELECT * FROM accounts;', note: 'B still sees the original balances — the change is not committed.', db: base, seenA: { Alice: 70, Bob: 50 }, status: { A: 'in transaction' } },
      { who: 'A', sql: "UPDATE accounts SET balance = balance + 30 WHERE name = 'Bob';", note: 'A gives the $30 to Bob.', db: base, seenA: { Alice: 70, Bob: 80 }, status: { A: 'in transaction' } },
      { who: 'A', sql: 'COMMIT;', note: 'COMMIT! Both changes become permanent at the same instant — everyone now sees them.', db: { Alice: 70, Bob: 80 }, tone: 'good' },
      { who: 'A', sql: 'BEGIN;\nUPDATE accounts SET balance = 0;', note: 'Oops — A forgot the WHERE clause and zeroed every account (inside a new transaction)...', db: { Alice: 70, Bob: 80 }, seenA: { Alice: 0, Bob: 0 }, status: { A: 'in transaction' }, tone: 'bad' },
      { who: 'A', sql: 'ROLLBACK;', note: 'ROLLBACK saves the day: the mistaken update is undone completely.', db: { Alice: 70, Bob: 80 }, tone: 'good' },
    ],
  },
  'dirty-read': {
    title: 'Dirty read (PostgreSQL never allows it)',
    intro: 'A dirty read is seeing another session’s changes before they are committed.',
    lesson: 'PostgreSQL never shows uncommitted data — even if you ask for READ UNCOMMITTED, it behaves like READ COMMITTED. Some other databases do allow dirty reads.',
    steps: [
      { who: 'A', sql: "BEGIN;\nUPDATE accounts SET balance = 0 WHERE name = 'Alice';", note: 'A sets Alice to 0 but has not committed.', db: base, seenA: { Alice: 0, Bob: 50 }, status: { A: 'in transaction' } },
      { who: 'B', sql: 'SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;\nSELECT balance FROM accounts WHERE name = \'Alice\';', note: 'B asks to read uncommitted data... but PostgreSQL still shows 100. In a database that allows dirty reads, B would see 0.', db: base, seenA: { Alice: 0, Bob: 50 }, status: { A: 'in transaction' }, tone: 'good' },
      { who: 'A', sql: 'ROLLBACK;', note: 'A rolls back. If B had read 0, it would have acted on a value that never existed!', db: base },
    ],
  },
  'non-repeatable-read': {
    title: 'Non-repeatable read',
    intro: 'B reads the same row twice inside one transaction. Between the reads, A changes it and commits.',
    lesson: 'Under READ COMMITTED (PostgreSQL’s default) each statement sees the latest committed data, so two reads in one transaction can differ. Use REPEATABLE READ to get a stable snapshot for the whole transaction.',
    steps: [
      { who: 'B', sql: "BEGIN; -- READ COMMITTED\nSELECT balance FROM accounts WHERE name = 'Alice';", note: 'B reads Alice: 100.', db: base, status: { B: 'in transaction' } },
      { who: 'A', sql: "UPDATE accounts SET balance = 70 WHERE name = 'Alice';\n-- (autocommit)", note: 'A changes Alice to 70 and it is committed immediately.', db: { Alice: 70, Bob: 50 }, status: { B: 'in transaction' } },
      { who: 'B', sql: "SELECT balance FROM accounts WHERE name = 'Alice';", note: 'Same query, same transaction — now it says 70. The read was not repeatable!', db: { Alice: 70, Bob: 50 }, status: { B: 'in transaction' }, tone: 'bad' },
      { who: 'B', sql: 'COMMIT;\n-- With BEGIN ISOLATION LEVEL REPEATABLE READ,\n-- the second SELECT would still return 100.', note: 'REPEATABLE READ freezes B’s view at its first query.', db: { Alice: 70, Bob: 50 }, tone: 'good' },
    ],
  },
  'phantom-read': {
    title: 'Phantom read',
    intro: 'B counts rich accounts twice. In between, A inserts a new rich account.',
    lesson: 'A “phantom” is a new row that appears in a repeated query. REPEATABLE READ in PostgreSQL also prevents phantoms; SERIALIZABLE additionally prevents subtler anomalies.',
    steps: [
      { who: 'B', sql: 'BEGIN; -- READ COMMITTED\nSELECT count(*) FROM accounts WHERE balance > 40;', note: 'B counts accounts over $40: 2.', db: base, status: { B: 'in transaction' } },
      { who: 'A', sql: "INSERT INTO accounts VALUES ('Carol', 90);", note: 'A inserts Carol with $90 and commits.', db: { ...base, Carol: 90 }, status: { B: 'in transaction' } },
      { who: 'B', sql: 'SELECT count(*) FROM accounts WHERE balance > 40;', note: 'Now B gets 3 — a phantom row appeared mid-transaction.', db: { ...base, Carol: 90 }, status: { B: 'in transaction' }, tone: 'bad' },
      { who: 'B', sql: 'COMMIT;', note: 'Under REPEATABLE READ, B would have seen 2 both times.', db: { ...base, Carol: 90 } },
    ],
  },
  'lost-update': {
    title: 'Lost update',
    intro: 'Two app servers read Alice’s balance, compute a new value in code, and write it back.',
    lesson: 'Never read-modify-write with a value computed outside the database. Use UPDATE ... SET balance = balance - 20 (atomic), or lock the row first with SELECT ... FOR UPDATE.',
    steps: [
      { who: 'A', sql: "SELECT balance FROM accounts WHERE name = 'Alice';  -- 100", note: 'A reads 100 (wants to deposit $10).', db: base },
      { who: 'B', sql: "SELECT balance FROM accounts WHERE name = 'Alice';  -- 100", note: 'B also reads 100 (wants to withdraw $20).', db: base },
      { who: 'A', sql: "UPDATE accounts SET balance = 110 WHERE name = 'Alice';", note: 'A writes 100 + 10 = 110.', db: { Alice: 110, Bob: 50 } },
      { who: 'B', sql: "UPDATE accounts SET balance = 80 WHERE name = 'Alice';", note: 'B writes 100 − 20 = 80, overwriting A’s deposit. The $10 is LOST — it should be 90.', db: { Alice: 80, Bob: 50 }, tone: 'bad' },
      { who: 'B', sql: "-- The fix: let the database do the maths atomically\nUPDATE accounts SET balance = balance - 20 WHERE name = 'Alice';", note: 'With balance = balance ± x, each update applies to the latest value, so both changes survive.', db: { Alice: 80, Bob: 50 }, tone: 'good' },
    ],
  },
  deadlock: {
    title: 'Deadlock',
    intro: 'A and B each lock one row, then each wants the row the other one holds.',
    lesson: 'PostgreSQL detects deadlocks and cancels one transaction with an error. Prevent them by always locking rows in the same order (e.g. by id).',
    steps: [
      { who: 'A', sql: "BEGIN;\nUPDATE accounts SET balance = balance - 10 WHERE name = 'Alice';", note: 'A locks Alice’s row.', db: base, status: { A: '🔒 Alice' } },
      { who: 'B', sql: "BEGIN;\nUPDATE accounts SET balance = balance - 10 WHERE name = 'Bob';", note: 'B locks Bob’s row.', db: base, status: { A: '🔒 Alice', B: '🔒 Bob' } },
      { who: 'A', sql: "UPDATE accounts SET balance = balance + 10 WHERE name = 'Bob';", note: 'A needs Bob’s row → waits for B…', db: base, status: { A: '⏳ waiting for Bob', B: '🔒 Bob' }, tone: 'wait' },
      { who: 'B', sql: "UPDATE accounts SET balance = balance + 10 WHERE name = 'Alice';", note: 'B needs Alice’s row → waits for A. Each waits for the other forever: DEADLOCK.', db: base, status: { A: '⏳ waiting for Bob', B: '⏳ waiting for Alice' }, tone: 'bad' },
      { who: 'B', sql: 'ERROR: deadlock detected', note: 'PostgreSQL notices after ~1 second and kills B’s transaction. A continues and can COMMIT.', db: base, status: { A: '🔒 Alice, Bob' }, tone: 'bad' },
      { who: 'A', sql: 'COMMIT;', note: 'A finishes. B must retry. Locking rows in a consistent order avoids this.', db: { Alice: 90, Bob: 60 }, tone: 'good' },
    ],
  },
  'select-for-update': {
    title: 'SELECT … FOR UPDATE',
    intro: 'A wants to read Alice’s balance and update it safely, without anyone changing it in between.',
    lesson: 'FOR UPDATE locks the selected rows until COMMIT/ROLLBACK. Others who want to modify or lock them wait. FOR UPDATE SKIP LOCKED lets workers grab different rows (job queues).',
    steps: [
      { who: 'A', sql: "BEGIN;\nSELECT balance FROM accounts WHERE name = 'Alice' FOR UPDATE;", note: 'A reads 100 and locks Alice’s row.', db: base, status: { A: '🔒 Alice' } },
      { who: 'B', sql: "BEGIN;\nSELECT balance FROM accounts WHERE name = 'Alice' FOR UPDATE;", note: 'B wants the same lock → it waits.', db: base, status: { A: '🔒 Alice', B: '⏳ waiting' }, tone: 'wait' },
      { who: 'A', sql: "UPDATE accounts SET balance = 110 WHERE name = 'Alice';\nCOMMIT;", note: 'A deposits $10 and commits, releasing the lock.', db: { Alice: 110, Bob: 50 }, status: { B: '🔒 Alice' } },
      { who: 'B', sql: '-- B’s SELECT now returns 110', note: 'B continues with the fresh value 110 — no lost update.', db: { Alice: 110, Bob: 50 }, status: { B: '🔒 Alice' }, tone: 'good' },
    ],
  },
};

export function TransactionViz({ config }: { config?: Record<string, unknown> }) {
  const key = String(config?.scenario ?? 'commit-rollback');
  const sc = SCENARIOS[key] ?? SCENARIOS['commit-rollback'];
  const [i, setI] = useState(0);
  const step = sc.steps[i];
  const names = Object.keys(step.db);
  const view = (w: Who) => (w === 'A' ? (step.seenA ?? step.db) : (step.seenB ?? step.db));
  const toneCls = step.tone === 'good' ? 'border-success/40 bg-success-soft' : step.tone === 'bad' ? 'border-danger/30 bg-danger-soft' : step.tone === 'wait' ? 'border-accent/40 bg-warn-soft' : 'border-line bg-surface-2';

  const column = (w: Who) => (
    <div className="min-w-0 flex-1 rounded-xl border border-line bg-surface p-2">
      <div className="mb-1.5 flex items-center justify-between">
        <span className={`chip ${w === 'A' ? '!bg-primary-soft !text-primary' : '!bg-pink/15 !text-pink'}`}>Session {w}</span>
        {step.status?.[w] && <span className="text-[11px] font-semibold text-muted">{step.status[w]}</span>}
      </div>
      <div className="space-y-1">
        {sc.steps.slice(0, i + 1).map((s, k) =>
          s.who === w ? (
            <pre key={k} className={`rounded-lg px-2 py-1 font-mono text-[11.5px] whitespace-pre-wrap transition ${k === i ? 'bg-primary-soft ring-2 ring-primary/40' : 'bg-code opacity-70'}`}>
              {s.sql}
            </pre>
          ) : (
            <div key={k} className="h-1" />
          ),
        )}
      </div>
      <div className="mt-2 border-t border-line pt-1.5 text-[11px] text-muted">
        {w} sees:{' '}
        {names.map((n) => (
          <span key={n} className="mr-2 font-mono">
            {n} <b className={view(w)[n] !== step.db[n] ? 'text-accent' : 'text-fg'}>{view(w)[n] ?? '—'}</b>
          </span>
        ))}
      </div>
    </div>
  );

  return (
    <div className="space-y-3">
      <div>
        <div className="font-bold">{sc.title}</div>
        <p className="text-sm text-fg-2">{sc.intro}</p>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        {column('A')}
        {column('B')}
      </div>
      <div className={`rounded-xl border p-3 text-sm ${toneCls}`}>
        <div className="mb-0.5 text-xs font-bold text-muted">
          Step {i + 1} of {sc.steps.length} · Committed data: {names.map((n) => `${n} = ${step.db[n]}`).join(', ')}
        </div>
        {step.note}
      </div>
      <div className="flex items-center gap-2">
        <button className="btn btn-outline btn-sm" disabled={i === 0} onClick={() => setI(i - 1)}>
          <ChevronLeft size={14} /> Back
        </button>
        <button className="btn btn-primary btn-sm" disabled={i === sc.steps.length - 1} onClick={() => setI(i + 1)}>
          Next step <ChevronRight size={14} />
        </button>
        <button className="btn btn-ghost btn-sm" onClick={() => setI(0)}>
          <RotateCcw size={14} /> Restart
        </button>
      </div>
      {i === sc.steps.length - 1 && (
        <div className="animate-fade-up callout callout-tip">
          <div className="callout-title">💡 Takeaway</div>
          <p className="text-sm">{sc.lesson}</p>
        </div>
      )}
    </div>
  );
}
