import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const exports = {};
new Function('exports', ts.transpileModule(readFileSync(new URL('./tablePagination.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText)(exports);
const { paginationPages, sortRowsByDate } = exports;

test('large ledgers retain the current page and endpoints without an unbounded footer', () => {
  for (let total = 1; total <= 300; total++) {
    for (let current = 1; current <= total; current++) {
      const pages = paginationPages(current, total), numbers = pages.filter(value => value !== null);
      assert.ok(pages.length <= 7);
      assert.ok(numbers.includes(current));
      assert.equal(numbers[0], 1);
      assert.equal(numbers.at(-1), total);
      assert.deepEqual(numbers, [...new Set(numbers)].sort((a, b) => a - b));
      assert.ok(numbers.every(value => value >= 1 && value <= total));
    }
  }
  assert.deepEqual(paginationPages(1, 0), [1]);
  assert.deepEqual(paginationPages(100, 3), [1, 2, 3]);
});

test('chronological sorting preserves records, stable ties, missing dates, and the original source', () => {
  const rows = [{id:'missing',date:null},{id:'new',date:'2026-11-10T02:00:00Z'},
    {id:'old',date:'2026-01-01'},{id:'tie',date:'2026-01-01'},{id:'invalid',date:'unknown'}];
  const before = structuredClone(rows);
  assert.deepEqual(sortRowsByDate(rows, row => row.date, 'Newest').map(row => row.id), ['new','old','tie','missing','invalid']);
  assert.deepEqual(sortRowsByDate(rows, row => row.date, 'Oldest').map(row => row.id), ['old','tie','new','missing','invalid']);
  assert.deepEqual(rows, before);
});
