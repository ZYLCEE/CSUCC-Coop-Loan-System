import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

// Real components with synthetic transport only; never connects to the application or Supabase.
export async function captureLoanDetails({ browser, url, phase }) {
  assert.ok(["before", "after"].includes(phase));
  const directory = resolve("docs/loan-details-qa", phase);
  mkdirSync(directory, { recursive: true });
  const metrics = [];
  for (const viewport of [{ width: 1366, height: 768 }, { width: 768, height: 1024 }, { width: 390, height: 844 }]) {
    const context = await browser.newContext({ viewport, locale: "en-PH", timezoneId: "Asia/Manila" });
    await context.route("**/*", route => {
      const target = new URL(route.request().url());
      return target.origin === new URL(url).origin && ["/", "/bundle.js"].includes(target.pathname) ? route.continue() : route.abort();
    });
    for (const status of ["pending", "under review", "rejected", "approved", "released", "completed", "overdue", ...(phase === "after" ? ["loading", "error", "missing"] : [])]) {
      const page = await context.newPage();
      const errors = []; page.on("pageerror", error => errors.push(error.message));
      await page.addInitScript(({ status }) => {
        window.previewLoading = status === "loading";
        window.loanDetailsFailure = status === "error";
        window.loanDetailsRecord = {
          status: ["loading", "error", "missing"].includes(status) ? "approved" : status,
          member_name: "Maria Dela Cruz — synthetic member",
          members: { member_id: "CSUCC-2026-0001", first_name: "Maria", last_name: "Dela Cruz", membership_type: "regular" },
          loan_type: "Providential Loan", amount: status === "missing" ? null : 60000,
          income: status === "missing" ? null : 35000, tenure_months: 12,
          purpose: "Home repairs and educational expenses for the coming school year. This synthetic application demonstrates how a longer purpose wraps naturally without overlapping nearby information.",
          date_submitted: "2026-10-02", date_approved: status === "approved" ? "2026-10-03" : null,
          date_released: ["released", "completed", "overdue"].includes(status) ? "2026-10-04" : null,
          date_completed: status === "completed" ? "2026-11-01" : null,
          monthly_payment: 5500.8, release_reference: "DV-SYNTHETIC-001", release_request_id: "INTERNAL-DO-NOT-DISPLAY",
          credit_score: 750, processing_fee_amount_at_release: 600, updated_at: "2026-10-02T07:00:00Z",
        };
      }, { status });
      await page.goto(`${url}/?preview`);
      await page.getByRole("button", { name: "Loan details", exact: true }).click();
      const dialog = page.getByRole("dialog").last();
      if (phase === "before") await page.getByRole("heading", { name: "Payment history", exact: true }).waitFor();
      else if (status === "loading") await page.getByText("Loading loan application…", { exact: true }).waitFor();
      else if (status === "error") await dialog.getByRole("alert").waitFor();
      else {
        await dialog.getByRole("heading", { name: "Loan Application Information", exact: true }).or(dialog.getByRole("heading", { name: "Loan Summary", exact: true })).waitFor();
        const preRelease = ["pending", "under review", "rejected", "approved", "missing"].includes(status);
        assert.equal(await dialog.getByRole("button", { name: "Open repayment details", exact: true }).count(), preRelease ? 0 : 1);
        const text = await dialog.innerText();
        for (const hidden of ["INTERNAL-DO-NOT-DISPLAY", "Credit score", "Updated at", "No payments recorded"]) assert.ok(!text.includes(hidden), hidden);
        if (preRelease) for (const hidden of ["DV-SYNTHETIC-001", "Monthly installment", "Release date"]) assert.ok(!text.includes(hidden), hidden);
        if (status === "missing") assert.ok(!text.includes("₱0.00"), "missing values never become zero");
        else { assert.ok(text.includes("₱60,000.00")); assert.ok(text.includes("October")); }
      }
      await page.screenshot({ path: resolve(directory, `${status.replaceAll(" ", "-")}-${viewport.width}.png`) });
      const measure = await dialog.evaluate(el => {
        const box = el.getBoundingClientRect(); const footer = el.querySelector(".ui-dialog-footer").getBoundingClientRect();
        return { width: box.width, height: box.height, horizontalOverflow: el.scrollWidth > el.clientWidth, footerVisible: footer.bottom <= innerHeight, inViewport: box.x >= 0 && box.y >= 0 && box.right <= innerWidth && box.bottom <= innerHeight };
      });
      if (phase === "after") {
        assert.ok(measure.inViewport && measure.footerVisible && !measure.horizontalOverflow, JSON.stringify(measure));
        assert.ok(measure.width <= 900);
        if (!["loading", "error"].includes(status)) {
          const columns = await dialog.locator("dl").first().evaluate(el => getComputedStyle(el).gridTemplateColumns.split(" ").length);
          assert.equal(columns, viewport.width >= 1024 ? 3 : viewport.width >= 640 ? 2 : 1);
          if (viewport.width === 390 && status !== "missing") {
            await dialog.locator("section").last().scrollIntoViewIfNeeded();
            await page.screenshot({ path: resolve(directory, `${status.replaceAll(" ", "-")}-390-end.png`) });
          }
        }
        await page.keyboard.press("Tab");
        assert.equal(await dialog.evaluate(el => el.contains(document.activeElement)), true);
        await page.keyboard.press("Escape");
        await dialog.waitFor({ state: "detached" });
        assert.equal(await page.getByRole("button", { name: "Loan details", exact: true }).evaluate(el => el === document.activeElement), true);
        assert.ok(await page.evaluate(() => (window.rpcCalls ?? []).every(call => call.name === "loan_rejection_details")), "details never invoke financial RPCs");
      }
      assert.deepEqual(errors, []);
      metrics.push({ status, viewport, ...measure }); await page.close();
    }
    await context.close();
  }
  if (phase === "after") {
    for (const role of ["admin", "super_admin"]) {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
      await context.route("**/*", route => new URL(route.request().url()).origin === new URL(url).origin ? route.continue() : route.abort());
      const page = await context.newPage();
      await page.addInitScript(role => {
        window.testRole = role;
        window.loanDetailsFailure = true;
        window.loanDetailsRecord = { status: "released", date_released: "2026-01-03" };
      }, role);
      await page.goto(`${url}/?preview`);
      await page.getByRole("button", { name: "Loan details", exact: true }).click();
      await page.getByRole("alert").waitFor();
      assert.equal(await page.getByRole("button", { name: "Open repayment details", exact: true }).count(), 0);
      await page.evaluate(() => { window.loanDetailsFailure = false; });
      await page.getByRole("button", { name: "Try again", exact: true }).click();
      await page.getByRole("heading", { name: "Loan Summary", exact: true }).waitFor();
      await page.getByRole("button", { name: "Open repayment details", exact: true }).click();
      await page.getByText("OR-SYNTHETIC-001", { exact: true }).waitFor();
      const nested = page.getByRole("dialog").last();
      assert.equal(await nested.getByRole("button", { name: "Record payment", exact: true }).count(), role === "super_admin" ? 1 : 0);
      await page.keyboard.press("Escape");
      assert.equal(await page.getByRole("button", { name: "Open repayment details", exact: true }).evaluate(el => el === document.activeElement), true);
      assert.ok((await page.evaluate(() => window.rpcCalls)).every(call => call.name === "loan_payment_ledger"));
      // Simulate an upstream applicationId prop change while a new request is pending.
      await page.evaluate(() => {
        window.previewLoading = true;
        document.querySelector("[data-qa-switch-loan]").click();
      });
      await page.getByText("Loading loan application…", { exact: true }).waitFor();
      assert.equal(await page.getByText("APP-NEXT", { exact: true }).count(), 1);
      assert.equal(await page.getByRole("button", { name: "Open repayment details", exact: true }).count(), 0);
      assert.equal(await page.getByText("Test member", { exact: true }).count(), 0);
      await context.close();
    }
  }
  writeFileSync(resolve(directory, "metrics.json"), JSON.stringify(metrics, null, 2));
  console.log(`Loan details ${phase}: ${metrics.length} synthetic viewport/state checks complete.`);
}
