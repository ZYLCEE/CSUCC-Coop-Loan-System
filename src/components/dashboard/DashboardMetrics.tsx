import { Clock, TrendingUp, Users, Wallet } from "lucide-react";
import StatCard from "./StatCard";
import { formatPeso, type ReportingPeriod } from "./dashboard-model";

interface DashboardMetricsProps {
  pending: number | null;
  activeMembers: number | null;
  disbursement: number | null;
  period: ReportingPeriod;
  loansLoading: boolean;
  membersLoading: boolean;
  loansError: string | null;
  membersError: string | null;
  retryLoans: () => void;
  retryMembers: () => void;
}

export default function DashboardMetrics(props: DashboardMetricsProps) {
  const yearly = props.period === "this-year";
  const when = props.period === "last-month" ? "last month" : yearly ? "this year" : "this month";
  return (
    <section aria-label="Portfolio statistics" className="grid grid-cols-1 gap-4 md:grid-cols-2 min-[75rem]:grid-cols-4">
      <StatCard icon={Clock} iconBgColor="#FFF7ED" iconColor="#D97706"
        label="Pending Applications" value={props.pending?.toLocaleString("en-PH") ?? "—"}
        subtitle="Awaiting review" loading={props.loansLoading}
        unavailable={props.loansError ? "Application count unavailable" : undefined}
        onRetry={props.loansError ? props.retryLoans : undefined} />
      <StatCard icon={Users} iconBgColor="#EFF6FF" iconColor="#2563EB"
        label="Active Members" value={props.activeMembers?.toLocaleString("en-PH") ?? "—"}
        subtitle="Registered active members" loading={props.membersLoading}
        unavailable={props.membersError ? "Member count unavailable" : undefined}
        onRetry={props.membersError ? props.retryMembers : undefined} />
      <StatCard icon={TrendingUp} iconBgColor="#F0FDF4" iconColor="#16A34A"
        label={yearly ? "Year-to-Date Collections" : "Monthly Collections"} value="—"
        subtitle={`Payments collected ${when}`}
        unavailable="Confirmed collections unavailable" />
      <StatCard icon={Wallet} iconBgColor="#FAF5FF" iconColor="#9333EA"
        label={yearly ? "Year-to-Date Disbursement" : "Monthly Disbursement"}
        value={props.disbursement === null ? "—" : formatPeso(props.disbursement)}
        subtitle={`Loans released ${when}`} loading={props.loansLoading}
        unavailable={!props.loansLoading && props.disbursement === null ? "Verified release totals unavailable" : undefined}
        onRetry={props.loansError ? props.retryLoans : undefined} />
    </section>
  );
}
