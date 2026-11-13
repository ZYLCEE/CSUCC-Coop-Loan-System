import { Clock, TrendingUp, Users, Wallet } from "lucide-react";
import StatCard from "./StatCard";
import { formatPeso, type ReportingPeriod } from "./dashboard-model";

interface DashboardMetricsProps {
  pending: number | null;
  activeMembers: number | null;
  disbursement: number | null;
  collections: number | null;
  period: ReportingPeriod;
  financialsLoading: boolean;
  membersLoading: boolean;
  financialsError: string | null;
  membersError: string | null;
  retryFinancials: () => void;
  retryMembers: () => void;
}

export default function DashboardMetrics(props: DashboardMetricsProps) {
  const yearly = props.period === "this-year";
  const when = props.period === "last-month" ? "last month" : yearly ? "this year" : "this month";
  return (
    <section aria-label="Portfolio statistics" className="grid grid-cols-1 gap-4 md:grid-cols-2 min-[75rem]:grid-cols-4">
      <StatCard icon={Clock} iconBgColor="var(--status-warning-surface)" iconColor="var(--status-warning)"
        label="Pending Applications" value={props.pending?.toLocaleString("en-PH") ?? "—"}
        subtitle="Awaiting initial staff review" loading={props.financialsLoading}
        unavailable={props.financialsError ? "Application count unavailable" : undefined}
        onRetry={props.financialsError ? props.retryFinancials : undefined} />
      <StatCard icon={Users} iconBgColor="var(--status-info-surface)" iconColor="var(--status-info)"
        label="Active Members" value={props.activeMembers?.toLocaleString("en-PH") ?? "—"}
        subtitle="Registered active members" loading={props.membersLoading}
        unavailable={props.membersError ? "Member count unavailable" : undefined}
        onRetry={props.membersError ? props.retryMembers : undefined} />
      <StatCard icon={TrendingUp} iconBgColor="var(--status-success-surface)" iconColor="var(--status-success)"
        label={yearly ? "Year-to-Date Collections" : "Monthly Collections"}
        value={props.collections === null ? "—" : formatPeso(props.collections)}
        subtitle={`Payments collected ${when}`}
        loading={props.financialsLoading}
        unavailable={props.financialsError ? "Confirmed collections unavailable" : undefined}
        onRetry={props.financialsError ? props.retryFinancials : undefined} />
      <StatCard icon={Wallet} iconBgColor="var(--status-neutral-surface)" iconColor="var(--coop-primary)"
        label={yearly ? "Year-to-Date Net Disbursements" : "Monthly Net Disbursements"}
        value={props.disbursement === null ? "—" : formatPeso(props.disbursement)}
        subtitle={`Loans released ${when}`} loading={props.financialsLoading}
        unavailable={!props.financialsLoading && props.disbursement === null ? "Verified release totals unavailable" : undefined}
        onRetry={props.financialsError ? props.retryFinancials : undefined} />
    </section>
  );
}
