import type { LoanApplication } from "@/lib/api";
import type { Member } from "@/components/members/MembersData";

export type ReportingPeriod = "this-month" | "last-month" | "this-year";

export interface DashboardLoan {
  id: string;
  member: string;
  memberId: string;
  type: string;
  amount: number;
  status: LoanApplication["status"];
  submittedAt: string;
  approvedAt: string | null;
  releasedAt: string | null;
  createdAt: string;
}

export interface ReportRange {
  start: string;
  end: string;
  label: string;
  period: ReportingPeriod;
}

export interface ApplicationTrend {
  month: string;
  label: string;
  submitted: number;
  approved: number | null;
}

const approvedStatuses = new Set<DashboardLoan["status"]>([
  "Approved", "Released", "Completed", "Overdue",
]);
const releasedStatuses = new Set<DashboardLoan["status"]>([
  "Released", "Completed", "Overdue",
]);
const monthKey = (year: number, month: number) =>
  `${year}-${String(month).padStart(2, "0")}`;

export function getReportRange(period: ReportingPeriod, now = new Date()): ReportRange {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila", year: "numeric", month: "numeric",
  }).formatToParts(now);
  let year = Number(parts.find((part) => part.type === "year")?.value);
  let month = Number(parts.find((part) => part.type === "month")?.value);
  if (period === "last-month") {
    month -= 1;
    if (month === 0) { month = 12; year -= 1; }
  }
  const startMonth = period === "this-year" ? 1 : month;
  const end = month === 12 ? `${year + 1}-01-01` : `${monthKey(year, month + 1)}-01`;
  const label = period === "this-year"
    ? `${year} year to date`
    : new Intl.DateTimeFormat("en-PH", {
        month: "long", year: "numeric", timeZone: "UTC",
      }).format(new Date(`${monthKey(year, month)}-01T00:00:00Z`));
  return { start: `${monthKey(year, startMonth)}-01`, end, label, period };
}

export function formatPeso(amount: number): string {
  return new Intl.NumberFormat("en-PH", {
    style: "currency", currency: "PHP", minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(amount);
}

export function formatSubmissionDate(value: string): string {
  return new Intl.DateTimeFormat("en-PH", {
    month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));
}

export function countActiveMembers(accounts: Member[]): number {
  return new Set(accounts.filter((account) =>
    account.role === "Member" && account.status === "Active" &&
    account.profileLinked === true && account.authUserId,
  ).map((account) => account.authUserId)).size;
}

export function summarizeLoans(loans: DashboardLoan[], range: ReportRange) {
  const uniqueLoans = [...new Map(loans.map((loan) => [loan.id, loan])).values()];
  const inRange = (date: string) => date >= range.start && date < range.end;
  const approvalDatesMissing = uniqueLoans.some((loan) =>
    approvedStatuses.has(loan.status) && !loan.approvedAt,
  );
  const releaseDatesMissing = uniqueLoans.some((loan) =>
    releasedStatuses.has(loan.status) && !loan.releasedAt,
  );
  const trends: ApplicationTrend[] = [];
  const cursor = new Date(`${range.start}T00:00:00Z`);
  while (cursor.toISOString().slice(0, 10) < range.end) {
    trends.push({
      month: cursor.toISOString().slice(0, 7),
      label: cursor.toLocaleDateString("en-PH", { month: "short", timeZone: "UTC" }),
      submitted: 0,
      approved: approvalDatesMissing ? null : 0,
    });
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  const buckets = new Map(trends.map((trend) => [trend.month, trend]));
  let disbursementCents = 0;
  for (const loan of uniqueLoans) {
    const submitted = buckets.get(loan.submittedAt.slice(0, 7));
    if (submitted && inRange(loan.submittedAt)) submitted.submitted += 1;
    if (loan.approvedAt && inRange(loan.approvedAt)) {
      const approved = buckets.get(loan.approvedAt.slice(0, 7));
      if (approved && approved.approved !== null) approved.approved += 1;
    }
    // The existing release workflow records one full principal release per application.
    if (releasedStatuses.has(loan.status) && loan.releasedAt && inRange(loan.releasedAt)) {
      disbursementCents += Math.round(loan.amount * 100);
    }
  }
  return {
    pending: uniqueLoans.filter((loan) => loan.status === "Pending").length,
    disbursement: releaseDatesMissing || !Number.isSafeInteger(disbursementCents)
      ? null : disbursementCents / 100,
    approvalDatesMissing,
    releaseDatesMissing,
    trends,
    hasTrends: trends.some((trend) => trend.submitted > 0 || (trend.approved ?? 0) > 0),
    recent: [...uniqueLoans].sort((first, second) =>
      second.submittedAt.localeCompare(first.submittedAt) ||
      Date.parse(second.createdAt) - Date.parse(first.createdAt) ||
      second.id.localeCompare(first.id),
    ).slice(0, 5),
  };
}
