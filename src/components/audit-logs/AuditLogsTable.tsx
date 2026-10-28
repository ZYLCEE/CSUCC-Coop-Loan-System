"use client";

import { AuditLog } from "./AuditLogsData";
import AuditRow from "./AuditRow";
import Pagination from "../members/Pagination";

interface AuditLogsTableProps {
  logs: AuditLog[];
  currentPage: number;
  totalPages: number;
  totalItems: number;
  onPageChange: (page: number) => void;
}

export default function AuditLogsTable({ logs, currentPage, totalPages, totalItems, onPageChange }: AuditLogsTableProps) {
  return (
    <div className="bg-white rounded-[14px] shadow-[0_2px_12px_rgba(0,0,0,0.06)] border border-[#E5E7EB] overflow-hidden">
      <table className="w-full">
        <thead>
          <tr className="bg-[#F8FAFC] border-b border-[#E5E7EB]">
            <th className="text-left py-2 px-3 text-[10px] font-semibold uppercase text-[#6B7280] tracking-wider">
              #
            </th>
            <th className="text-left py-2 px-3 text-[10px] font-semibold uppercase text-[#6B7280] tracking-wider">
              Action
            </th>
            <th className="text-left py-2 px-3 text-[10px] font-semibold uppercase text-[#6B7280] tracking-wider">
              Administrator
            </th>
            <th className="text-left py-2 px-3 text-[10px] font-semibold uppercase text-[#6B7280] tracking-wider">
              Target
            </th>
            <th className="text-left py-2 px-3 text-[10px] font-semibold uppercase text-[#6B7280] tracking-wider">
              Timestamp
            </th>
            <th className="text-left py-2 px-3 text-[10px] font-semibold uppercase text-[#6B7280] tracking-wider">
              IP Address
            </th>
          </tr>
        </thead>
        <tbody>
          {logs.map((log, index) => (
            <AuditRow key={log.id} log={log} index={index} />
          ))}
        </tbody>
      </table>

      {/* Pagination */}
      <Pagination
        currentPage={currentPage}
        totalPages={totalPages}
        totalItems={totalItems}
        onPageChange={onPageChange}
      />
    </div>
  );
}
