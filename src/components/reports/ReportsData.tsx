export interface ChartData {
  month: string;
  value: number;
}

export interface MonthlyData {
  applications: string;
  approved: string;
  released: string;
  collections: string;
}

export const chartData: ChartData[] = [];
export const monthlyData: Record<string, MonthlyData> = {};
export const summaryMetrics = [
  { value: "—", label: "Total Applications" },
  { value: "—", label: "Total Approved" },
  { value: "—", label: "Total Released" },
  { value: "—", label: "Total Collections" },
];
