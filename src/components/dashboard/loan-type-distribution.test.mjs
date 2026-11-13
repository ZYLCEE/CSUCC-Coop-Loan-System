import test from "node:test";
import assert from "node:assert/strict";
import { getLoanTypeDistribution } from "./loan-type-distribution.ts";

test("distribution follows existing active statuses, counts loans instead of amounts, and deduplicates IDs", () => {
  const loan = (id, type, status, amount = 1000) => ({ id, type, status, amount });
  const result = getLoanTypeDistribution([
    loan("1", "Regular", "Released", 100000), loan("1", "Regular", "Released", 100000),
    loan("2", "Medical", "Overdue", 1), loan("3", "Regular", "Approved", 1),
    loan("4", "Medical", "Completed"), loan("5", "Medical", "Pending"),
    loan("6", "Medical", "Under Review"), loan("7", "Medical", "Rejected"),
  ]);
  assert.equal(result.total, 3);
  assert.equal(result.unavailable, false);
  assert.equal(result.types.find((item) => item.name === "Regular").count, 2);
  assert.equal(result.types.find((item) => item.name === "Regular").percentage, 2 / 3 * 100);
  assert.equal(result.types.find((item) => item.name === "Medical").count, 1);
});

test("categories come from the records and keep their colors when order or other categories change", () => {
  const loans = [
    { id: "a", type: "Custom Loan", status: "Released" },
    { id: "b", type: "Another Loan", status: "Overdue" },
  ];
  const first = getLoanTypeDistribution(loans);
  const second = getLoanTypeDistribution([...loans].reverse());
  assert.deepEqual(first, second);
  assert.equal(first.types.find((item) => item.name === "Custom Loan").color,
    getLoanTypeDistribution([loans[0]]).types[0].color);
  assert.equal(first.types.reduce((sum, item) => sum + item.percentage, 0), 100);
});

test("the selected reporting period counts submitted applications across statuses", () => {
  const result = getLoanTypeDistribution([
    { id: "in-period-1", type: "Regular Loan", status: "Released", submittedAt: "2026-10-01" },
    { id: "in-period-2", type: "Medical Loan", status: "Rejected", submittedAt: "2026-10-31" },
    { id: "out-of-period", type: "Regular Loan", status: "Pending", submittedAt: "2026-11-01" },
  ], { start: "2026-10-01", end: "2026-11-01" }, ["Regular Loan", "Medical Loan"]);

  assert.equal(result.total, 2);
  assert.equal(result.types.find((item) => item.name === "Regular Loan").count, 1);
  assert.equal(result.types.find((item) => item.name === "Medical Loan").count, 1);
});

test("empty and missing-type data are distinguished without inventing categories or percentages", () => {
  assert.deepEqual(getLoanTypeDistribution([]), { total: 0, types: [], unavailable: false });
  assert.deepEqual(getLoanTypeDistribution([{ id: "a", type: " ", status: "Released" }]),
    { total: 1, types: [], unavailable: true });
});
