import assert from "node:assert/strict";

async function openProcess(page, url, role, privileges = []) {
  await page.addInitScript(({ role, privileges }) => {
    window.testRole = role;
    window.testPrivileges = privileges;
  }, { role, privileges });
  await page.goto(`${url}/?preview&loanStatus=Pending`);
  await page.getByRole("button", { name: "Loan application actions", exact: true }).click();
  await page.getByRole("button", { name: "Open actions for APP-TEST", exact: true }).click();
  const menu = page.getByRole("menu");
  const expectedMenu = ["View Details", "Process Application"];
  if (role === "super_admin" || privileges.includes("applications.return")) expectedMenu.push("Return Application");
  assert.deepEqual(
    (await menu.getByRole("menuitem").allTextContents()).map((text) => text.trim()),
    expectedMenu,
  );
  assert.equal(await menu.getByRole("menuitem", { name: "Reject Application", exact: true }).count(), 0);
  await menu.getByRole("menuitem", { name: "Process Application", exact: true }).click();
  const processing = page.getByRole("dialog", { name: "Process Application", exact: true });
  await processing.getByRole("button", { name: "Review Requirements", exact: true }).click();
  return processing;
}

export async function checkLoanRejectionUI({ browser, url }) {
  const superAdmin = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const processing = await openProcess(superAdmin, url, "super_admin");
  const reject = processing.locator(".ui-dialog-footer").getByRole("button", { name: "Reject Application", exact: true });
  await reject.click();
  const rejection = superAdmin.getByRole("dialog").last();
  await rejection.getByRole("heading", { name: "Reject Application", exact: true }).waitFor();
  await rejection.getByLabel("Reason shown to the member", { exact: true }).fill("The application does not meet the recorded requirements.");
  await rejection.getByRole("button", { name: "Continue", exact: true }).click();
  await rejection.getByLabel("Your account password", { exact: true }).fill("Synthetic-Password1!");
  await rejection.getByRole("button", { name: "Confirm Rejection", exact: true }).click();
  await rejection.getByRole("heading", { name: "Application rejected", exact: true }).waitFor();
  await rejection.getByRole("button", { name: "OK", exact: true }).click();
  await superAdmin.waitForFunction(() => window.verificationData?.loanStatus === "rejected");
  const decision = await superAdmin.evaluate(() =>
    window.verificationCalls.find((item) => item.operation === "reject_application"),
  );
  assert.equal(decision.payload.reason, "The application does not meet the recorded requirements.");
  assert.ok(decision.password);
  assert.equal(await superAdmin.evaluate(() =>
    window.verificationCalls.some((item) => item.operation === "forward_bod"),
  ), false);
  await superAdmin.close();

  const admin = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  const adminProcessing = await openProcess(admin, url, "admin", ["applications.verify"]);
  const recommendation = adminProcessing.locator(".ui-dialog-footer").getByRole("button", { name: "Recommend Rejection", exact: true });
  assert.equal(await adminProcessing.locator(".ui-dialog-footer").getByRole("button", { name: "Reject Application", exact: true }).count(), 0);
  await recommendation.click();
  const recommendationDialog = admin.getByRole("dialog").last();
  await recommendationDialog.getByLabel("Rejection recommendation", { exact: true }).fill("The submitted documents do not establish eligibility.");
  await recommendationDialog.getByRole("button", { name: "Continue", exact: true }).click();
  await recommendationDialog.getByLabel("Your account password", { exact: true }).fill("Synthetic-Password1!");
  await recommendationDialog.getByRole("button", { name: "Confirm Recommendation", exact: true }).click();
  await recommendationDialog.getByRole("heading", { name: "Recommendation recorded", exact: true }).waitFor();
  await recommendationDialog.getByRole("button", { name: "OK", exact: true }).click();
  const recommendationCall = await admin.evaluate(() =>
    window.verificationCalls.find((item) => item.operation === "recommend_rejection"),
  );
  assert.equal(recommendationCall.payload.reason, "The submitted documents do not establish eligibility.");
  await admin.waitForFunction(() => window.verificationData?.loanStatus !== "rejected");
  await admin.close();

  console.log("PASS: final rejection is protected and does not require an unreached BOD stage; Admin can only recommend rejection.");
}
