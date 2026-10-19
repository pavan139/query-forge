import { Check, Copy } from 'lucide-react';
import { useMemo, useState } from 'react';
import { highlightSql } from '../lib/highlight.ts';

export function CodeBlock({ sql, className, copy = true }: { sql: string; className?: string; copy?: boolean }) {
  const html = useMemo(() => highlightSql(sql), [sql]);
  const [copied, setCopied] = useState(false);
  return (
    <div className={`group relative ${className ?? ''}`}>
      <pre className="overflow-x-auto rounded-xl border border-line bg-code px-4 py-3 font-mono text-[13px] leading-relaxed">
        <code dangerouslySetInnerHTML={{ __html: html }} />
      </pre>
      {copy && (
        <button
          className="absolute top-2 right-2 rounded-md border border-line bg-surface p-1 text-muted opacity-0 transition group-hover:opacity-100 hover:text-fg"
          onClick={() => {
            void navigator.clipboard?.writeText(sql).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1200);
            });
          }}
          title="Copy"
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </button>
      )}
    </div>
  );
}
