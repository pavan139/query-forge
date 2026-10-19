import { useMediaQuery } from '../lib/hooks.ts';

const KEYS: { label: string; text: string }[] = [
  { label: 'SELECT', text: 'SELECT ' },
  { label: 'FROM', text: 'FROM ' },
  { label: 'WHERE', text: 'WHERE ' },
  { label: '*', text: '*' },
  { label: ',', text: ', ' },
  { label: "' '", text: "''" },
  { label: '=', text: ' = ' },
  { label: '( )', text: '()' },
  { label: ';', text: ';' },
  { label: 'AND', text: 'AND ' },
  { label: 'OR', text: 'OR ' },
  { label: 'JOIN', text: 'JOIN ' },
  { label: 'ON', text: 'ON ' },
  { label: 'GROUP BY', text: 'GROUP BY ' },
  { label: 'ORDER BY', text: 'ORDER BY ' },
  { label: 'AS', text: 'AS ' },
  { label: '<', text: ' < ' },
  { label: '>', text: ' > ' },
  { label: '_', text: '_' },
  { label: '%', text: '%' },
  { label: '↵', text: '\n' },
];

/** Quick-insert keys for SQL symbols that are awkward to type on a phone keyboard (touch screens only). */
export function KeyBar({ onInsert }: { onInsert: (text: string) => void }) {
  const touch = useMediaQuery('(pointer: coarse)');
  if (!touch) return null;
  return (
    <div className="scroll-x -mx-1 flex gap-1.5 px-1 pb-0.5" role="toolbar" aria-label="Insert SQL keywords">
      {KEYS.map((k) => (
        <button
          key={k.label}
          type="button"
          // Keep focus (and the on-screen keyboard) in the editor.
          onPointerDown={(e) => e.preventDefault()}
          onClick={() => onInsert(k.text)}
          className="shrink-0 rounded-lg bg-surface-2 px-2.5 py-1.5 font-mono text-[13px] font-medium text-fg-2 active:bg-surface-3"
        >
          {k.label}
        </button>
      ))}
    </div>
  );
}
