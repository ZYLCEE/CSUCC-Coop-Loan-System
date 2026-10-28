import { getSupabaseClient } from "@/lib/supabase";
import { fetchAdminAccounts } from "@/lib/adminAccounts";
import { countActiveMembers, type DashboardLoan } from "./dashboard-model";

const statuses: Record<string, DashboardLoan["status"]> = {
  pending: "Pending", "under review": "Under Review", approved: "Approved",
  rejected: "Rejected", released: "Released", completed: "Completed", overdue: "Overdue",
};

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Loan records have an unsupported format. Please retry.");
  }
  return value as Record<string, unknown>;
}

function date(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    Number.isNaN(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) {
    throw new Error("A loan record has an invalid date. Reporting is unavailable.");
  }
  return value;
}

function parseLoan(value: unknown): DashboardLoan {
  const row = record(value);
  const status = typeof row.status === "string" ? statuses[row.status.toLowerCase()] : undefined;
  const amount = typeof row.amount === "number" ||
    (typeof row.amount === "string" && /^\d+(\.\d{1,2})?$/.test(row.amount))
    ? Number(row.amount) : NaN;
  if (typeof row.application_id !== "string" || !row.application_id ||
    typeof row.member_name !== "string" || typeof row.loan_type !== "string" ||
    !status || !Number.isFinite(amount) || amount < 0 ||
    !Number.isSafeInteger(Math.round(amount * 100)) ||
    typeof row.created_at !== "string" || Number.isNaN(Date.parse(row.created_at))) {
    throw new Error("Loan records have an unsupported format. Reporting is unavailable.");
  }
  const related = Array.isArray(row.members) ? row.members[0] : row.members;
  const member = related ? record(related) : null;
  const name = member ? [member.first_name, member.last_name]
    .filter((part) => typeof part === "string" && part.trim()).join(" ") : "";
  return {
    id: row.application_id,
    member: name || row.member_name,
    memberId: typeof member?.member_id === "string" ? member.member_id : "",
    type: row.loan_type,
    amount,
    status,
    submittedAt: date(row.date_submitted),
    approvedAt: row.date_approved === null ? null : date(row.date_approved),
    releasedAt: row.date_released === null ? null : date(row.date_released),
    createdAt: row.created_at,
  };
}

// Share this one complete loan snapshot across KPIs, trends and recent applications.
// Paginate so PostgREST's row limit cannot silently undercount the portfolio.
export async function fetchDashboardLoans(): Promise<DashboardLoan[]> {
  const client = getSupabaseClient();
  const loans = new Map<string, DashboardLoan>();
  let expectedCount: number | null = null;
  let offset = 0;
  do {
    const { data, error, count } = await client.from("loan_applications")
      .select("application_id,member_name,loan_type,amount,status,date_submitted,date_approved,date_released,created_at,members(member_id,first_name,last_name)", { count: "exact" })
      .order("date_submitted", { ascending: false })
      .order("created_at", { ascending: false })
      .order("application_id", { ascending: true })
      .range(offset, offset + 499);
    if (error) {
      throw new Error("Unable to load loan records. Check your connection and retry.");
    }
    if (!Array.isArray(data) || count === null) {
      throw new Error("The loan service did not return a complete report. Please retry.");
    }
    if (expectedCount !== null && count !== expectedCount) {
      throw new Error("Loan records changed while loading. Please retry for an updated report.");
    }
    expectedCount = count;
    for (const value of data as unknown[]) {
      const loan = parseLoan(value);
      if (loans.has(loan.id)) {
        throw new Error("Loan records changed while loading. Please retry for an updated report.");
      }
      loans.set(loan.id, loan);
    }
    offset += data.length;
    if (data.length === 0 && offset < expectedCount) {
      throw new Error("Some loan records could not be loaded. Please retry.");
    }
  } while (offset < expectedCount);
  return [...loans.values()];
}

export async function fetchDashboardActiveMembers(): Promise<number> {
  const { accounts } = await fetchAdminAccounts();
  return countActiveMembers(accounts);
}
