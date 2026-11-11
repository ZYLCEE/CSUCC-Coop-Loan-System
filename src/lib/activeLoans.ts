import { normalizeMembershipType } from "./membership";
import { getLoanTypeLabel } from "./loanTypeLabel";

export const activeLoanStatuses = ["Released", "Overdue", "Paid", "Fully Paid"] as const;
export type ActiveLoanStatus = typeof activeLoanStatuses[number];
export type ActiveLoanStatusFilter = "All Status" | ActiveLoanStatus;

export interface RepaymentProgress {
  monthsPaid: number | null;
  totalMonths: number | null;
  principalPaid: number | null;
  principalRemaining: number | null;
  partialMonthAmount: number | null;
  reconciliationRequired: boolean;
  settlementPending: boolean;
}

export interface ActiveLoan {
  id: string;
  applicationId: string;
  memberId: string;
  member: string;
  membershipType: "regular" | "associate" | null;
  type: string;
  principal: number;
  monthlyPayment: number | null;
  status: ActiveLoanStatus;
  recordedStatus: string;
  date: string;
  progress: RepaymentProgress;
}

export interface LoanPaymentSummary {
  payment_status: unknown;
  payment_amount: unknown;
  principal_amount: unknown;
}

function centavos(value: unknown): number | null {
  if ((typeof value !== "number" && typeof value !== "string") || (typeof value === "string" && !value.trim())) return null;
  const amount = Number(value);
  const cents = Math.round(amount * 100);
  return Number.isFinite(amount) && amount >= 0 && Number.isSafeInteger(cents)
    && Math.abs(amount * 100 - cents) < 0.001 ? cents : null;
}

export function toActiveLoan(row: Record<string, unknown>, payments: LoanPaymentSummary[]): ActiveLoan {
  const principal = centavos(row.amount);
  if (typeof row.id !== "string" || typeof row.application_id !== "string" || principal === null || principal <= 0) {
    throw new Error("A loan record has invalid principal or identification details.");
  }
  const recordedStatus = String(row.status).trim().toLowerCase().replaceAll("_", " ");
  const completed = ["completed", "fully paid"].includes(recordedStatus);
  const posted = payments.filter(payment => payment.payment_status === "posted");
  const hasPayments = posted.some(payment => (centavos(payment.payment_amount) ?? 0) > 0);
  const term = Number(row.tenure_months);
  const totalMonths = Number.isInteger(term) && term >= 1 && term <= 600 ? term : null;
  const allocations = posted.map(payment => centavos(payment.principal_amount));
  const paid = allocations.reduce<number>((sum, amount) => sum + (amount ?? 0), 0);
  const reconciliationRequired = allocations.some(amount => amount === null) || !Number.isSafeInteger(paid) || paid > principal
    || (completed && posted.length > 0 && paid < principal);
  const knownPrincipal = !reconciliationRequired && !(completed && !posted.length);
  let monthsPaid: number | null = null;
  let partialMonthAmount: number | null = null;
  if (knownPrincipal && totalMonths !== null && Number.isSafeInteger(principal * totalMonths)) {
    monthsPaid = 0;
    // Match the cumulative, centavo-rounded principal schedule used by counter-payment SQL.
    // Receipt counts and interest/penalty/fee amounts never count as paid months.
    while (monthsPaid < totalMonths && paid >= Math.round(principal * (monthsPaid + 1) / totalMonths)) monthsPaid++;
    const covered = Math.round(principal * monthsPaid / totalMonths);
    partialMonthAmount = monthsPaid < totalMonths ? Math.max(0, paid - covered) / 100 : 0;
  }
  const related = Array.isArray(row.members) ? row.members[0] : row.members;
  const member = related && typeof related === "object" ? related as Record<string, unknown> : {};
  const monthlyPayment = centavos(row.monthly_payment);
  return {
    id: row.id,
    applicationId: row.application_id,
    memberId: typeof member.member_id === "string" ? member.member_id : "",
    member: typeof row.member_name === "string" ? row.member_name : "Member not recorded",
    membershipType: normalizeMembershipType(member.membership_type),
    type: typeof row.loan_type === "string" ? row.loan_type : "Not recorded",
    principal: principal / 100,
    monthlyPayment: monthlyPayment === null ? null : monthlyPayment / 100,
    // Fully Paid follows the recorded completion state. Principal alone is not final settlement.
    status: completed ? "Fully Paid" : recordedStatus === "overdue" ? "Overdue" : hasPayments ? "Paid" : "Released",
    recordedStatus,
    date: typeof row.date_submitted === "string" ? row.date_submitted : "",
    progress: {
      monthsPaid, totalMonths,
      principalPaid: knownPrincipal ? paid / 100 : null,
      principalRemaining: knownPrincipal ? (principal - paid) / 100 : null,
      partialMonthAmount,
      reconciliationRequired,
      settlementPending: !completed && knownPrincipal && paid === principal,
    },
  };
}

export function repaymentProgressLabel(progress: RepaymentProgress): string {
  if (progress.reconciliationRequired) return "Needs reconciliation";
  if (progress.totalMonths === null) return "Repayment term not recorded";
  if (progress.monthsPaid === null) return "Payment allocation unavailable";
  return `${progress.monthsPaid} of ${progress.totalMonths} months paid`;
}

export function filterActiveLoans(loans: ActiveLoan[], filters: {
  search: string; status: ActiveLoanStatusFilter; loanType: string; membershipType: string;
}): ActiveLoan[] {
  const search = filters.search.trim().replace(/^CSUCC-/i, "").toLowerCase();
  return loans.filter(loan => {
    const searchable = [loan.applicationId, loan.memberId, loan.member, getLoanTypeLabel(loan.type)].join(" ").toLowerCase();
    return searchable.includes(search)
      && (filters.status === "All Status" || loan.status === filters.status)
      && (filters.loanType === "All Loan Types" || loan.type === filters.loanType)
      && (filters.membershipType === "All Members" || loan.membershipType === (filters.membershipType === "Regular Member" ? "regular" : "associate"));
  });
}
