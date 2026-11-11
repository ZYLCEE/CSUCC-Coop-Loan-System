import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

// Real All Accounts page/components; synthetic services and credentials only.
export async function checkAccountActions({ browser, url }) {
  const directory = resolve(process.env.COOP_ACCOUNT_SCREENSHOTS ?? "docs/account-actions-qa/screenshots");
  mkdirSync(directory, { recursive: true });
  const metrics = [];
  const expected = {
    "Sample Member": ["View Details", "Edit", "Reset Password", "Block", "Delete"],
    "Sample Administrator": ["View Details", "Edit", "Reset Password", "Role & Privileges", "Block", "Delete"],
    "Other Super Admin": ["View Details", "Edit", "Role & Privileges", "Block", "Delete"],
    "Current Super Admin": ["View Details", "Edit"],
  };
  for (const viewport of [{ width:1366, height:768 }, { width:768, height:1024 }, { width:390, height:844 }]) {
    const context = await browser.newContext({ viewport, locale:"en-PH", timezoneId:"Asia/Manila" });
    await context.route("**/*", route => new URL(route.request().url()).origin === new URL(url).origin ? route.continue() : route.abort());
    const page = await context.newPage();
    const errors = []; page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${url}/super-admin/all-accounts?accounts`);
    const open = async name => {
      const button = page.getByRole("button", { name:`Open actions for ${name}`, exact:true });
      await button.scrollIntoViewIfNeeded();
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await button.click();
      await page.getByRole("menu").waitFor();
    };
    const shot = async name => {
      const dialog = page.getByRole("dialog").last();
      if (await dialog.count()) {
        const measure = await dialog.evaluate(el => {
          const r = el.getBoundingClientRect(), f = el.querySelector(".ui-dialog-footer").getBoundingClientRect();
          return { width:r.width, height:r.height, bounded:r.x>=0&&r.y>=0&&r.bottom<=innerHeight&&r.right<=innerWidth, overflow:el.scrollWidth>el.clientWidth, footerVisible:f.bottom<=innerHeight };
        });
        assert.ok(measure.bounded && !measure.overflow && measure.footerVisible, `${name}: ${JSON.stringify(measure)}`);
        metrics.push({ name, viewport, ...measure });
      }
      await page.screenshot({ path:resolve(directory, `${name}-${viewport.width}.png`) });
    };
    for (const [name, labels] of Object.entries(expected)) {
      await open(name);
      assert.deepEqual(await page.getByRole("menuitem").allTextContents(), labels);
      if (name === "Other Super Admin") {
        for (const action of ["Edit", "Block", "Delete"]) assert.equal(await page.getByRole("menuitem", { name:action, exact:true }).isDisabled(), true);
      }
      const box = await page.getByRole("menu").boundingBox();
      assert.ok(box.x>=0 && box.x+box.width<=viewport.width && box.y>=0 && box.y+box.height<=viewport.height);
      await shot(`menu-${name.toLowerCase().replaceAll(" ", "-")}`);
      await page.keyboard.press("End");
      assert.equal(await page.getByRole("menuitem").filter({ hasText:name==="Other Super Admin"?"Role & Privileges":labels.at(-1) }).last().evaluate(el => el === document.activeElement), true);
      await page.keyboard.press("Escape");
      assert.equal(await page.getByRole("button", { name:`Open actions for ${name}`, exact:true }).evaluate(el => el===document.activeElement), true);
    }
    await open("Sample Member"); await page.getByRole("menuitem", { name:"View Details", exact:true }).click();
    for (const title of ["Personal Information", "Contact Information", "Account Information"]) await page.getByRole("heading", { name:title, exact:true }).waitFor();
    assert.equal(await page.evaluate(() => window.calls.length), 0);
    await shot("member-details"); await page.keyboard.press("Escape");
    await open("Sample Member"); await page.getByRole("menuitem", { name:"Edit", exact:true }).click();
    await shot("member-edit"); await page.keyboard.press("Escape");
    await open("Current Super Admin"); await page.getByRole("menuitem", { name:"Edit", exact:true }).click();
    assert.equal(await page.evaluate(() => window.navigationPath), "/super-admin/profile");
    await open("Other Super Admin"); await page.getByRole("menuitem", { name:"Role & Privileges", exact:true }).click();
    assert.equal(await page.getByRole("checkbox").count(), 0);
    assert.ok((await page.getByRole("dialog").innerText()).includes("Access is inherited"));
    await shot("super-privileges-readonly"); await page.keyboard.press("Escape");

    // Actual reset wiring: form -> existing verification/grant -> confirm -> result.
    await open("Sample Member"); await page.getByRole("menuitem", { name:"Reset Password", exact:true }).click();
    assert.equal(await page.getByRole("button", { name:"Continue to Verify", exact:true }).isDisabled(), true);
    await shot("reset-password");
    const fields = page.locator('input[autocomplete="new-password"]');
    await fields.first().fill("SyntheticOnly123"); await fields.last().fill("DifferentOnly123");
    await page.getByRole("alert").filter({ hasText:"Passwords do not match." }).waitFor();
    await fields.last().fill("SyntheticOnly123");
    await page.keyboard.press("Escape"); await shot("unsaved-reset");
    await page.getByRole("button", { name:"Keep editing", exact:true }).click();
    assert.equal(await fields.first().inputValue(), "SyntheticOnly123");
    await page.getByRole("button", { name:"Continue to Verify", exact:true }).click();
    await page.getByRole("heading", { name:"Verify Password Reset", exact:true }).waitFor();
    await shot("reset-verification");
    await page.getByRole("dialog").last().getByRole("button", { name:"Cancel", exact:true }).click();
    assert.equal(await page.evaluate(() => window.calls.length), 0);
    assert.equal(await fields.first().inputValue(), "SyntheticOnly123");
    await page.getByRole("button", { name:"Continue to Verify", exact:true }).click();
    await page.locator('input[autocomplete="current-password"]').fill("SyntheticActor123");
    await page.evaluate(() => { window.verifyFailure=true; });
    await page.getByRole("button", { name:"Verify password", exact:true }).click();
    await page.getByText("Password rejected", { exact:true }).waitFor();
    await page.evaluate(() => { window.verifyFailure=false; });
    await page.getByRole("button", { name:"Verify password", exact:true }).click();
    await page.getByRole("heading", { name:"Verify Password Reset", exact:true }).waitFor({ state:"detached" });
    const confirm = page.getByRole("dialog").last();
    assert.ok((await confirm.innerText()).includes("Sample Member"));
    assert.ok(!(await confirm.innerText()).includes("SyntheticOnly123"));
    await shot("reset-confirmation");
    await page.evaluate(() => { window.executeFailure=true; window.executeFailureMessage="Synthetic reset failed"; });
    await confirm.getByRole("button", { name:"Reset Password", exact:true }).evaluate(el => { el.click(); el.click(); });
    await page.getByRole("heading", { name:"Action Failed", exact:true }).waitFor();
    assert.equal(await page.evaluate(() => window.calls.filter(call => call.mode==="execute").length), 1);
    await shot("reset-error"); await page.getByRole("button", { name:"OK", exact:true }).click();
    assert.equal(await fields.first().inputValue(), "SyntheticOnly123");
    await page.evaluate(() => { window.executeFailure=false; });
    await page.getByRole("button", { name:"Continue to Verify", exact:true }).click();
    await page.locator('input[autocomplete="current-password"]').fill("SyntheticActor123");
    await page.getByRole("button", { name:"Verify password", exact:true }).click();
    await page.getByRole("heading", { name:"Verify Password Reset", exact:true }).waitFor({ state:"detached" });
    await page.getByRole("dialog").last().getByRole("button", { name:"Reset Password", exact:true }).click();
    assert.equal(await page.getByRole("heading", { name:"Success", exact:true }).count(), 0);
    await page.getByRole("heading", { name:"Success", exact:true }).waitFor(); await shot("reset-success");
    const request = await page.evaluate(() => window.calls.filter(call => call.mode==="execute").at(-1));
    assert.equal(request.action, "reset-account-password"); assert.equal(request.target, "CSUCC-2026-0001");
    assert.deepEqual(request.payload, {}); assert.equal(request.secret.temporaryPassword, "SyntheticOnly123"); assert.ok(request.grant);
    assert.equal(await page.evaluate(() => window.accountLoads), 2);
    await page.getByRole("button", { name:"OK", exact:true }).click(); assert.equal(await page.getByRole("dialog").count(), 0);

    await open("Sample Administrator"); await page.getByRole("menuitem", { name:"Reset Password", exact:true }).click();
    assert.ok((await page.getByRole("dialog").innerText()).includes("Sample Administrator"));
    await page.getByRole("button", { name:"Cancel", exact:true }).click();

    // Edit cannot execute until password verification and final confirmation.
    await open("Sample Member"); await page.getByRole("menuitem", { name:"Edit", exact:true }).click();
    await page.locator("#address").fill("Updated synthetic address");
    const editsBefore = await page.evaluate(() => window.calls.filter(c => c.mode==="execute").length);
    const loadsBefore = await page.evaluate(() => window.accountLoads);
    await page.getByRole("button", {name:"Save Changes",exact:true}).evaluate(el => { el.click(); el.click(); });
    await page.getByRole("heading", {name:"Verify Account Changes",exact:true}).waitFor(); await shot("edit-verification");
    assert.equal(await page.evaluate(() => window.calls.filter(c => c.mode==="execute").length), editsBefore);
    assert.equal(await page.locator('#address').isDisabled(),true);
    await page.getByRole("dialog").last().getByRole("button", {name:"Cancel",exact:true}).click();
    assert.equal(await page.locator('#address').inputValue(),"Updated synthetic address");
    assert.equal(await page.locator('#address').isDisabled(),false);
    await page.keyboard.press("Escape"); await page.getByRole("button", {name:"Keep editing",exact:true}).click();
    const verifyEdit = async () => {
      await page.getByRole("button", {name:"Save Changes",exact:true}).click();
      await page.locator('input[autocomplete="current-password"]').fill("SyntheticActor123");
      await page.getByRole("button", {name:"Verify password",exact:true}).click();
      await page.getByRole("heading", {name:"Save Account Changes",exact:true}).waitFor();
    };
    await verifyEdit(); await shot("edit-confirmation");
    await page.evaluate(() => { window.executeFailure=true; window.executeFailureMessage="Synthetic edit failed"; });
    await page.getByRole("dialog").last().getByRole("button", {name:"Save Changes",exact:true}).click();
    await page.getByRole("heading", {name:"Action Failed",exact:true}).waitFor(); await shot("edit-error");
    assert.equal(await page.evaluate(() => window.accountLoads),loadsBefore);
    await page.getByRole("button", {name:"OK",exact:true}).click();
    assert.equal(await page.locator('#address').inputValue(),"Updated synthetic address");
    await page.evaluate(() => { window.executeFailure=false; });
    await verifyEdit();
    await page.getByRole("dialog").last().getByRole("button", {name:"Save Changes",exact:true}).click();
    await page.getByRole("heading", {name:"Success",exact:true}).waitFor(); await shot("edit-success");
    const editRequest = await page.evaluate(() => window.calls.filter(c => c.mode==="execute").at(-1));
    assert.equal(editRequest.action,"edit-account"); assert.equal(editRequest.target,"CSUCC-2026-0001");
    assert.equal(editRequest.payload.address,"Updated synthetic address"); assert.ok(editRequest.grant);
    assert.equal(await page.evaluate(() => window.accountLoads),loadsBefore+1);
    await page.getByRole("button", {name:"OK",exact:true}).click();

    // Existing privileged API is mocked; failures retain changes, confirmation is required.
    await open("Sample Administrator"); await page.getByRole("menuitem", { name:"Role & Privileges", exact:true }).click();
    await page.getByRole("checkbox").first().waitFor(); await shot("admin-privileges");
    await page.getByRole("checkbox").first().check();
    await page.getByLabel("Your Super Admin Password", { exact:false }).fill("SyntheticActor123");
    await page.keyboard.press("Escape"); await page.getByRole("button", { name:"Keep editing", exact:true }).click();
    await page.getByRole("button", { name:"Save Changes", exact:true }).click();
    await page.getByRole("heading", { name:"Save Account Privileges?", exact:true }).waitFor();
    assert.equal(await page.evaluate(() => window.privilegeCalls.filter(call => call.method==="PUT").length), 0);
    await shot("privileges-confirmation");
    await page.evaluate(() => { window.privilegeFailure=true; });
    await page.getByRole("dialog").last().getByRole("button", { name:"Save Changes", exact:true }).evaluate(el => { el.click(); el.click(); });
    await page.getByRole("alert").filter({ hasText:"Synthetic privilege request failed" }).waitFor();
    assert.equal(await page.evaluate(() => window.privilegeCalls.filter(call => call.method==="PUT").length), 1);
    await page.getByRole("button", { name:"Back to Editing", exact:true }).click();
    assert.equal(await page.getByRole("checkbox").first().isChecked(), true);
    await page.evaluate(() => { window.privilegeFailure=false; });
    await page.getByRole("button", { name:"Save Changes", exact:true }).click();
    await page.getByRole("dialog").last().getByRole("button", { name:"Save Changes", exact:true }).click();
    await page.getByRole("heading", { name:"Privileges Updated", exact:true }).waitFor(); await shot("privileges-success");
    await page.getByRole("button", { name:"OK", exact:true }).click();
    for (const action of ["Block", "Delete"]) {
      await open("Sample Member"); await page.getByRole("menuitem", { name:action, exact:true }).click();
      const textarea=page.locator('#account-action-reason'); await textarea.waitFor();
      await page.waitForFunction(() => !document.querySelector('#account-action-reason').disabled);
      await shot(`${action.toLowerCase()}-reason`);
      await page.getByRole("button", {name:"Continue to Verify",exact:true}).click();
      assert.equal(await textarea.evaluate(el => el.validity.valueMissing),true);
      await textarea.fill("  "); await page.getByRole("button", {name:"Continue to Verify",exact:true}).click();
      await page.getByText("Please enter a reason for this account action.", {exact:true}).waitFor();
      const reason=`Synthetic documented ${action.toLowerCase()} reason`;
      await textarea.fill(`  ${reason}  `); await page.keyboard.press("Escape");
      await page.getByRole("button", {name:"Keep editing",exact:true}).click();
      const count=await page.evaluate(() => window.calls.filter(c=>c.mode==="execute").length);
      await page.getByRole("button", {name:"Continue to Verify",exact:true}).click(); await shot(`${action.toLowerCase()}-verification`);
      await page.getByRole("dialog").last().getByRole("button", {name:"Cancel",exact:true}).click();
      assert.equal(await textarea.inputValue(),`  ${reason}  `);
      const verifyReason=async()=>{
        await page.getByRole("button", {name:"Continue to Verify",exact:true}).click();
        await page.locator('input[autocomplete="current-password"]').fill("SyntheticActor123");
        await page.getByRole("button", {name:"Verify password",exact:true}).click();
        await page.getByRole("heading", {name:action==="Block"?"Verify Account Block":"Verify Account Deletion",exact:true}).waitFor({state:"detached"});
      };
      await verifyReason(); await page.getByRole("dialog").last().getByText(reason,{exact:true}).waitFor(); await shot(`${action.toLowerCase()}-confirmation`);
      await page.getByRole("dialog").last().getByRole("button", { name:"Cancel", exact:true }).click();
      assert.equal(await page.evaluate(() => window.calls.filter(call => call.mode==="execute").length), count);
      assert.equal(await textarea.inputValue(),`  ${reason}  `);
      await verifyReason(); await page.evaluate(() => { window.executeFailure=true; window.executeFailureMessage="Synthetic account action failed"; });
      await page.getByRole("dialog").last().getByRole("button", {name:`${action} Account`,exact:true}).evaluate(el=>{el.click();el.click();});
      await page.getByRole("heading", {name:"Action Failed",exact:true}).waitFor(); await shot(`${action.toLowerCase()}-error`);
      assert.equal(await page.evaluate(() => window.calls.filter(c=>c.mode==="execute").length),count+1);
      await page.getByRole("button", {name:"OK",exact:true}).click(); assert.equal(await textarea.inputValue(),`  ${reason}  `);
      await page.evaluate(() => { window.executeFailure=false; }); await verifyReason();
      await page.getByRole("dialog").last().getByRole("button", {name:`${action} Account`,exact:true}).click();
      assert.equal(await page.getByRole("heading", {name:"Success",exact:true}).count(),0);
      await page.getByRole("heading", {name:"Success",exact:true}).waitFor(); await shot(`${action.toLowerCase()}-success`);
      const mutation=await page.evaluate(() => window.calls.filter(c=>c.mode==="execute").at(-1));
      assert.equal(mutation.action,`${action.toLowerCase()}-account`); assert.equal(mutation.target,"CSUCC-2026-0001"); assert.deepEqual(mutation.payload,{reason}); assert.ok(mutation.grant);
      await page.getByRole("button", {name:"OK",exact:true}).click();
      if(action==="Block"){
        await open("Sample Member"); await page.getByRole("menuitem", {name:"Unblock",exact:true}).click();
        await page.getByRole("heading", {name:"Verify Account Unblock",exact:true}).waitFor();
        await page.getByRole("button", {name:"Cancel",exact:true}).click();
      } else assert.equal(await page.getByRole("button", {name:"Open actions for Sample Member",exact:true}).count(),0);
    }
    assert.deepEqual(errors, []);
    await context.close();
  }
  for (const role of ["admin", "member", null]) {
    const page = await browser.newPage(); await page.addInitScript(role => { window.testRole=role; }, role);
    await page.goto(`${url}/super-admin/all-accounts?accounts`);
    await page.getByRole("button", { name:"Open actions for Sample Administrator", exact:true }).click();
    assert.deepEqual(await page.getByRole("menuitem").allTextContents(), ["View Details"]);
    assert.equal(await page.evaluate(() => window.calls.length), 0); await page.close();
  }
  const inactive = await browser.newPage(); await inactive.addInitScript(() => { window.inactiveAdmin=true; });
  await inactive.goto(`${url}/super-admin/all-accounts?accounts`);
  await inactive.getByRole("button", { name:"Open actions for Sample Administrator", exact:true }).click();
  await inactive.getByRole("menuitem", { name:"Role & Privileges", exact:true }).click();
  await inactive.getByRole("checkbox").first().waitFor(); assert.equal(await inactive.getByRole("checkbox").first().isDisabled(), true);
  assert.equal(await inactive.getByRole("button", { name:"Save Changes", exact:true }).isDisabled(), true); await inactive.close();
  const unavailable = await browser.newPage(); await unavailable.addInitScript(() => { window.privilegeFailure=true; });
  await unavailable.goto(`${url}/super-admin/all-accounts?accounts`);
  await unavailable.getByRole("button", { name:"Open actions for Sample Administrator", exact:true }).click();
  await unavailable.getByRole("menuitem", { name:"Role & Privileges", exact:true }).click();
  await unavailable.getByRole("alert").filter({ hasText:"Synthetic privilege request failed" }).waitFor();
  assert.equal(await unavailable.getByRole("checkbox").count(), 0);
  assert.equal(await unavailable.getByRole("button", { name:"Save Changes", exact:true }).isDisabled(), true);
  await unavailable.evaluate(() => { window.privilegeFailure=false; });
  await unavailable.getByRole("button", { name:"Retry", exact:true }).click();
  await unavailable.getByRole("checkbox").first().waitFor(); await unavailable.close();
  const unsupported=await browser.newPage(); await unsupported.addInitScript(() => { window.accountReasonsUnavailable=true; });
  await unsupported.goto(`${url}/super-admin/all-accounts?accounts`);
  await unsupported.getByRole("button",{name:"Open actions for Sample Member",exact:true}).click();
  await unsupported.getByRole("menuitem",{name:"Block",exact:true}).click();
  await unsupported.getByText("This protected action is currently unavailable. Please retry or contact the system administrator.",{exact:true}).waitFor();
  assert.equal(await unsupported.getByRole("button",{name:"Continue to Verify",exact:true}).isDisabled(),true);
  assert.equal(await unsupported.evaluate(()=>window.calls.length),0);
  await unsupported.evaluate(()=>{window.accountReasonsUnavailable=false;});await unsupported.getByRole("button",{name:"Retry",exact:true}).click();
  await unsupported.waitForFunction(()=>!document.querySelector('#account-action-reason').disabled);await unsupported.close();
  writeFileSync(resolve(directory, "metrics.json"), JSON.stringify(metrics, null, 2));
  console.log("PASS: All Accounts menus, reset security/cancel/error/retry, delegated privileges, protected Super Admin, read-only actors, desktop/tablet/mobile (synthetic services only).");
}
