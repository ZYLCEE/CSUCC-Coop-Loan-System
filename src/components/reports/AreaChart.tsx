"use client";

import {
  Area,
  CartesianGrid,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { TooltipContentProps } from "recharts";

const chartData: { month: string; applications: number; approved: number }[] = [];

function CustomTooltip({
  active,
  payload,
  label,
}: TooltipContentProps) {
  if (!active || !payload?.length) {
    return null;
  }

  return (
    <div className="bg-white rounded-lg shadow-lg p-3 border border-[#E5E7EB]">
      <p className="text-[13px] font-medium text-[#1F2937] mb-2 font-inter">{label}</p>
      {payload.map((entry, index) => (
        <div key={String(entry.dataKey ?? index)} className="flex items-center gap-2 mb-1">
          <div
            className="w-3 h-3 rounded-full"
            style={{ backgroundColor: entry.color ?? "#64748B" }}
          />
          <p className="text-[12px] text-[#6B7280] font-inter">
            {String(entry.dataKey)}: {String(entry.value)}
          </p>
        </div>
      ))}
    </div>
  );
}

export default function AreaChart() {
  return (
    <div className="w-full h-[220px]">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="colorApplications" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#156A3A" stopOpacity={0.3}/>
              <stop offset="95%" stopColor="#156A3A" stopOpacity={0}/>
            </linearGradient>
            <linearGradient id="colorApproved" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#D4A017" stopOpacity={0.3}/>
              <stop offset="95%" stopColor="#D4A017" stopOpacity={0}/>
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" strokeOpacity={0.5} />
          <XAxis
            dataKey="month"
            axisLine={false}
            tickLine={false}
            tick={{ fill: "#6B7280", fontSize: 11, fontFamily: "Inter" }}
          />
          <YAxis
            axisLine={false}
            tickLine={false}
            tick={{ fill: "#6B7280", fontSize: 11, fontFamily: "Inter" }}
            domain={[0, 60]}
            ticks={[0, 15, 30, 45, 60]}
          />
          <Tooltip content={CustomTooltip} cursor={{ stroke: "#E5E7EB", strokeWidth: 1, strokeDasharray: "5 5" }} />
          <Area
            type="monotone"
            dataKey="applications"
            stroke="#156A3A"
            strokeWidth={2}
            fillOpacity={1}
            fill="url(#colorApplications)"
            dot={false}
            activeDot={{ r: 4, fill: "#156A3A", strokeWidth: 2 }}
          />
          <Area
            type="monotone"
            dataKey="approved"
            stroke="#D4A017"
            strokeWidth={2}
            fillOpacity={1}
            fill="url(#colorApproved)"
            dot={false}
            activeDot={{ r: 4, fill: "#D4A017", strokeWidth: 2 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
