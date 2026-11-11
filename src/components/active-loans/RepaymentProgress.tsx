import { repaymentProgressLabel, type RepaymentProgress as Progress } from "@/lib/activeLoans";
import { pesos } from "@/lib/counterPayments";

export default function RepaymentProgress({ progress, loanLabel, overdue = false }: {
  progress: Progress; loanLabel: string; overdue?: boolean;
}) {
  const label = repaymentProgressLabel(progress);
  const { monthsPaid, totalMonths, partialMonthAmount } = progress;
  const known = monthsPaid !== null && totalMonths !== null;
  return <div className="min-w-[180px] max-w-[230px] space-y-1.5 whitespace-normal">
    <p className={`text-support font-medium ${progress.reconciliationRequired ? "text-status-warning" : "text-portal-primary"}`}>{label}</p>
    {known && <div role="progressbar" aria-label={`Months paid for ${loanLabel}`} aria-valuemin={0}
      aria-valuemax={totalMonths} aria-valuenow={monthsPaid} aria-valuetext={label}
      className="h-1.5 overflow-hidden rounded-full bg-surface-muted">
      <div className={`h-full rounded-full ${overdue ? "bg-status-danger" : "bg-coop-dashboard-green"}`}
        style={{ width: `${monthsPaid / totalMonths * 100}%` }} />
    </div>}
    {progress.settlementPending ? <p className="text-caption leading-4 text-status-warning">Principal covered; completion review pending</p>
      : partialMonthAmount != null && partialMonthAmount > 0 && monthsPaid !== null
        ? <p className="text-caption leading-4 text-portal-secondary">{pesos(partialMonthAmount)} toward month {monthsPaid + 1}</p>
        : known && <p className="text-caption leading-4 text-portal-secondary">{totalMonths - monthsPaid} {totalMonths - monthsPaid === 1 ? "month" : "months"} remaining</p>}
  </div>;
}
