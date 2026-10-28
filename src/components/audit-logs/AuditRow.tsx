"use client";

import { Check, Bell, LogIn, Settings, Activity } from "lucide-react";
import { AuditLog } from "./AuditLogsData";

interface AuditRowProps {
  log: AuditLog;
  index: number;
}

export default function AuditRow({ log, index }: AuditRowProps) {
  const getIcon = () => {
    switch (log.action) {
      case "Loan Approved":
        return Check;
      case "Notification Sent":
        return Bell;
      case "Login":
        return LogIn;
      case "Settings Changed":
        return Settings;
      default:
        return Activity;
    }
  };

  const Icon = getIcon();

  return (
    <tr className="border-b border-[#E5E7EB] hover:bg-[#F8FAFC] transition-colors">
      <td className="px-3 py-2 text-[11px] text-[#6B7280]">{index + 1}</td>
      <td className="px-3 py-2">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-full bg-[#ECFDF5] flex items-center justify-center flex-shrink-0">
            <Icon className="w-3.5 h-3.5 text-[#166534]" strokeWidth={2} />
          </div>
          <span className="text-[11px] font-semibold text-[#1F2937]">{log.action}</span>
        </div>
      </td>
      <td className="px-3 py-2 text-[11px] text-[#1F2937]">{log.administrator}</td>
      <td className="px-3 py-2 text-[11px] text-[#166534] font-medium">{log.target}</td>
      <td className="px-3 py-2 text-[11px] text-[#6B7280]">{log.timestamp}</td>
      <td className="px-3 py-2 text-[11px] text-[#6B7280] font-mono">{log.ipAddress}</td>
    </tr>
  );
}
