import { useMemo } from 'react';
import { renderInline, renderMarkdown } from '../lib/md.ts';

export function Markdown({ md, inline, className }: { md: string; inline?: boolean; className?: string }) {
  const html = useMemo(() => (inline ? renderInline(md) : renderMarkdown(md)), [md, inline]);
  if (inline) return <span className={className} dangerouslySetInnerHTML={{ __html: html }} />;
  return <div className={`prose-sq ${className ?? ''}`} dangerouslySetInnerHTML={{ __html: html }} />;
}
