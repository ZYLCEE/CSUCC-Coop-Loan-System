import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const exports={};new Function('exports',ts.transpileModule(readFileSync(new URL('./reporting.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText)(exports);
const {reportWindow}=exports;
test('daily, weekly and monthly reporting use exclusive end dates across year and leap boundaries',()=>{
  assert.deepEqual(reportWindow('2026-12-31','Daily'),{start:'2026-12-31',end:'2027-01-01'});
  assert.deepEqual(reportWindow('2026-01-01','Weekly'),{start:'2025-12-29',end:'2026-01-05'});
  assert.deepEqual(reportWindow('2024-02-29','Monthly'),{start:'2024-02-01',end:'2024-03-01'});
  assert.deepEqual(reportWindow('2026-10-29','Yearly'),{start:'2026-01-01',end:'2027-01-01'});
});
test('invalid dates and unknown report periods cannot silently generate another report',()=>{
  for(const date of ['','bad','2026-02-30','2026-13-01'])assert.throws(()=>reportWindow(date,'Daily'));
  assert.throws(()=>reportWindow('2026-10-29','Unknown'));
});
