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

test("empty and missing-type data are distinguished without inventing categories or percentages", () => {
  assert.deepEqual(getLoanTypeDistribution([]), { total: 0, types: [], unavailable: false });
  assert.deepEqual(getLoanTypeDistribution([{ id: "a", type: " ", status: "Released" }]),
    { total: 1, types: [], unavailable: true });
});
