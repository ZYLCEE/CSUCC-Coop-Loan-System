import BarChartCard from "@/components/dashboard/BarChartCard";
import DonutChartCard from "@/components/dashboard/DonutChartCard";
import type { ApplicationTrend } from "./dashboard-model";
import type { LoanTypeDistribution } from "./loan-type-distribution";

interface ChartsSectionProps {
  data?: ApplicationTrend[];
  loanTypes?: LoanTypeDistribution;
  loading?: boolean;
  error?: string | null;
  periodLabel?: string;
  approvalDatesMissing?: boolean;
  onRetry?: () => void;
}

export default function ChartsSection({ loanTypes, ...props }: ChartsSectionProps) {
  return (
    <div role="group" aria-label="Dashboard charts" className="grid min-w-0 grid-cols-1 items-stretch gap-4 min-[75rem]:grid-cols-[minmax(0,13fr)_minmax(0,7fr)]">
      <BarChartCard {...props} />
      <DonutChartCard distribution={loanTypes} loading={props.loading} error={props.error} onRetry={props.onRetry} />
    </div>
  );
}
