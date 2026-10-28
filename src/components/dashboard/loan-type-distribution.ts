import type { DashboardLoan } from "./dashboard-model";

export interface LoanTypeSlice {
  name: string;
  count: number;
  percentage: number;
  color: string;
}

export interface LoanTypeDistribution {
  total: number;
  types: LoanTypeSlice[];
  unavailable: boolean;
}

// Match check_loan_eligibility's existing definition of active loans.
const activeStatuses = new Set<DashboardLoan["status"]>(["Approved", "Released", "Overdue"]);
const colors = ["#5B7C99", "#D5A21B", "#0F8B8D", "#7C6A9B", "#145B3C", "#C47439"];

function categoryColor(name: string): string {
  let hash = 0;
  for (const character of name.toLowerCase()) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  return colors[hash % colors.length];
}

export function getLoanTypeDistribution(
  loans: Pick<DashboardLoan, "id" | "type" | "status">[],
): LoanTypeDistribution {
  const active = [...new Map(loans.map((loan) => [loan.id, loan])).values()]
    .filter((loan) => activeStatuses.has(loan.status));
  if (active.some((loan) => !loan.type.trim())) {
    return { total: active.length, types: [], unavailable: true };
  }
  const counts = new Map<string, number>();
  for (const loan of active) {
    const name = loan.type.trim();
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return {
    total: active.length,
    unavailable: false,
    types: [...counts].sort(([first], [second]) => first.localeCompare(second)).map(([name, count]) => ({
      name, count, percentage: count / active.length * 100, color: categoryColor(name),
    })),
  };
}
