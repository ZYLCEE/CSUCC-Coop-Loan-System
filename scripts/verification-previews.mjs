import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

export async function checkVerification({ browser, url }) {
  const directory = resolve("docs/application-verification/screenshots");
  mkdirSync(directory, { recursive: true });
  const errors = [];
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto(`${url}/?workflow=loans`);
  await page.getByRole("button", { name: "Open actions for APP-TEST", exact: true }).click();
  const menu = page.getByRole("menu");
  assert.deepEqual(
    (await menu.getByRole("menuitem").allTextContents()).map((text) => text.trim()),
    ["View Details", "Process Application", "Return Application"],
  );
  await menu.getByRole("menuitem", { name: "Process Application", exact: true }).click();

  const processing = page.getByRole("dialog", { name: "Process Application", exact: true });
  await processing.getByRole("navigation", { name: "Application processing steps" }).waitFor();
  assert.equal(await processing.getByRole("navigation", { name: "Application processing steps" }).getByRole("button").count(), 5);
  assert.match(await processing.innerText(), /APP-TEST/);
  assert.match(await processing.innerText(), /Synthetic Maria Cruz/);
  assert.equal(await processing.getByRole("button", { name: "Start checking", exact: true }).count(), 0);
  assert.equal(await processing.getByRole("button", { name: "Refresh progress", exact: true }).count(), 0);
  assert.equal(await processing.getByText("Processing history & additional actions", { exact: true }).count(), 0);
  assert.equal(await processing.getByRole("button", { name: "Return Application", exact: true }).count(), 0);

  const initialState = await page.evaluate(() => ({
    calls: window.verificationCalls ?? [],
    revision: window.verificationData?.revision,
    stage: window.verificationData?.stage,
  }));
  await processing.getByRole("button", { name: "Review Requirements", exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.verificationCalls ?? []), initialState.calls);
  assert.equal(await page.evaluate(() => window.verificationData?.revision), initialState.revision);
  assert.equal(await page.evaluate(() => window.verificationData?.stage), initialState.stage);

  const verify = processing.getByRole("button", { name: "Verify & Send to CRECOM", exact: true });
  assert.equal(await verify.isDisabled(), true);
  for (const label of [
    "Member identity and application details checked",
    "Membership eligibility and affordability checked",
    "Loan amount, term and payment projection checked",
  ]) await processing.getByLabel(label).check();
  assert.equal(await verify.isDisabled(), true, "missing consent and policy blockers must still prevent verification");

  await processing.getByRole("button", { name: "View borrower consent", exact: true }).click();
  const evidence = page.getByRole("dialog", { name: "Recorded consent evidence", exact: true });
  await evidence.getByText("No saved evidence was found for this application.", { exact: false }).waitFor();
  assert.equal(await evidence.getByRole("checkbox").count(), 0);
  await evidence.getByRole("button", { name: "Close", exact: true }).click();
  await page.screenshot({ path: resolve(directory, "requirements-review.png"), fullPage: true });
  await processing.getByRole("button", { name: "Close", exact: true }).click();
  await page.close();

  const successfulPage = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  successfulPage.on("pageerror", (error) => errors.push(error.message));
  await successfulPage.addInitScript(() => { window.verificationScenario = "verification-ready"; });
  await successfulPage.goto(`${url}/?workflow=loans`);
  await successfulPage.getByRole("button", { name: "Open actions for APP-TEST", exact: true }).click();
  await successfulPage.getByRole("menuitem", { name: "Process Application", exact: true }).click();
  const successfulProcessing = successfulPage.getByRole("dialog", { name: "Process Application", exact: true });
  await successfulProcessing.getByRole("navigation", { name: "Application processing steps" }).waitFor();
  await successfulProcessing.getByRole("button", { name: "Review Requirements", exact: true }).click();
  for (const label of [
    "Member identity and application details checked",
    "Membership eligibility and affordability checked",
    "Loan amount, term and payment projection checked",
  ]) await successfulProcessing.getByLabel(label).check();
  await successfulProcessing.getByText("Accepted", { exact: true }).waitFor();
  await successfulProcessing.getByText("Approved", { exact: true }).waitFor();
  await successfulProcessing.getByText("Names Recorded", { exact: true }).waitFor();

  const send = successfulProcessing.getByRole("button", { name: "Verify & Send to CRECOM", exact: true });
  assert.equal(await send.isDisabled(), false, "complete approved-policy requirements and recorded evidence must enable verification");
  await send.click();
  const confirmation = successfulPage.getByRole("dialog", { name: "Verify requirements and send to CRECOM?", exact: true });
  await confirmation.getByRole("button", { name: "Continue", exact: true }).click();
  const identityConfirmation = successfulPage.getByRole("dialog", { name: "Confirm your identity", exact: true });
  await identityConfirmation.getByRole("textbox", { name: "Your account password" }).fill("synthetic-staff-password");
  await identityConfirmation.getByRole("button", { name: "Confirm & Send", exact: true }).click();
  const result = successfulPage.getByRole("dialog", { name: "Action completed", exact: true });
  await result.getByText("Requirements verified. Application APP-TEST has been sent for CRECOM review.", { exact: true }).waitFor();
  const committed = await successfulPage.evaluate(() => ({
    calls: window.verificationCalls ?? [],
    stage: window.verificationData?.stage,
    checks: window.verificationData?.checks,
    cycles: window.reviewAdmin?.cycles ?? [],
  }));
  assert.equal(committed.calls.length, 1, "verification should be committed exactly once");
  assert.equal(committed.calls[0].operation, "verify_and_forward");
  assert.equal(committed.calls[0].password, "synthetic-staff-password");
  assert.deepEqual(committed.calls[0].payload.checks, { identity: true, eligibility: true, terms: true });
  assert.deepEqual(committed.checks, { identity: true, eligibility: true, terms: true });
  assert.equal(committed.stage, "ready_for_committee");
  assert.equal(committed.cycles.length, 1, "successful verification must route into one active CRECOM cycle");
  assert.equal(committed.cycles[0].stage, "CRECOM");
  assert.equal(committed.cycles[0].status, "open");
  assert.equal(committed.cycles[0].reviewerTarget, 3);
  assert.deepEqual(committed.cycles[0].assignments.map(assignment => assignment.signatoryRole), [
    "crecom_member", "crecom_member", "crecom_chairperson",
  ]);
  assert.deepEqual(errors, []);
  await successfulPage.close();

  for (const role of ["admin", "super_admin"]) {
    const policy = await browser.newPage({ viewport: { width: role === "admin" ? 390 : 1366, height: 900 } });
    policy.on("pageerror", (error) => errors.push(error.message));
    await policy.addInitScript((currentRole) => { window.testRole = currentRole; }, role);
    await policy.goto(`${url}/?workflow=policy`);
    await policy.getByRole("button", { name: "Approval Workflow", exact: true }).click();
    await policy.getByRole("heading", { name: "Approval workflow policy", exact: true }).waitFor();
    if (role === "admin") {
      assert.equal(await policy.getByLabel("Policy draft name", { exact: true }).isDisabled(), true);
      assert.equal(await policy.getByRole("button", { name: "Save policy draft", exact: true }).count(), 0);
    } else {
      await policy.getByLabel("Policy draft name", { exact: true }).fill("CSUCC committee workflow draft");
      await policy.getByLabel("CRECOM reviewers per application", { exact: true }).fill("3");
      await policy.getByLabel("CRECOM authority", { exact: true }).selectOption("recommendation");
      await policy.getByRole("button", { name: "Save policy draft", exact: true }).click();
      await policy.getByRole("button", { name: "Save draft version", exact: true }).click();
      await policy.getByText("A new policy draft version was saved. Existing application policies were not changed.", { exact: true }).waitFor();
      assert.equal(await policy.evaluate(() => window.verificationPolicies[0].status), "draft");
    }
    await policy.screenshot({ path: resolve(directory, `policy-${role}.png`), fullPage: true });
    assert.equal(await policy.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await policy.close();
  }

  assert.deepEqual(errors, []);
  console.log("PASS: read-only and incomplete-evidence checks, successful requirements verification and CRECOM routing, protected action visibility, and role-gated policy editing.");
}
