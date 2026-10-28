"use client";

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
  const [selectedBackup, setSelectedBackup] = useState<BackupRecord | null>(null);

  const [backups] = useState<BackupRecord[]>([]);

  const handleBackupNow = () => {
    console.log("Starting database backup");
  };

  const handleDownload = () => {
    console.log("Downloading latest backup");
  };

  const handleRestore = (backup: BackupRecord) => {
    setSelectedBackup(backup);
    setShowRestoreModal(true);
  };

  const confirmRestore = () => {
    setShowRestoreModal(false);
    console.log("Restoring backup:", selectedBackup?.id);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Database Backup Card */}
      <div className="bg-white rounded-[18px] shadow-[0_2px_10px_rgba(0,0,0,0.05)] border border-[#E5E7EB] p-5">
        <h2 className="text-[20px] font-bold text-[#1F2937] mb-2">Database Backup</h2>
        <p className="text-[14px] text-[#6B7280] mb-4">
          Create a full backup of the system database. Backups are encrypted and stored securely.
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
                    onClick={() => handleRestore(backup)}
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

      {/* Restore Confirmation Modal */}
      {showRestoreModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-[18px] shadow-[0_2px_10px_rgba(0,0,0,0.05)] border border-[#E5E7EB] w-full max-w-md p-6">
            <h2 className="text-[20px] font-bold text-[#1F2937] mb-2">Restore Database Backup</h2>
            <p className="text-[15px] text-[#6B7280] mb-6">
              Restoring a backup will replace the current database with the selected backup. This action cannot be undone.
            </p>
            <div className="flex items-center justify-end gap-3">
              <button
                onClick={() => setShowRestoreModal(false)}
                className="px-4 h-10 bg-white border border-[#E5E7EB] rounded-[10px] text-[15px] font-medium text-[#1F2937] hover:bg-[#F9FAFB]"
              >
                Cancel
              </button>
              <button
                onClick={confirmRestore}
                className="px-4 h-10 bg-[#EF4444] rounded-[10px] text-[15px] font-medium text-white hover:bg-[#DC2626]"
              >
                Restore
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
