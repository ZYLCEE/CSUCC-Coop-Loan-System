import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

// Invoked only by the isolated test harness. No authentication or production URLs.
export async function captureModalPreviews({ browser, url, phase }) {
  assert.ok(["before", "after"].includes(phase));
  const directory = resolve("docs/modal-qa-previews", phase);
  mkdirSync(directory, { recursive: true });
  const metrics = [];
  const requestedScenarios = process.env.COOP_MODAL_PREVIEW_SCENARIOS?.split(",");
  const scenarios = [
    ["account-view", "View account"], ["account-create", "Create account"], ["account-edit", "Edit account"],
    ["password-form", "Reset password"], ["loan-details", "Loan details"], ["documents", "Application documents"],
    ["announcement-form", "Announcement editor"], ["warning", "Warning confirmation"], ["destructive", "Destructive confirmation"],
    ["error-result", "Error result"], ["approval-security", "Loan approval"], ["approval-review", "Loan approval"],
    ["success-result", "Loan approval"], ["release-form", "Loan release"], ["release-review", "Loan release"],
    ["release-error", "Loan release"], ["payment-form", "Counter payment"], ["payment-review", "Counter payment"],
    ["payment-reversal", "Repayment details"], ["loading", "Loan release"], ["unsaved", "Edit account"],
  ].filter(([name]) => !requestedScenarios || requestedScenarios.includes(name));
  for (const viewport of [{ width: 1366, height: 768 }, { width: 390, height: 844 }]) {
    const context = await browser.newContext({ viewport, locale: "en-PH", timezoneId: "Asia/Manila", serviceWorkers: "block" });
    const blockedRequests = [];
    await context.route("**/*", route => {
      const requestUrl = new URL(route.request().url());
      if (requestUrl.origin === new URL(url).origin && ["/", "/bundle.js"].includes(requestUrl.pathname)) return route.continue();
      blockedRequests.push(requestUrl.origin); return route.abort();
    });
    for (const [name, trigger] of scenarios) {
      const page = await context.newPage();
      const errors = []; page.on("pageerror", error => errors.push(error.message));
      await page.addInitScript(({ loading, failure }) => {
        window.previewLoading = loading; window.financialFailure = failure;
      }, { loading: name === "loading", failure: name === "release-error" });
      await page.goto(`${url}/?preview`);
      await page.getByRole("button", { name: trigger, exact: true }).click();
      if (["account-create"].includes(name)) await page.getByLabel("ID Number (Auto-generated)").waitFor();
      if (name.startsWith("approval-") && name !== "approval-security" || name === "success-result") {
        await page.locator('input[autocomplete="current-password"]').fill("synthetic-test-password");
        await page.getByRole("button", { name: "Verify password", exact: true }).click();
        await page.getByRole("heading", { name: "Approve Loan Application", exact: true }).waitFor();
        if (name === "success-result") {
          await page.getByRole("button", { name: "Approve Loan", exact: true }).click();
          await page.getByRole("heading", { name: "Success", exact: true }).waitFor();
        }
      }
      if (["release-form", "release-review", "release-error"].includes(name)) {
        await page.getByLabel("Disbursement reference / voucher number").waitFor();
        if (name !== "release-form") {
          await page.getByLabel("Disbursement reference / voucher number").fill("DV-SYNTHETIC-001");
          await page.getByRole("checkbox").check();
          await page.getByRole("button", { name: "Review release", exact: true }).click();
          await page.getByRole("heading", { name: "Review release details", exact: true }).waitFor();
          if (name === "release-error") {
            await page.getByRole("button", { name: "Confirm release", exact: true }).click();
            await page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Review release details" }) }).getByRole("alert").waitFor();
            if (phase === "after") {
              const active = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Review release details" }) });
              const errorBox = await active.getByRole("alert").boundingBox();
              const footerBox = await active.locator(".ui-dialog-footer").boundingBox();
              assert.ok(errorBox.y >= 0 && errorBox.y + errorBox.height <= footerBox.y, "backend error visible above review summary and footer");
            }
          }
        }
      }
      if (name.startsWith("payment-")) {
        if(name !== "payment-reversal") await page.getByLabel("Official receipt number").waitFor();
        if (name === "payment-review") {
          await page.getByLabel("Official receipt number").fill("OR-SYNTHETIC-001");
          await page.getByLabel("Amount paid").fill("100.00");
          await page.getByRole("button", { name: "Review payment", exact: true }).click();
          await page.getByRole("heading", { name: "Review payment allocation", exact: true }).waitFor();
        } else if (name === "payment-reversal") {
          await page.getByRole("button", { name: "Reverse payment", exact: true }).click();
          await page.getByLabel("Reason", { exact: true }).fill("Synthetic duplicate receipt for visual review only.");
        }
      }
      if (name === "loan-details") await page.getByRole("heading", { name: "Loan Application Information", exact: true }).waitFor();
      if (name === "documents") await page.getByText("Synthetic supporting document.pdf", { exact: true }).waitFor();
      if (name === "unsaved") {
        await page.getByLabel("Full Name", { exact: false }).fill("Maria Dela Cruz Updated");
        await page.keyboard.press("Escape");
        await page.getByRole("heading", { name: "Discard unsaved changes?" }).waitFor();
      }
      await page.getByRole("dialog").last().waitFor();
      await page.screenshot({ path: resolve(directory, `${name}-${viewport.width}.png`) });
      const measurement = await page.locator('[role="dialog"]').evaluateAll(dialogs => dialogs.filter(dialog => !dialog.closest("[inert]")).map(dialog => {
        const rect = dialog.getBoundingClientRect();
        const header = dialog.querySelector(".ui-dialog-header"); const footer = dialog.querySelector(".ui-dialog-footer"); const body = dialog.querySelector(".ui-dialog-body");
        const style = getComputedStyle(dialog);
        return { name: dialog.getAttribute("aria-labelledby"), width: rect.width, height: rect.height, x: rect.x, y: rect.y,
          radius: style.borderRadius, headerPadding: header ? getComputedStyle(header).padding : null,
          bodyPadding: body ? getComputedStyle(body).padding : null, footerPadding: footer ? getComputedStyle(footer).padding : null,
          scrollable: body ? body.scrollHeight > body.clientHeight : false,
          footerVisible: footer ? footer.getBoundingClientRect().bottom <= innerHeight : null,
          horizontalOverflow: dialog.scrollWidth > dialog.clientWidth,
          buttons: Array.from(dialog.querySelectorAll('.ui-dialog-footer button')).map(button => ({ text: button.textContent, height: button.getBoundingClientRect().height })),
        };
      }));
      assert.equal(errors.length, 0, `${name}: ${errors.join(", ")}`);
      assert.equal(measurement.length, 1, `${name}: one active dialog`);
      assert.ok(measurement[0].x >= 0 && measurement[0].y >= 0 && measurement[0].height <= viewport.height && measurement[0].width <= viewport.width, `${name}: bounded viewport`);
      if (phase === "after") {
        assert.equal(measurement[0].horizontalOverflow, false, `${name}: no panel horizontal overflow`);
        if (measurement[0].footerVisible !== null) assert.equal(measurement[0].footerVisible, true, `${name}: visible footer`);
      }
      metrics.push({ scenario: name, viewport, ...measurement[0] });
      await page.close();
    }
    assert.equal(blockedRequests.length, 0, "no unexpected external requests attempted");
    console.log(`${phase}: ${viewport.width}px previews completed`);
    await context.close();
  }
  const metricsPath = resolve(directory, "metrics.json");
  const previousMetrics = requestedScenarios && existsSync(metricsPath) ? JSON.parse(readFileSync(metricsPath, "utf8")).filter(item => !requestedScenarios.includes(item.scenario)) : [];
  writeFileSync(metricsPath, JSON.stringify([...previousMetrics, ...metrics], null, 2));
  console.log(`${phase}: captured ${metrics.length} isolated component previews; external requests blocked.`);
}
