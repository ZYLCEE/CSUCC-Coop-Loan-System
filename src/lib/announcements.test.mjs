import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const compile = (path) => ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const model = {};
new Function("exports", compile("../components/announcements/AnnouncementsData.tsx"))(model);
const compiled = compile("./announcements.ts");
const actor = { id: "super-admin", app_metadata: { role: "super_admin", account_status: "active" } };
const row = { id: "announcement-1", title: "Test title", content: "Actual record content", category_id: "general", category: { id: "general", name: "General" }, status: "published", created_at: "2026-10-28T01:00:00Z", updated_at: "2026-10-28T01:00:00Z", published_at: "2026-10-28T01:00:00Z", scheduled_at: null, author_name: "Test author", notify_members: false };
function service(response = { data: [row], count: 1, error: null }, user = actor) {
  const calls = [], rpcs = [];
  const client = {
    auth: { getSession: async () => ({ data: { session: user ? { user } : null }, error: null }) },
    from(table) {
      const call = { table, filters: [], orders: [] }; calls.push(call);
      return {
        select(columns, options) { call.columns = columns; call.options = options; return this; },
        eq(column, value) { call.filters.push([column, value]); return this; },
        or(value) { call.search = value; return this; },
        order(column, options) { call.orders.push([column, options]); return this; },
        range(start, end) { call.range = [start, end]; return Promise.resolve(response); },
        then(resolve, reject) { return Promise.resolve(response).then(resolve, reject); },
      };
    },
    rpc(name, args) { rpcs.push({ name, args }); return Promise.resolve(response); },
  };
  const exports = {};
  const dependencies = { "@/lib/supabase": { getSupabaseClient: () => client }, "@/lib/auth/roles": { getAdminRole: user => ["admin", "super_admin"].includes(user?.app_metadata.role) ? user.app_metadata.role : null }, "@/components/announcements/AnnouncementsData": model };
  new Function("require", "exports", compiled)(name => dependencies[name], exports);
  return { ...exports, calls, rpcs };
}
test("announcement lists use exact counts, server statuses, escaped title/content search and bounded pagination", async () => {
  const api = service();
  const result = await api.fetchAnnouncements(actor.id, "published", 'loan,\"%_', 10);
  assert.equal(result.total, 1);
  assert.equal(result.items[0].content, row.content);
  assert.deepEqual(api.calls[0].filters, [["status", "published"]]);
  assert.deepEqual(api.calls[0].range, [10, 19]);
  assert.ok(api.calls[0].search.startsWith('title.ilike."%'));
  assert.ok(api.calls[0].search.includes(',content.ilike."%'));
  assert.ok(api.calls[0].search.includes('\\\\%\\\\_'));
  assert.deepEqual(api.calls[0].options, { count: "exact" });
});
test("unavailable service and malformed dates/status/category are not presented as empty data", async () => {
  assert.deepEqual(await service({ data: [], count: 0, error: null }).fetchAnnouncements(actor.id, "all"), { items: [], total: 0 });
  await assert.rejects(service({ data: null, count: null, error: { code: "42P01" } }).fetchAnnouncements(actor.id, "all"), /could not be loaded/);
  for (const invalid of [{ ...row, status: "unknown" }, { ...row, published_at: null }, { ...row, category: null }]) assert.throws(() => service().parseAnnouncement(invalid), /unsupported record/);
});
test("categories come from stored definitions and unsupported setup does not invent capabilities", async () => {
  assert.deepEqual(await service({ data: [{ id: "actual-id", name: "Actual category" }], error: null }).fetchAnnouncementCategories(actor.id), [{ id: "actual-id", name: "Actual category" }]);
  await assert.rejects(service({ data: [], error: null }).fetchAnnouncementCategories(actor.id), /unavailable/);
  await assert.rejects(service({ data: null, error: { code: "PGRST202" } }).fetchAnnouncementSetup(actor.id), /unavailable/);
});
test("write requests use the persisted RPC and version; no optimistic record or notification insert is created", async () => {
  const api = service({ data: { id: row.id, success: true }, error: null });
  const payload = { title: row.title, content: row.content, category_id: "general", status: "published", scheduled_at: null, notify_members: true };
  await api.manageAnnouncement(actor.id, "save", row.id, row.updated_at, payload);
  assert.deepEqual(api.rpcs, [{ name: "manage_announcement", args: { p_action: "save", p_id: row.id, p_expected_updated_at: row.updated_at, p_payload: payload } }]);
  assert.equal(api.calls.length, 0);
});
test("Admin reads are allowed but existing Super Admin write permission remains mandatory", async () => {
  const admin = service(undefined, { ...actor, app_metadata: { role: "admin" } });
  await admin.fetchAnnouncements(actor.id, "all");
  await assert.rejects(admin.manageAnnouncement(actor.id, "archive", row.id, row.updated_at), /Super Admin/);
  assert.equal(admin.rpcs.length, 0);
  for (const user of [null, { ...actor, app_metadata: { role: "member" } }, { ...actor, app_metadata: { role: "super_admin", account_status: "blocked" } }]) {
    const api = service(undefined, user);
    await assert.rejects(api.fetchAnnouncements(actor.id, "all"), /active administrator/);
    assert.equal(api.calls.length, 0);
  }
});
test("stale writes and missing scheduler return actionable failures", async () => {
  await assert.rejects(service({ error: { code: "40001" } }).manageAnnouncement(actor.id, "archive", row.id, row.updated_at), /changed since/);
  await assert.rejects(service({ error: { code: "55000" } }).manageAnnouncement(actor.id, "archive", row.id, row.updated_at), /scheduler/);
});
test("invalid content and past schedules never reach the write RPC", async () => {
  const api = service();
  const base = { title: "Title", content: "Body", category_id: "general", status: "published", scheduled_at: null, notify_members: false };
  for (const payload of [{ ...base, title: " " }, { ...base, content: " " }, { ...base, status: "scheduled", scheduled_at: "2020-01-01T00:00:00Z" }]) await assert.rejects(api.manageAnnouncement(actor.id, "save", row.id, null, payload), /Check the announcement/);
  assert.equal(api.rpcs.length, 0);
});
test("Philippine schedules do not depend on the workstation timezone and reject invalid calendar dates", () => {
  assert.equal(model.manilaInputToIso("2026-10-28T15:30"), "2026-10-28T07:30:00.000Z");
  assert.equal(model.manilaDateInput("2026-10-28T07:30:00Z"), "2026-10-28T15:30");
  assert.equal(model.manilaInputToIso("2026-02-30T09:00"), null);
  assert.equal(model.manilaInputToIso("invalid"), null);
});
