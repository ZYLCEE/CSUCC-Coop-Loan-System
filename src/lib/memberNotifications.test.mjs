import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const compiled = ts.transpileModule(readFileSync(new URL("./memberNotifications.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const actor = { id: "super-admin", app_metadata: { role: "super_admin", account_status: "active" } };
const row = { id: "outgoing-1", user_id: null, title: "Recorded outgoing message", message: "Test message", type: "Information", send_to: "allMembers", recipient_summary: "All members", recipient_count: 2, status: "sent", created_at: "2026-10-28T00:00:00Z", scheduled_at: null };

function service(response, user = actor) {
  const calls = [];
  const client = {
    auth: { getSession: async () => ({ data: { session: user ? { user } : null }, error: null }) },
    from(table) {
      const call = { table, filters: [] }; calls.push(call);
      return {
        select(columns) { call.columns = columns; return this; },
        is(column, value) { call.filters.push([column, "is", value]); return this; },
        not(column, operator, value) { call.filters.push([column, "not", operator, value]); return this; },
        eq(column, value) { call.filters.push([column, "eq", value]); return this; },
        ilike(column, value) { call.search = [column, value]; return this; },
        order() { return this; },
        range(start, end) { call.range = [start, end]; return Promise.resolve(response); },
      };
    },
  };
  const exports = {};
  const dependencies = {
    "@/lib/supabase": { getSupabaseClient: () => client },
    "@/lib/auth/roles": { getAdminRole: user => user.app_metadata.role },
  };
  new Function("require", "exports", compiled)(name => dependencies[name], exports);
  return { ...exports, calls };
}

test("outgoing history uses the existing outgoing metadata contract, not recipient inbox rows", async () => {
  const api = service({ data: [row], count: 1, error: null });
  const result = await api.fetchOutgoingNotifications(actor.id, "all");
  assert.equal(result.items[0].status, "sent");
  assert.deepEqual(api.calls[0].filters, [["user_id", "is", null], ["send_to", "not", "is", null]]);
});

test("history status/search/pagination are server queries", async () => {
  const api = service({ data: [], count: 0, error: null });
  await api.fetchOutgoingNotifications(actor.id, "failed", "Delivery", 20);
  assert.deepEqual(api.calls[0].filters.at(-1), ["status", "eq", "failed"]);
  assert.deepEqual(api.calls[0].search, ["title", "%Delivery%"]);
  assert.deepEqual(api.calls[0].range, [20, 39]);
});

test("missing metadata is unavailable, whereas a valid empty ledger remains empty", async () => {
  await assert.rejects(service({ error: { code: "42703" }, count: null, data: null }).fetchOutgoingNotifications(actor.id, "all"), /unavailable/);
  assert.deepEqual(await service({ data: [], count: 0, error: null }).fetchOutgoingNotifications(actor.id, "all"), { items: [], total: 0 });
});

test("incoming or unsupported-status records cannot masquerade as outgoing delivery history", async () => {
  for (const invalid of [{ ...row, user_id: actor.id }, { ...row, status: "unknown" }]) {
    await assert.rejects(service({ data: [invalid], count: 1, error: null }).fetchOutgoingNotifications(actor.id, "all"), /unsupported format/);
  }
});

test("current outgoing permissions are preserved and unauthorized requests never query records", async () => {
  for (const user of [null, { ...actor, app_metadata: { role: "admin" } }, { ...actor, app_metadata: { role: "super_admin", account_status: "blocked" } }]) {
    const api = service(null, user);
    await assert.rejects(api.fetchOutgoingNotifications(actor.id, "all"), /authorized Super Admin/);
    assert.equal(api.calls.length, 0);
  }
});
