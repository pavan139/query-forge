import { useEffect, useState } from 'react';
import { db, type DbStatus } from '../db/client.ts';

const LABEL: Record<DbStatus, string> = {
  idle: 'Database sleeping',
  starting: 'Starting PostgreSQL…',
  ready: 'PostgreSQL ready',
  busy: 'Running query…',
  error: 'Database error — reload the page',
};

export function useDbStatus(): DbStatus {
  const [s, setS] = useState<DbStatus>(db.status);
  useEffect(() => db.onStatus(setS), []);
  return s;
}

export function DbStatusDot() {
  const s = useDbStatus();
  const color = s === 'ready' ? 'bg-success' : s === 'error' ? 'bg-danger' : 'bg-accent animate-pulse';
  return (
    <div className="flex items-center gap-2 px-2 text-[11px] text-muted" title="A real PostgreSQL 18 database runs inside your browser — nothing to install.">
      <span className={`h-2 w-2 rounded-full ${color}`} />
      {LABEL[s]}
    </div>
  );
}
