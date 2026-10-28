import StatCard from "@/components/dashboard/StatCard";
import { Clock, CheckCircle, XCircle, DollarSign } from "lucide-react";

export default function StatCardsRow1() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
      <StatCard
        icon={Clock}
        iconBgColor=""
        iconColor=""
        label="Pending Applications"
        value="—"
        subtitle="Awaiting review"
        customBgColor="#FFF7E8"
        customIconColor="#F59E0B"
      />
      <StatCard
        icon={CheckCircle}
        iconBgColor=""
        iconColor=""
        label="Approved Today"
        value="—"
        subtitle="No data loaded"
        customBgColor="#EAFBF1"
        customIconColor="#10B981"
      />
      <StatCard
        icon={XCircle}
        iconBgColor=""
        iconColor=""
        label="Rejected Today"
        value="—"
        subtitle="No data loaded"
        customBgColor="#FDEEEE"
        customIconColor="#EF4444"
      />
      <StatCard
        icon={DollarSign}
        iconBgColor=""
        iconColor=""
        label="Released Loans"
        value="—"
        subtitle="This week"
        customBgColor="#EAFBFB"
        customIconColor="#0891B2"
      />
    </div>
  );
}
