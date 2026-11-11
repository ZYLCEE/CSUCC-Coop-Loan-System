"use client";

import { ConfirmActionDialog } from "@/components/ui/ConfirmActionDialog";
import { useState } from "react";
import { Database, Download, RotateCcw } from "lucide-react";

interface BackupRecord {
  id: string;
  date: string;
  time: string;
  size: string;
  type: "Auto" | "Manual";
}

export default function Backup() {
  const [showRestoreModal, setShowRestoreModal] = useState(false);

  const [backups] = useState<BackupRecord[]>([]);

  const handleBackupNow = () => {
    // No connected backup API.
  };

  const handleDownload = () => {
    // No connected backup download API.
  };

  const handleRestore = () => {
    setShowRestoreModal(true);
  };

  return (
    <section className="space-y-3"><p role="note" className="text-support text-portal-muted">Legacy preview: these controls are unavailable and do not save changes. Use the current portal settings.</p><fieldset disabled><div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Database Backup Card */}
      <div className="bg-white rounded-[18px] shadow-[0_2px_10px_rgba(0,0,0,0.05)] border border-[#E5E7EB] p-5">
        <h2 className="text-[20px] font-bold text-[#1F2937] mb-2">Database Backup</h2>
        <p className="text-[14px] text-[#6B7280] mb-4">
          Backup creation and restoration are unavailable in this legacy preview. Use the connected portal settings and Supabase backup tools.
        </p>

        {/* Last Backup Card */}
        <div className="bg-[#ECFDF5] border border-[#BBF7D0] rounded-[14px] p-[18px] mb-5">
          <p className="text-[11px] font-bold text-[#166534] uppercase mb-1">LAST BACKUP</p>
          <p className="text-[18px] font-bold text-[#1F2937] mb-1">Not loaded</p>
          <p className="text-[13px] text-[#6B7280]">No backup data loaded.</p>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-4">
          <button
            onClick={handleBackupNow}
            className="flex items-center gap-2 px-[22px] h-[42px] bg-[#166534] rounded-full text-[15px] font-medium text-white hover:bg-[#14532D] transition-colors"
          >
            <Database className="w-4 h-4" />
            Backup Now
          </button>
          <button
            onClick={handleDownload}
            className="flex items-center gap-2 px-[22px] h-[42px] bg-white border border-[#D1D5DB] rounded-full text-[15px] font-medium text-[#6B7280] hover:bg-[#F9FAFB] transition-colors"
          >
            <Download className="w-4 h-4" />
            Download
          </button>
        </div>
      </div>

      {/* Backup History Card */}
      <div className="bg-white rounded-[18px] shadow-[0_2px_10px_rgba(0,0,0,0.05)] border border-[#E5E7EB] p-5">
        <h2 className="text-[20px] font-bold text-[#1F2937] mb-4">Backup History</h2>

        <div className="space-y-0">
          {backups.map((backup, index) => (
            <div key={backup.id}>
              <div className="flex items-center justify-between py-3">
                <div>
                  <p className="text-[16px] font-bold text-[#1F2937]">
                    {backup.date} {backup.time}
                  </p>
                  <p className="text-[13px] text-[#6B7280]">
                    {backup.size} ·{" "}
                    <span className={backup.type === "Manual" ? "text-[#F59E0B]" : ""}>
                      {backup.type}
                    </span>
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleDownload}
                    className="p-2 hover:bg-[#F9FAFB] rounded-full transition-colors"
                  >
                    <Download className="w-4 h-4 text-[#6B7280]" />
                  </button>
                  <button
                    onClick={() => handleRestore()}
                    className="p-2 hover:bg-[#F9FAFB] rounded-full transition-colors"
                  >
                    <RotateCcw className="w-4 h-4 text-[#6B7280]" />
                  </button>
                </div>
              </div>
              {index < backups.length - 1 && (
                <div className="border-b border-[#F1F5F9]" />
              )}
            </div>
          ))}
        </div>
      </div>

      {showRestoreModal && <ConfirmActionDialog title="Restore database backup" tone="destructive" question="This legacy preview has no connected service. No operation will be performed." confirmLabel="Unavailable" disabled onClose={() => setShowRestoreModal(false)} onConfirm={() => {}} />}

    </div></fieldset></section>
  );
}
