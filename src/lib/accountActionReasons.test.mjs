import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
const code = ts.transpileModule(readFileSync(new URL("./accountActionReasons.ts", import.meta.url), "utf8"), { compilerOptions:{ module:ts.ModuleKind.CommonJS } }).outputText;
function setup(response) {
  const compiled = { exports:{} };
  new Function("exports", "require", code)(compiled.exports, () => ({ getSupabaseClient:() => ({ functions:{ invoke:async(name, options) => {
    assert.equal(name,"secure-admin-action"); assert.deepEqual(options.body,{mode:"account-action-reason-capability"});
    if (response instanceof Error) throw response; return response;
  } } }) }));
  return compiled.exports;
}
const contract = { version:1, reason_max_length:2000, actions:["block-account","delete-account"], audit_mode:"authorized-request-and-result" };
test("account reasons trim whitespace and enforce the same length as the trusted backend", () => {
  const {validateAccountActionReason:validate} = setup({});
  assert.equal(validate("  Actual account reason  "),"Actual account reason");
  for(const invalid of ["", " \n\t ", "x".repeat(2001), "😀".repeat(1001)]) assert.throws(() => validate(invalid));
  assert.equal(validate("x".repeat(2000)).length,2000);
});
test("missing or incompatible audited-account capability fails closed", async () => {
  assert.equal(await setup({data:contract,error:null}).accountActionReasonsAvailable(),true);
  for(const response of [new Error("Unavailable"), {data:null,error:{}}, ...[{version:0},{reason_max_length:500},{audit_mode:"none"},{actions:["block-account"]},{actions:["block-account","delete-account","unblock-account"]}].map(change => ({data:{...contract,...change},error:null}))]) {
    assert.equal(await setup(response).accountActionReasonsAvailable(),false);
  }
});
