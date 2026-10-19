// Markdown → safe HTML with GitHub-style callouts and SQL highlighting.
import { Marked } from 'marked';
import DOMPurify from 'dompurify';
import { highlightSql } from './highlight.ts';

const CALLOUTS: Record<string, { icon: string; label: string }> = {
  TIP: { icon: '💡', label: 'Tip' },
  NOTE: { icon: '📝', label: 'Note' },
  WARNING: { icon: '⚠️', label: 'Careful' },
  MISTAKE: { icon: '🙈', label: 'Common mistake' },
  ANALOGY: { icon: '🧠', label: 'Think of it like this' },
  'REAL-WORLD': { icon: '💼', label: 'In the real world' },
  IMPORTANT: { icon: '❗', label: 'Important' },
  CAUTION: { icon: '⚠️', label: 'Caution' },
};

const marked = new Marked({
  gfm: true,
  breaks: false,
  renderer: {
    code({ text, lang }) {
      const l = (lang ?? '').toLowerCase();
      const body = l === '' || l === 'sql' || l === 'pgsql' || l === 'postgresql' ? highlightSql(text) : escapeHtml(text);
      return `<pre class="code-block" data-lang="${escapeHtml(l || 'sql')}"><code>${body}</code></pre>`;
    },
  },
});

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function applyCallouts(html: string): string {
  const parts = html.split(/(<blockquote>|<\/blockquote>)/);
  const stack: boolean[] = [];
  let out = '';
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p === '<blockquote>') {
      const next = parts[i + 1] ?? '';
      const m = /^\s*<p>\[!([A-Z-]+)\]\s*(?:<br>)?\s*/.exec(next);
      if (m && CALLOUTS[m[1]]) {
        const c = CALLOUTS[m[1]];
        out += `<div class="callout callout-${m[1].toLowerCase()}"><div class="callout-title"><span>${c.icon}</span>${c.label}</div>`;
        parts[i + 1] = '<p>' + next.slice(m[0].length);
        stack.push(true);
      } else {
        out += p;
        stack.push(false);
      }
    } else if (p === '</blockquote>') {
      out += stack.pop() ? '</div>' : p;
    } else out += p;
  }
  return out.replace(/<p>\s*<\/p>/g, '');
}

const cache = new Map<string, string>();

export function renderMarkdown(md: string): string {
  const hit = cache.get(md);
  if (hit) return hit;
  const raw = marked.parse(md, { async: false }) as string;
  const html = DOMPurify.sanitize(applyCallouts(raw));
  if (cache.size > 2000) cache.clear();
  cache.set(md, html);
  return html;
}

/** Inline markdown (no wrapping <p>). */
export function renderInline(md: string): string {
  return DOMPurify.sanitize(marked.parseInline(md, { async: false }) as string);
}
