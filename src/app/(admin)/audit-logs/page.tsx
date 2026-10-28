"use client";

import { useState } from "react";
import AuditToolbar from "@/components/audit-logs/AuditToolbar";
import AuditLogsTable from "@/components/audit-logs/AuditLogsTable";
import { auditLogs } from "@/components/audit-logs/AuditLogsData";

export default function AuditLogsPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [actionFilter, setActionFilter] = useState("All Actions");
  const [dateFilter, setDateFilter] = useState("");
  const [currentPage, setCurrentPage] = useState(1);

  const filteredLogs = auditLogs.filter((log) => {
    const matchesSearch = log.action.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         log.administrator.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         log.target.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesAction = actionFilter === "All Actions" || log.action === actionFilter;
    return matchesSearch && matchesAction;
  });

  return (
    <div className="px-4 py-4">
      {/* Filter Toolbar */}
      <AuditToolbar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        actionFilter={actionFilter}
        onActionFilterChange={setActionFilter}
        dateFilter={dateFilter}
        onDateFilterChange={setDateFilter}
      />

      {/* Audit Logs Table */}
      <AuditLogsTable
        logs={filteredLogs}
        currentPage={currentPage}
        totalPages={3}
        totalItems={1847}
        onPageChange={setCurrentPage}
      />
    </div>
  );
}
