import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const output = ts.transpileModule(readFileSync(new URL("./accountActions.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const compiled = { exports: {} };
new Function("exports", output)(compiled.exports);
const { accountActions } = compiled.exports;
const [member, admin, other, self] = JSON.parse(readFileSync(new URL("../../../tests/fixtures/accounts.json", import.meta.url), "utf8"));
const actions = target => accountActions(target, "synthetic-super", "super_admin", false);

test("Member has edit, reset, block and delete; Admin also has privileges", () => {
  assert.deepEqual(actions(member), { ownSuper:false, protectedSuper:false, edit:true, reset:true, privileges:false, block:true, delete:true });
  assert.equal(actions(admin).privileges, true);
});
test("self Super Admin is identified by Auth ID, even if row status is stale", () => {
  for (const status of ["Active", "Inactive"]) {
    const own = actions({ ...self, status });
    assert.equal(own.ownSuper, true);
    for (const key of ["edit", "reset", "privileges", "block", "delete"]) assert.equal(own[key], false);
  }
  assert.equal(actions({ ...other, email:self.email }).ownSuper, false);
});
test("other Super Admin retains protected mutations and read-only privileges", () => {
  const otherActions = actions(other);
  assert.equal(otherActions.protectedSuper, true);
  assert.equal(otherActions.privileges, true);
  for (const key of ["edit", "reset", "block", "delete"]) assert.equal(otherActions[key], false);
});
test("ordinary actors, read-only, unlinked or inconsistent records get no mutation controls", () => {
  for (const role of ["admin", "member", null]) {
    for (const key of ["edit", "reset", "privileges", "block", "delete"]) assert.equal(accountActions(admin, "other", role, false)[key], false);
  }
  for (const target of [{ ...member, profileLinked:false }, { ...member, authUserId:null }, { ...member, integrityIssue:"Identity mismatch" }, { ...member, role:"Unknown" }]) {
    for (const key of ["edit", "reset", "privileges", "block", "delete"]) assert.equal(actions(target)[key], false);
  }
  assert.equal(accountActions(member, "synthetic-super", "super_admin", true).edit, false);
});
