import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const compiled = ts.transpileModule(readFileSync(new URL("./adminNotifications.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const recipient = "admin-a";
const row = (overrides = {}) => ({ id: "notice-1", user_id: recipient, title: "Account alert", message: "Test message", type: "info", read: false, created_at: "2026-10-28T04:00:00Z", ...overrides });

function loadService(responses, user = { id: recipient, app_metadata: { role: "admin", account_status: "active" } }) {
  const calls = [];
  const client = {
    auth: { getSession: async () => ({ data: { session: user ? { user } : null }, error: null }) },
    from(table) {
      const call = { table, filters: [], orders: [] };
      calls.push(call);
      const query = {
        select(columns, options) { call.select = { columns, options }; return this; },
        update(payload, options) { call.update = { payload, options }; return this; },
        eq(column, value) { call.filters.push([column, value]); return this; },
        in(column, values) { call.filters.push([column, values]); return this; },
        or(value) { call.or = value; return this; },
        order(column, options) { call.orders.push([column, options]); return this; },
        range(start, end) { call.range = [start, end]; return this; },
        maybeSingle() { call.single = true; return this; },
        then(resolve, reject) { return Promise.resolve(responses.shift()).then(resolve, reject); },
      };
      return query;
    },
  };
  const dependencies = {
    "@/lib/supabase": { getSupabaseClient: () => client },
    "@/lib/auth/roles": { getAdminRole: user => ["admin", "coop_admin", "super_admin"].includes(user.app_metadata.role) ? user.app_metadata.role : null },
  };
  const exports = {};
  new Function("require", "exports", compiled)(name => dependencies[name], exports);
  return { ...exports, calls };
}

test("unread counts are exact, recipient-scoped, and distinguish zero from unavailable", async () => {
  const service = loadService([{ count: 0, error: null }]);
  assert.equal(await service.fetchUnreadNotificationCount(recipient), 0);
  assert.deepEqual(service.calls[0].filters, [["user_id", recipient], ["read", false]]);
  assert.deepEqual(service.calls[0].select.options, { count: "exact", head: true });
  await assert.rejects(loadService([{ count: null, error: null }]).fetchUnreadNotificationCount(recipient));
  await assert.rejects(loadService([{ count: 0, error: { message: "offline" } }]).fetchUnreadNotificationCount(recipient));
});

test("list queries request only safe fields, newest first, with real pagination and unread filtering", async () => {
  const service = loadService([{ data: [row()], count: 41, error: null }]);
  const page = await service.fetchAdminNotifications(recipient, "unread", 20);
  assert.equal(page.total, 41);
  assert.equal(page.items[0].title, "Account alert");
  assert.deepEqual(service.calls[0].range, [20, 39]);
  assert.deepEqual(service.calls[0].filters, [["user_id", recipient], ["read", false]]);
  assert.deepEqual(service.calls[0].orders, [["created_at", { ascending: false }], ["id", { ascending: false }]]);
  assert.equal(service.calls[0].select.columns, "id,user_id,title,message,type,read,created_at");
});

test("foreign-recipient or broadcast records fail closed even if an overly broad policy returns them", async () => {
  for (const user_id of ["other-admin", "member-user", null]) {
    const service = loadService([{ data: [row({ user_id })], count: 1, error: null }]);
    await assert.rejects(service.fetchAdminNotifications(recipient, "all"), /unsupported record/);
  }
});

test("wrong, non-admin, inactive and expired sessions never issue notification queries", async () => {
  const users = [null,
    { id: "other-user", app_metadata: { role: "super_admin" } },
    { id: recipient, app_metadata: { role: "member" } },
    { id: recipient, app_metadata: { role: "admin", account_status: "blocked" } }];
  for (const user of users) {
    const service = loadService([], user);
    await assert.rejects(service.fetchAdminNotifications(recipient, "all"), /session is unavailable/);
    assert.equal(service.calls.length, 0);
  }
});

test("mark-as-read updates only read on the intended recipient's matching unread record", async () => {
  const service = loadService([{ data: [{ id: "notice-1", user_id: recipient, read: true }], error: null }]);
  await service.markAdminNotificationRead(recipient, "notice-1");
  assert.deepEqual(service.calls[0].update.payload, { read: true });
  assert.deepEqual(service.calls[0].filters, [["user_id", recipient], ["id", "notice-1"], ["read", false]]);
});

test("a no-op update must verify the record is already read rather than pretending it persisted", async () => {
  const service = loadService([{ data: [], error: null }, { data: row({ read: false }), error: null }]);
  await assert.rejects(service.markAdminNotificationRead(recipient, "notice-1"), /could not be marked/);
  const alreadyRead = loadService([{ data: [], error: null }, { data: row({ read: true }), error: null }]);
  await alreadyRead.markAdminNotificationRead(recipient, "notice-1");
});

test("mark all covers all own unread records, not just the visible page", async () => {
  const service = loadService([{ count: 52, error: null }]);
  await service.markAllAdminNotificationsRead(recipient);
  assert.deepEqual(service.calls[0].filters, [["user_id", recipient], ["read", false]]);
  assert.deepEqual(service.calls[0].update.payload, { read: true });
  assert.equal(service.calls[0].range, undefined);
});

test("read failures and denied bulk writes produce errors", async () => {
  await assert.rejects(loadService([{ error: { message: "denied" } }]).markAdminNotificationRead(recipient, "notice-1"));
  await assert.rejects(loadService([{ count: 0, error: null }, { count: 2, error: null }]).markAllAdminNotificationsRead(recipient), /could not be updated/);
});

test("notification destinations use only existing role-prefixed routes", () => {
  const service = loadService([]);
  assert.equal(service.notificationHref("loan_approval", "/admin"), "/admin/loan-applications");
  assert.equal(service.notificationHref("payment_reminder", "/super-admin"), "/super-admin/active-loans");
  assert.equal(service.notificationHref("info", ""), null);
  assert.equal(service.notificationHref("javascript:alert(1)", "/admin"), null);
});

test("read/category/search filters run on the server and keep the recipient predicate", async () => {
  const service = loadService([{ data: [], count: 0, error: null }]);
  await service.fetchAdminNotifications(recipient, "read", 0, 20, { search: 'A, (test) "quoted"', category: "loans" });
  assert.deepEqual(service.calls[0].filters, [["user_id", recipient], ["read", true], ["type", ["loan_approval", "loan_rejection"]]]);
  assert.ok(service.calls[0].or.startsWith('title.ilike."%A, (test)'));
  assert.ok(service.calls[0].or.includes('message.ilike.'));
  assert.ok(service.calls[0].or.includes('\\"quoted\\"'));
});

test("relative timestamps handle recent and invalid dates", () => {
  const service = loadService([]);
  const now = Date.parse("2026-10-28T04:05:00Z");
  assert.equal(service.notificationRelativeTime("2026-10-28T04:00:00Z", now), "5 minutes ago");
  assert.equal(service.notificationRelativeTime("2026-10-28T04:04:45Z", now), "Just now");
  assert.equal(service.notificationRelativeTime("invalid", now), "Time unavailable");
});
