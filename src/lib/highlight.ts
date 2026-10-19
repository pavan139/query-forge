// Lightweight SQL syntax highlighter for static code (markdown blocks, solutions, cheat sheet).

const KEYWORDS = new Set(
  `select from where and or not in is null as on join inner left right full outer cross natural using group by order
  having limit offset fetch first next rows row only with ties distinct all any some exists between like ilike similar
  case when then else end union intersect except insert into values update set delete returning create table view
  materialized index unique primary key foreign references constraint check default drop alter add column rename to
  truncate begin commit rollback savepoint release transaction isolation level read committed repeatable serializable
  uncommitted grant revoke role user public schema if replace function procedure returns return language plpgsql sql
  declare loop for while exit continue raise notice exception perform execute call do trigger before after instead of
  each statement new old over partition window range groups preceding following unbounded current exclude recursive lateral
  asc desc nulls cascade restrict no action deferrable initially deferred immediate temp temporary unlogged
  analyze explain vacuum generated always identity stored true false conflict nothing merge matched source target
  interval date time timestamp timestamptz zone at filter within ordinality cycle search depth breadth
  integer int bigint smallint numeric decimal real double precision serial bigserial text varchar char boolean bool
  jsonb json uuid bytea array cast elsif security policy enable disable level share lock nowait skip locked
  only comment tablespace sequence owned extension rollup cube grouping sets volatile stable immutable strict
  setof inout out variadic language atomic concurrently refresh data include collate escape tablesample`.split(/\s+/),
);

// Keywords that are also commonly used as functions: coloured as functions when followed by "(".
const FUNC_LIKE = new Set(['left', 'right', 'replace', 'date', 'interval', 'filter', 'array', 'exists', 'any', 'all', 'values', 'cast', 'grouping', 'rollup', 'cube']);

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const TOKEN =
  /(--[^\n]*|\/\*[\s\S]*?\*\/)|('(?:[^']|'')*'?)|(\$[A-Za-z_]*\$)|("(?:[^"]|"")*"?)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_][A-Za-z0-9_]*)(\s*\()?|(::|<>|!=|<=|>=|\|\||->>|->|#>>|#>|@>|<@|[=<>+\-*/%])/g;

export function highlightSql(code: string): string {
  let out = '';
  let last = 0;
  for (const m of code.matchAll(TOKEN)) {
    const idx = m.index ?? 0;
    out += esc(code.slice(last, idx));
    last = idx + m[0].length;
    if (m[1]) out += `<span class="tok-com">${esc(m[1])}</span>`;
    else if (m[2]) out += `<span class="tok-str">${esc(m[2])}</span>`;
    else if (m[3]) out += `<span class="tok-kw">${esc(m[3])}</span>`;
    else if (m[4]) out += esc(m[4]);
    else if (m[5]) out += `<span class="tok-num">${m[5]}</span>`;
    else if (m[6]) {
      const word = m[6];
      const paren = m[7] ?? '';
      const isKw = KEYWORDS.has(word.toLowerCase());
      if (isKw && !(paren && FUNC_LIKE.has(word.toLowerCase()))) out += `<span class="tok-kw">${esc(word)}</span>${esc(paren)}`;
      else if (paren) out += `<span class="tok-fn">${esc(word)}</span>${esc(paren)}`;
      else out += esc(word);
    } else if (m[8]) out += `<span class="tok-op">${esc(m[8])}</span>`;
  }
  out += esc(code.slice(last));
  return out;
}
