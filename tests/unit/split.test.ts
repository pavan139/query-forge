import { describe, expect, it } from 'vitest';
import { isMutating, splitSql } from '../../src/db/split.ts';

describe('splitSql', () => {
  it('splits on semicolons and keeps offsets', () => {
    const s = 'SELECT 1;\n  SELECT 2;';
    const parts = splitSql(s);
    expect(parts.map((p) => p.sql)).toEqual(['SELECT 1', 'SELECT 2']);
    expect(s.slice(parts[1].offset, parts[1].offset + 8)).toBe('SELECT 2');
  });
  it('ignores semicolons in strings, identifiers, comments and dollar quotes', () => {
    const s = `SELECT 'a;b', "x;y" FROM t; -- c;d\n/* e;f */ SELECT 2; DO $$ BEGIN RAISE NOTICE 'x;'; END $$; SELECT E'it\\'s;'`;
    expect(splitSql(s).map((p) => p.keyword)).toEqual(['SELECT', 'SELECT', 'DO', 'SELECT']);
  });
  it('drops comment-only statements', () => {
    expect(splitSql('-- just a comment\n;')).toEqual([]);
  });
  it('handles named dollar quotes', () => {
    const s = 'CREATE FUNCTION f() RETURNS int LANGUAGE plpgsql AS $fn$ BEGIN RETURN 1; END $fn$; SELECT f();';
    expect(splitSql(s)).toHaveLength(2);
  });
});

describe('isMutating', () => {
  const m = (sql: string) => isMutating(splitSql(sql)[0]);
  it('detects read-only statements', () => {
    expect(m('SELECT * FROM t')).toBe(false);
    expect(m('WITH x AS (SELECT 1) SELECT * FROM x')).toBe(false);
    expect(m('EXPLAIN SELECT 1')).toBe(false);
  });
  it('detects writes', () => {
    expect(m('UPDATE t SET a = 1')).toBe(true);
    expect(m('WITH d AS (DELETE FROM t RETURNING *) SELECT * FROM d')).toBe(true);
    expect(m('SELECT * INTO new_t FROM t')).toBe(true);
    expect(m('CREATE TABLE x (a int)')).toBe(true);
    expect(m('BEGIN')).toBe(true);
  });
});
