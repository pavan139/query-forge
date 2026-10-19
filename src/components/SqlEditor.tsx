import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { Compartment, EditorState, StateEffect, StateField, type Extension } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  placeholder as placeholderExt,
  type DecorationSet,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { bracketMatching, HighlightStyle, indentOnInput, syntaxHighlighting } from '@codemirror/language';
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete';
import { PostgreSQL, sql } from '@codemirror/lang-sql';
import { tags as t } from '@lezer/highlight';
import type { SchemaInfo } from '../db/engine.ts';

export interface SqlEditorHandle {
  setValue: (v: string) => void;
  getValue: () => string;
  focus: () => void;
  insert: (text: string) => void;
}

interface Props {
  value: string;
  onChange?: (v: string) => void;
  onRun?: () => void;
  onCheck?: () => void;
  schema?: SchemaInfo | null;
  readOnly?: boolean;
  minHeight?: number;
  maxHeight?: number;
  placeholder?: string;
  /** 1-based character offset of an error to underline. */
  errorAt?: number | null;
  lineNumbers?: boolean;
  autoFocus?: boolean;
  ariaLabel?: string;
}

const highlight = HighlightStyle.define([
  { tag: t.keyword, class: 'tok-kw' },
  { tag: [t.typeName, t.standard(t.name)], class: 'tok-kw' },
  { tag: [t.function(t.variableName), t.function(t.name)], class: 'tok-fn' },
  { tag: [t.string, t.special(t.string)], class: 'tok-str' },
  { tag: [t.number, t.bool, t.null], class: 'tok-num' },
  { tag: [t.lineComment, t.blockComment, t.comment], class: 'tok-com' },
  { tag: [t.operator, t.compareOperator, t.arithmeticOperator, t.logicOperator], class: 'tok-op' },
]);

const setError = StateEffect.define<{ from: number; to: number } | null>();
const errorField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(setError)) {
        deco = e.value && e.value.to > e.value.from ? Decoration.set([Decoration.mark({ class: 'cm-error-mark' }).range(e.value.from, e.value.to)]) : Decoration.none;
      }
    }
    if (tr.docChanged) deco = Decoration.none;
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

function schemaToCompletion(schema?: SchemaInfo | null): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const tb of schema?.tables ?? []) out[tb.name] = tb.columns.map((c) => c.name);
  return out;
}

export const SqlEditor = forwardRef<SqlEditorHandle, Props>(function SqlEditor(props, ref) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const cbs = useRef(props);
  cbs.current = props;

  const langExt = (schema?: SchemaInfo | null): Extension =>
    sql({ dialect: PostgreSQL, upperCaseKeywords: true, schema: schemaToCompletion(schema) });

  const language = useRef(new Compartment());

  useEffect(() => {
    if (!host.current) return;
    const runKeys = keymap.of([
      {
        key: 'Mod-Enter',
        run: () => {
          cbs.current.onRun?.();
          return true;
        },
      },
      {
        key: 'Shift-Mod-Enter',
        run: () => {
          (cbs.current.onCheck ?? cbs.current.onRun)?.();
          return true;
        },
      },
    ]);
    const extensions: Extension[] = [
      runKeys,
      history(),
      drawSelection(),
      indentOnInput(),
      bracketMatching(),
      closeBrackets(),
      autocompletion({ activateOnTyping: true, icons: true }),
      highlightActiveLine(),
      syntaxHighlighting(highlight),
      errorField,
      keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, ...completionKeymap, indentWithTab]),
      EditorView.lineWrapping,
      EditorView.updateListener.of((u) => {
        if (u.docChanged) cbs.current.onChange?.(u.state.doc.toString());
      }),
      EditorView.contentAttributes.of({ 'aria-label': props.ariaLabel ?? 'SQL editor', spellcheck: 'false', autocapitalize: 'off', autocorrect: 'off' }),
      EditorView.theme({
        '&': { minHeight: `${props.minHeight ?? 120}px`, maxHeight: props.maxHeight ? `${props.maxHeight}px` : 'none' },
        '.cm-scroller': { overflow: 'auto' },
        '.cm-content': { padding: '10px 0' },
      }),
      language.current.of(langExt(props.schema)),
    ];
    if (props.lineNumbers !== false) extensions.push(lineNumbers(), highlightActiveLineGutter());
    if (props.placeholder) extensions.push(placeholderExt(props.placeholder));
    if (props.readOnly) extensions.push(EditorState.readOnly.of(true), EditorView.editable.of(false));

    const v = new EditorView({ state: EditorState.create({ doc: props.value, extensions }), parent: host.current });
    view.current = v;
    if (props.autoFocus) v.focus();
    return () => {
      v.destroy();
      view.current = null;
    };
    // The editor is created once; schema changes are applied below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.readOnly]);

  // Keep the document in sync when the value is replaced from outside (e.g. Reset, Show solution).
  useEffect(() => {
    const v = view.current;
    if (v && props.value !== v.state.doc.toString()) {
      v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: props.value } });
    }
  }, [props.value]);

  // Schema-aware autocomplete.
  useEffect(() => {
    const v = view.current;
    if (!v || !props.schema) return;
    v.dispatch({ effects: language.current.reconfigure(langExt(props.schema)) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.schema]);

  useEffect(() => {
    const v = view.current;
    if (!v) return;
    if (props.errorAt == null) {
      v.dispatch({ effects: setError.of(null) });
      return;
    }
    const doc = v.state.doc.toString();
    const from = Math.max(0, Math.min(doc.length, props.errorAt - 1));
    let to = from;
    while (to < doc.length && /[^\s,;()]/.test(doc[to])) to++;
    if (to === from) to = Math.min(doc.length, from + 1);
    // An error at the very end of the text: mark the last character instead.
    const start = to === from && from > 0 ? from - 1 : from;
    v.dispatch({ effects: setError.of({ from: start, to }) });
  }, [props.errorAt]);

  useImperativeHandle(ref, () => ({
    setValue: (val: string) => {
      const v = view.current;
      if (v) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: val } });
    },
    getValue: () => view.current?.state.doc.toString() ?? '',
    focus: () => view.current?.focus(),
    insert: (text: string) => {
      const v = view.current;
      if (!v) return;
      const { from, to } = v.state.selection.main;
      v.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length } });
      v.focus();
    },
  }));

  return <div ref={host} className="overflow-hidden rounded-xl border border-line bg-code text-fg focus-within:border-primary/60 focus-within:ring-2 focus-within:ring-primary/20" />;
});
