// Turns PostgreSQL errors into friendly, beginner-level explanations with concrete fixes.
import type { SqlError } from './engine.ts';

export interface FriendlyError {
  title: string;
  explanation: string;
  tips: string[];
  /** Suggested replacement word (e.g. a column name she probably meant). */
  didYouMean?: string;
}

export interface NameHints {
  tables: string[];
  columns: string[];
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[m][n];
}

export function closest(word: string, candidates: string[]): string | undefined {
  const w = word.toLowerCase();
  let best: string | undefined;
  let bestScore = Infinity;
  for (const c of candidates) {
    const s = levenshtein(w, c.toLowerCase());
    if (s < bestScore) {
      bestScore = s;
      best = c;
    }
  }
  const limit = Math.max(2, Math.floor(w.length / 3));
  return bestScore <= limit && best?.toLowerCase() !== w ? best : undefined;
}

const quoted = (msg: string) => /"([^"]+)"/.exec(msg)?.[1];

/** Text near the error position, for messages like "syntax error at or near ...". */
function nearToken(msg: string): string | undefined {
  return /at or near "([^"]*)"/.exec(msg)?.[1];
}

export function explainError(err: SqlError, sql: string, names: NameHints = { tables: [], columns: [] }): FriendlyError {
  const msg = err.message ?? '';
  const code = err.code ?? '';
  const stmt = err.statementSql ?? sql;

  if (err.code === 'TIMEOUT' || /ran for more than/.test(msg)) {
    return {
      title: 'Query stopped — it took too long',
      explanation: msg,
      tips: ['Recursive CTEs need a condition that eventually stops them (e.g. WHERE n < 10).', 'Check every JOIN has an ON condition.'],
    };
  }

  switch (code) {
    case '42703': {
      // undefined_column
      const col = quoted(msg) ?? '';
      const dq = new RegExp(`"${col.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`).test(stmt);
      if (dq && !names.columns.some((c) => c.toLowerCase() === col.toLowerCase())) {
        return {
          title: 'Use single quotes for text',
          explanation: `PostgreSQL thinks "${col}" is a column name, because double quotes "like this" are for names of columns and tables. Text values need single quotes.`,
          tips: [`Write '${col}' (single quotes) instead of "${col}".`, "Remember: 'single quotes' = text value, \"double quotes\" = column/table name."],
        };
      }
      const pgHint = /Perhaps you meant to reference the column "([^"]+)"/.exec(err.hint ?? '')?.[1];
      const dym = pgHint ?? closest(col.split('.').pop() ?? col, names.columns);
      const isAlias = /column "?\w+"? does not exist/.test(msg) && /\bAS\b/i.test(stmt) && /\b(WHERE|GROUP BY|HAVING)\b/i.test(stmt);
      return {
        title: `There is no column called "${col}"`,
        explanation: `The database can't find a column named "${col}" in the tables you're querying.`,
        tips: [
          ...(dym ? [`Did you mean "${dym}"?`] : []),
          'Check the spelling in the Schema panel — column names must match exactly.',
          'Make sure the column belongs to a table listed in FROM (or a joined table).',
          ...(isAlias ? ['An alias made with AS in SELECT cannot be used in WHERE — WHERE runs before SELECT. Repeat the expression instead.'] : []),
        ],
        didYouMean: dym,
      };
    }
    case '42P01': {
      // undefined_table
      const t = quoted(msg) ?? '';
      const dym = closest(t, names.tables);
      return {
        title: `There is no table called "${t}"`,
        explanation: `The database can't find a table (or view) named "${t}".`,
        tips: [
          ...(dym ? [`Did you mean "${dym}"?`] : []),
          'Table names are listed in the Schema panel on the right.',
          'If you created the table yourself, make sure the CREATE TABLE ran first (it must be in the same editor — every run starts fresh).',
          ...(/missing FROM-clause entry/.test(msg) ? ['You used a table alias that is not defined in FROM/JOIN.'] : []),
        ],
        didYouMean: dym,
      };
    }
    case '42601': {
      // syntax_error
      const tok = nearToken(msg);
      const tips: string[] = [];
      const upper = stmt.toUpperCase();
      if (tok && /^(FROM|WHERE|GROUP|ORDER|HAVING|LIMIT|JOIN|ON)$/i.test(tok)) {
        if (/,\s*(FROM|WHERE|GROUP|ORDER|HAVING|LIMIT)\b/i.test(stmt)) tips.push(`There is a comma right before ${tok.toUpperCase()}. Remove the last comma in your column list.`);
        else tips.push(`Something just before ${tok.toUpperCase()} is incomplete — e.g. a missing column name, a missing value after an operator, or an extra comma.`);
      }
      if (tok === '') tips.push('The query ended unexpectedly. Is something missing at the end (a closing parenthesis, a value)?');
      if (/==/.test(stmt)) tips.push('SQL uses a single = for comparison, not ==.');
      if (/"[^"]*\s[^"]*"/.test(stmt) && !/\bAS\s+"/i.test(stmt)) tips.push("Text values go in 'single quotes'.");
      if (tok && /^[A-Za-z_]+$/.test(tok) && !/^(FROM|WHERE|GROUP|ORDER|HAVING|LIMIT|JOIN|ON|SELECT|AND|OR|BY|AS)$/i.test(tok))
        tips.push(`Check the word before "${tok}" — maybe a missing comma between columns, or a misspelled keyword.`);
      if ((stmt.match(/\(/g) ?? []).length !== (stmt.match(/\)/g) ?? []).length) tips.push('The number of ( and ) parentheses does not match.');
      if (((stmt.match(/'/g) ?? []).length & 1) === 1) tips.push("There is an odd number of single quotes ' — a text value isn't closed.");
      if (/\bSELECT\b[\s\S]*\bSELECT\b/i.test(upper) && !/;/.test(stmt) && !/\(\s*SELECT/i.test(stmt)) tips.push('Did you forget a ; between two queries?');
      if (tips.length === 0) tips.push('Look closely at the highlighted spot: typos in keywords (SELCT, FORM), missing commas, or unfinished expressions are the usual culprits.');
      return {
        title: tok !== undefined ? `Syntax error near "${tok}"` : 'Syntax error',
        explanation: "PostgreSQL couldn't understand the query's grammar at the highlighted spot. It's like a sentence with a word in the wrong place.",
        tips,
      };
    }
    case '42803':
      return {
        title: 'Column must be grouped or aggregated',
        explanation:
          'When a query has GROUP BY (or an aggregate like COUNT/SUM), every column in SELECT must either be listed in GROUP BY or be inside an aggregate function. Otherwise the database does not know which of the many values in the group to show.',
        tips: [
          `Add ${quoted(msg) ?? 'the column'} to the GROUP BY clause, or wrap it in an aggregate such as MAX(...) or COUNT(...).`,
          'Aggregates (SUM, COUNT, AVG...) cannot be used in WHERE — use HAVING to filter groups.',
        ],
      };
    case '42883': {
      const op = /operator does not exist: (.+)$/m.exec(msg)?.[1];
      return {
        title: op ? `Can't compare these types: ${op}` : 'Function or operator not found',
        explanation: op
          ? `You're combining two values of different types (${op}). PostgreSQL won't guess how to convert them.`
          : 'This function name (or its combination of argument types) does not exist in PostgreSQL.',
        tips: op
          ? ['Compare numbers with numbers and text with text. Remove quotes around numbers, or cast with ::integer / ::text.', "Dates need quotes: order_date = '2024-01-15'."]
          : ['Check the spelling of the function name.', 'Some functions need a cast first, e.g. ROUND(value::numeric, 2).', 'Different databases have different function names — this app uses PostgreSQL.'],
      };
    }
    case '42702':
      return {
        title: `"${quoted(msg)}" is ambiguous`,
        explanation: `More than one table in your query has a column named "${quoted(msg)}", so PostgreSQL doesn't know which one you mean.`,
        tips: ['Put the table name or alias in front: customers.customer_id or c.customer_id.'],
      };
    case '42804':
    case '22P02':
    case '22007':
    case '22008':
      return {
        title: 'Value has the wrong type',
        explanation: `PostgreSQL couldn't treat a value as the type it needs: ${msg}.`,
        tips: [
          "Numbers shouldn't be in quotes when compared to number columns; text must be.",
          "Dates should look like '2024-12-31'.",
          'Use CAST(value AS type) or value::type to convert explicitly.',
        ],
      };
    case '21000':
      return {
        title: 'Subquery returned more than one row',
        explanation: 'You used a subquery where exactly one value is expected (e.g. after =), but it returned several rows.',
        tips: ['Use IN (...) instead of =, or make the subquery return a single value (aggregate it, add a WHERE, or LIMIT 1).'],
      };
    case '22012':
      return {
        title: 'Division by zero',
        explanation: 'Some row tried to divide by 0, which is undefined.',
        tips: ['Wrap the divisor with NULLIF(divisor, 0) so the result becomes NULL instead of an error.'],
      };
    case '23505':
      return {
        title: 'Duplicate value',
        explanation: `This would create two rows with the same value in a column that must be unique. ${err.detail ?? ''}`,
        tips: ['Use a different value, or use INSERT ... ON CONFLICT to handle duplicates.'],
      };
    case '23503':
      return {
        title: 'Foreign key violation',
        explanation: `This change would break a link between tables. ${err.detail ?? ''}`,
        tips: ['A foreign key value must exist in the referenced table.', 'Delete/insert child and parent rows in the right order, or use ON DELETE CASCADE.'],
      };
    case '23502':
      return {
        title: 'Missing required value',
        explanation: `The column "${err.message.match(/column "([^"]+)"/)?.[1] ?? ''}" is NOT NULL, so it needs a value.`,
        tips: ['Include that column in your INSERT with a value, or give the column a DEFAULT.'],
      };
    case '23514':
      return {
        title: 'Check constraint failed',
        explanation: `A rule on the table rejected this value. ${err.detail ?? ''}`,
        tips: ['Look at the table definition to see what values the CHECK constraint allows.'],
      };
    case '42P07':
      return {
        title: 'That already exists',
        explanation: msg,
        tips: ['Use a different name, add IF NOT EXISTS, or DROP the old one first.'],
      };
    case '42P10':
    case '42P18':
    case '42P20':
      return { title: 'Invalid use of a clause', explanation: msg, tips: [err.hint ?? 'Re-read the lesson section about this clause.'] };
    case '25P02':
      return {
        title: 'Transaction is in a failed state',
        explanation: 'An earlier statement in this transaction failed, so PostgreSQL ignores everything until the transaction ends.',
        tips: ['Run ROLLBACK (or ROLLBACK TO SAVEPOINT) to recover, then try again.'],
      };
    case '42501':
      return { title: 'Permission denied', explanation: msg, tips: ['The current role lacks this privilege. Use GRANT, or RESET ROLE to go back to the admin user.'] };
    case '0A000':
      return { title: 'Not supported', explanation: msg, tips: ['This feature is not supported here; try another approach.'] };
    case 'P0001':
      return { title: 'Raised by your code', explanation: msg, tips: ['This error came from a RAISE EXCEPTION statement.'] };
  }
  if (/cannot be (used|matched)|must appear/.test(msg) || /aggregate functions are not allowed in WHERE/.test(msg)) {
    return {
      title: 'Aggregate in the wrong place',
      explanation: msg,
      tips: ['Aggregates like COUNT/SUM cannot go in WHERE. Use HAVING after GROUP BY to filter on them.'],
    };
  }
  return {
    title: 'PostgreSQL reported an error',
    explanation: msg,
    tips: [err.hint ?? 'Read the message carefully — it usually names the exact problem. Then compare your query with the lesson examples.'],
  };
}
