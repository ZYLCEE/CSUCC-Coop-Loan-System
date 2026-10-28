import test from "node:test";
import assert from "node:assert/strict";
import { countActiveMembers, formatPeso, getReportRange, summarizeLoans } from "./dashboard-model.ts";

const now = new Date("2026-10-28T04:00:00Z");
const loan = (id, overrides = {}) => ({
  id, member: "Test member", memberId: "TEST-001", type: "Regular", amount: 1000,
  status: "Pending", submittedAt: "2026-10-02", approvedAt: null, releasedAt: null,
  createdAt: "2026-10-02T04:00:00Z", ...overrides,
});

test("reporting follows Manila month/year boundaries, including last January's December", () => {
  const boundary = new Date("2026-12-31T16:01:00Z");
  assert.equal(getReportRange("this-month", boundary).start, "2027-01-01");
  assert.equal(getReportRange("last-month", boundary).start, "2026-12-01");
  assert.equal(getReportRange("last-month", boundary).end, "2027-01-01");
  assert.equal(getReportRange("this-year", now).start, "2026-01-01");
  assert.equal(getReportRange("this-year", now).end, "2026-11-01");
});

test("submission and approval are separate events, including subsequently released loans", () => {
  const loans = [loan("A", { submittedAt: "2026-09-30", approvedAt: "2026-10-01", status: "Approved" }),
    loan("B", { approvedAt: "2026-10-10", releasedAt: "2026-10-15", status: "Released" })];
  const result = summarizeLoans(loans, getReportRange("this-year", now));
  assert.deepEqual(result.trends.find((point) => point.month === "2026-09"),
    { month: "2026-09", label: "Sep", submitted: 1, approved: 0 });
  assert.deepEqual(result.trends.find((point) => point.month === "2026-10"),
    { month: "2026-10", label: "Oct", submitted: 1, approved: 2 });
});

test("only dated releases count, once per application, using centavo arithmetic", () => {
  const released = loan("A", { status: "Released", amount: 1000.10, approvedAt: "2026-10-01", releasedAt: "2026-10-01" });
  const result = summarizeLoans([released, released,
    loan("B", { status: "Completed", amount: 2000.20, approvedAt: "2026-09-01", releasedAt: "2026-10-31" }),
    loan("C", { status: "Approved", amount: 99999, approvedAt: "2026-10-01" }),
    loan("D", { status: "Released", amount: 99999, approvedAt: "2026-09-01", releasedAt: "2026-11-01" })],
  getReportRange("this-month", now));
  assert.equal(result.disbursement, 3000.30);
});

test("pending and recent records do not change with the reporting period", () => {
  const loans = [loan("A", { submittedAt: "2026-09-01" }), loan("B", { status: "Under Review" }),
    loan("C", { status: "Rejected" }), loan("D", { status: "Approved", approvedAt: "2026-09-20" })];
  const current = summarizeLoans(loans, getReportRange("this-month", now));
  const previous = summarizeLoans(loans, getReportRange("last-month", now));
  assert.equal(current.pending, 1);
  assert.equal(previous.pending, 1);
  assert.deepEqual(current.recent, previous.recent);
});

test("active members exclude administrators, inactive, suspended, unlinked and duplicate accounts", () => {
  const active = { role: "Member", status: "Active", profileLinked: true, authUserId: "member-1" };
  assert.equal(countActiveMembers([active, active,
    { ...active, role: "Super Admin", authUserId: "admin-1" },
    { ...active, role: "Admin", authUserId: "admin-2" },
    { ...active, status: "Inactive", authUserId: "member-2" },
    { ...active, status: "Suspended", authUserId: "member-3" },
    { ...active, status: "Blocked", authUserId: "member-4" },
    { ...active, profileLinked: false, authUserId: "deleted-user" }]), 1);
});

test("missing event dates produce unavailable values rather than false zeros", () => {
  const result = summarizeLoans([loan("A", { status: "Released" })], getReportRange("this-month", now));
  assert.equal(result.disbursement, null);
  assert.equal(result.approvalDatesMissing, true);
  assert.equal(result.trends[0].approved, null);
  assert.equal(result.trends[0].submitted, 1);
});

test("a valid empty report contains zeros and an empty-state chart", () => {
  const result = summarizeLoans([], getReportRange("this-month", now));
  assert.equal(result.pending, 0);
  assert.equal(result.disbursement, 0);
  assert.equal(result.hasTrends, false);
  assert.equal(formatPeso(0), "₱0.00");
  assert.equal(countActiveMembers([]), 0);
});

test("recent applications use raw submission date, creation-time tie break, and a five-row limit", () => {
  const loans = Array.from({ length: 7 }, (_, index) => loan(String(index), {
    submittedAt: `2026-10-${String(index + 1).padStart(2, "0")}`,
  }));
  loans.push(loan("latest", { submittedAt: "2026-10-07", createdAt: "2026-10-07T20:00:00Z" }));
  const result = summarizeLoans(loans.reverse(), getReportRange("this-month", now));
  assert.deepEqual(result.recent.map((record) => record.id), ["latest", "6", "5", "4", "3"]);
});
