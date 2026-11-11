"use client";

import { ConfirmActionDialog } from "@/components/ui/ConfirmActionDialog";
import { useState } from "react";

export default function Security() {
  const [minLength, setMinLength] = useState("8");
  const [passwordExpiry, setPasswordExpiry] = useState("90");
  const [maxLoginAttempts, setMaxLoginAttempts] = useState("5");
  const [lockoutDuration, setLockoutDuration] = useState("30");
  const [requireUppercase, setRequireUppercase] = useState(true);
  const [requireNumber, setRequireNumber] = useState(true);
  const [requireSpecial, setRequireSpecial] = useState(false);

  const [showRevokeModal, setShowRevokeModal] = useState(false);

  return (
    <section className="space-y-3"><p role="note" className="text-support text-portal-muted">Legacy preview: these controls are unavailable and do not save changes. Use the current portal settings.</p><fieldset disabled><div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Password Policy Card */}
      <div className="bg-white rounded-[18px] shadow-[0_2px_10px_rgba(0,0,0,0.05)] border border-[#E5E7EB] p-5">
        <h2 className="text-[20px] font-bold text-[#1F2937] mb-5">Password Policy</h2>
        
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <label className="text-[15px] font-medium text-[#1F2937]">Minimum Length</label>
            <input
              type="number"
              value={minLength}
              onChange={(e) => setMinLength(e.target.value)}
              className="w-16 h-8 bg-white border border-[#E5E7EB] rounded-[10px] text-center text-[15px] text-[#1F2937] focus:outline-none focus:ring-2 focus:ring-[#166534]/20 focus:border-[#166534]"
            />
          </div>

          <div className="flex items-center justify-between">
            <label className="text-[15px] font-medium text-[#1F2937]">Password Expiry (days)</label>
            <input
              type="number"
              value={passwordExpiry}
              onChange={(e) => setPasswordExpiry(e.target.value)}
              className="w-16 h-8 bg-white border border-[#E5E7EB] rounded-[10px] text-center text-[15px] text-[#1F2937] focus:outline-none focus:ring-2 focus:ring-[#166534]/20 focus:border-[#166534]"
            />
          </div>

          <div className="flex items-center justify-between">
            <label className="text-[15px] font-medium text-[#1F2937]">Max Login Attempts</label>
            <input
              type="number"
              value={maxLoginAttempts}
              onChange={(e) => setMaxLoginAttempts(e.target.value)}
              className="w-16 h-8 bg-white border border-[#E5E7EB] rounded-[10px] text-center text-[15px] text-[#1F2937] focus:outline-none focus:ring-2 focus:ring-[#166534]/20 focus:border-[#166534]"
            />
          </div>

          <div className="flex items-center justify-between">
            <label className="text-[15px] font-medium text-[#1F2937]">Account Lockout Duration (min)</label>
            <input
              type="number"
              value={lockoutDuration}
              onChange={(e) => setLockoutDuration(e.target.value)}
              className="w-16 h-8 bg-white border border-[#E5E7EB] rounded-[10px] text-center text-[15px] text-[#1F2937] focus:outline-none focus:ring-2 focus:ring-[#166534]/20 focus:border-[#166534]"
            />
          </div>

          <div className="flex items-center justify-between">
            <label className="text-[15px] font-medium text-[#1F2937]">Require Uppercase</label>
            <button
              onClick={() => setRequireUppercase(!requireUppercase)}
              className={`w-[34px] h-[20px] rounded-full transition-all duration-200 ${
                requireUppercase ? "bg-[#166534]" : "bg-[#D1D5DB]"
              }`}
            >
              <div
                className={`w-4 h-4 bg-white rounded-full transition-transform duration-200 ${
                  requireUppercase ? "translate-x-[14px]" : "translate-x-[2px]"
                }`}
              />
            </button>
          </div>

          <div className="flex items-center justify-between">
            <label className="text-[15px] font-medium text-[#1F2937]">Require Number</label>
            <button
              onClick={() => setRequireNumber(!requireNumber)}
              className={`w-[34px] h-[20px] rounded-full transition-all duration-200 ${
                requireNumber ? "bg-[#166534]" : "bg-[#D1D5DB]"
              }`}
            >
              <div
                className={`w-4 h-4 bg-white rounded-full transition-transform duration-200 ${
                  requireNumber ? "translate-x-[14px]" : "translate-x-[2px]"
                }`}
              />
            </button>
          </div>

          <div className="flex items-center justify-between">
            <label className="text-[15px] font-medium text-[#1F2937]">Require Special Character</label>
            <button
              onClick={() => setRequireSpecial(!requireSpecial)}
              className={`w-[34px] h-[20px] rounded-full transition-all duration-200 ${
                requireSpecial ? "bg-[#166534]" : "bg-[#D1D5DB]"
              }`}
            >
              <div
                className={`w-4 h-4 bg-white rounded-full transition-transform duration-200 ${
                  requireSpecial ? "translate-x-[14px]" : "translate-x-[2px]"
                }`}
              />
            </button>
          </div>
        </div>
      </div>

      {/* Active Admin Sessions Card */}
      <div className="bg-white rounded-[18px] shadow-[0_2px_10px_rgba(0,0,0,0.05)] border border-[#E5E7EB] p-5">
        <h2 className="text-[20px] font-bold text-[#1F2937] mb-5">Active Admin Sessions</h2>
        
        <p className="text-sm text-[#6B7280]">No session data loaded.</p>
      </div>

      {showRevokeModal && <ConfirmActionDialog title="Revoke session" tone="destructive" question="This legacy preview has no connected service. No operation will be performed." confirmLabel="Unavailable" disabled onClose={() => setShowRevokeModal(false)} onConfirm={() => {}} />}

    </div></fieldset></section>
  );
}
