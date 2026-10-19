import { describe, expect, it } from 'vitest';
import { compareResults, type ResultSet } from '../../src/db/compare.ts';

const INT = 23;
const TEXT = 25;
const NUM = 1700;
const rs = (cols: [string, number][], rows: unknown[][]): ResultSet => ({ columns: cols.map(([name, typeId]) => ({ name, typeId })), rows });

describe('compareResults', () => {
  const exp = rs([['name', TEXT], ['price', NUM]], [['Tea', '2.50'], ['Cake', '4.00']]);

  it('accepts identical results in any order when unordered', () => {
    expect(compareResults(exp, rs([['name', TEXT], ['price', NUM]], [['Cake', '4.00'], ['Tea', '2.50']])).ok).toBe(true);
  });
  it('requires order when ordered', () => {
    const r = compareResults(exp, rs([['name', TEXT], ['price', NUM]], [['Cake', '4.00'], ['Tea', '2.50']]), { ordered: true });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('order');
  });
  it('compares numbers to 2 decimals across types', () => {
    expect(compareResults(exp, rs([['name', TEXT], ['p', NUM]], [['Tea', 2.5], ['Cake', '4.0001']])).ok).toBe(true);
    expect(compareResults(exp, rs([['name', TEXT], ['p', NUM]], [['Tea', 2.6], ['Cake', 4]])).ok).toBe(false);
  });
  it('matches columns by name when the learner reorders them', () => {
    expect(compareResults(exp, rs([['price', NUM], ['name', TEXT]], [['2.50', 'Tea'], ['4.00', 'Cake']])).ok).toBe(true);
  });
  it('ignores column names unless required', () => {
    const renamed = rs([['n', TEXT], ['p', NUM]], [['Tea', '2.50'], ['Cake', '4.00']]);
    expect(compareResults(exp, renamed).ok).toBe(true);
    const r = compareResults(exp, renamed, { columnNames: true });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('column-names');
  });
  it('reports row and column count problems', () => {
    const r1 = compareResults(exp, rs([['name', TEXT]], [['Tea'], ['Cake']]));
    expect(!r1.ok && r1.code).toBe('column-count');
    const r2 = compareResults(exp, rs([['name', TEXT], ['price', NUM]], [['Tea', '2.50']]));
    expect(!r2.ok && r2.code).toBe('row-count');
  });
  it('treats NULL only equal to NULL and handles duplicates as a multiset', () => {
    const e = rs([['a', INT]], [[1], [1], [null]]);
    expect(compareResults(e, rs([['a', INT]], [[null], [1], [1]])).ok).toBe(true);
    expect(compareResults(e, rs([['a', INT]], [[1], [null], [null]])).ok).toBe(false);
  });
  it('treats midnight timestamps as dates', () => {
    const e = rs([['d', 1082]], [['2024-01-02']]);
    expect(compareResults(e, rs([['d', 1114]], [['2024-01-02 00:00:00']])).ok).toBe(true);
  });
  it('explains an empty SELECT list', () => {
    const r = compareResults(exp, rs([], [[], []]));
    expect(!r.ok && r.code).toBe('column-count');
  });
});
