import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { countActiveMembers } from "./dashboard-model.ts";

// Exercise the actual query/validation code against a stub transport. No live
// credentials or database connection are used by these tests.
const source = readFileSync(new URL("./dashboard-data.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;

function loadService(rangeResponse, accountResponse = { accounts: [] }) {
  const requests = [];
  const builder = {
    select() { return this; },
    order() { return this; },
    async range(start, end) {
      requests.push([start, end]);
      return rangeResponse(start, end);
    },
  };
  const dependencies = {
    "@/lib/supabase": { getSupabaseClient: () => ({ from: () => builder }) },
    "@/lib/adminAccounts": { fetchAdminAccounts: async () => accountResponse },
    "./dashboard-model": { countActiveMembers },
  };
  const exports = {};
  new Function("require", "exports", compiled)((name) => dependencies[name], exports);
  return { service: exports, requests };
}

const row = (index = 0) => ({
  application_id: `TEST-${String(index).padStart(5, "0")}`, member_name: "Test Member",
  loan_type: "Regular", amount: "1000.25", status: "pending",
  date_submitted: "2026-10-01", date_approved: null, date_released: null,
  created_at: "2026-10-01T01:00:00Z",
  members: { member_id: "TEST-M01", first_name: "Test", last_name: "Member" },
});

test("the complete portfolio is loaded beyond API row limits, including smaller server page caps", async () => {
  const rows = Array.from({ length: 1201 }, (_, index) => row(index));
  const { service, requests } = loadService((start) => ({
    data: rows.slice(start, start + 200), count: rows.length, error: null,
  }));
  const result = await service.fetchDashboardLoans();
  assert.equal(result.length, 1201);
  assert.equal(requests.length, 7);
  assert.deepEqual(requests.map(([start]) => start), [0, 200, 400, 600, 800, 1000, 1200]);
  assert.equal(result[0].amount, 1000.25);
  assert.equal(result[0].status, "Pending");
});

test("incomplete, changing or duplicate portfolio snapshots fail rather than undercount", async () => {
  for (const response of [
    () => ({ data: [], count: 1, error: null }),
    (start) => ({ data: [row(start)], count: start ? 3 : 2, error: null }),
    () => ({ data: [row(0)], count: 2, error: null }),
  ]) {
    await assert.rejects(loadService(response).service.fetchDashboardLoans());
  }
});

test("invalid dates and amounts cannot turn into valid reporting values", async () => {
  for (const invalid of [{ date_submitted: "2026-02-31" }, { amount: "" }, { amount: "not a number" }]) {
    const { service } = loadService(() => ({ data: [{ ...row(), ...invalid }], count: 1, error: null }));
    await assert.rejects(service.fetchDashboardLoans());
  }
});

test("failed loan requests stay distinguishable from a successfully empty portfolio", async () => {
  const failed = loadService(() => ({ data: null, count: null, error: { message: "offline" } }));
  await assert.rejects(failed.service.fetchDashboardLoans(), /Unable to load loan records/);
  const empty = loadService(() => ({ data: [], count: 0, error: null }));
  assert.deepEqual(await empty.service.fetchDashboardLoans(), []);
});
