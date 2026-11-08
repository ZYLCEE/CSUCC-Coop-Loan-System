"use client";

import { useState } from "react";

export default function GeneralSettings() {
  const [cooperativeName, setCooperativeName] = useState("CSUCC Employees & Retirees MPC");
  const [maxUploadSize, setMaxUploadSize] = useState("10");
  const [allowedFileTypes, setAllowedFileTypes] = useState("PDF, DOCX, PNG, JPG");
  const [otpExpiration, setOtpExpiration] = useState("5");
  const [passwordMinLength, setPasswordMinLength] = useState("8");

  const handleSaveSettings = () => {
    console.log("Saving system settings");
  };

  return (
    <div className="bg-white rounded-[14px] shadow-[0_2px_10px_rgba(0,0,0,0.05)] border border-[#E5E7EB] p-4">
      <h2 className="text-[16px] font-bold text-[#111827] mb-4">System Configuration</h2>

      <div className="space-y-3">
        <div>
          <label className="block text-[11px] font-medium text-[#6B7280] mb-1 tracking-wider uppercase">
            Cooperative Name
          </label>
          <input
            type="text"
            value={cooperativeName}
            onChange={(e) => setCooperativeName(e.target.value)}
            className="w-full h-[38px] px-3 bg-white border border-[#E5E7EB] rounded-[12px] text-[14px] text-[#1F2937] focus:outline-none focus:ring-2 focus:ring-[#1F6B3A]/20 focus:border-[#1F6B3A] transition-all"
          />
        </div>

        <div>
          <label className="block text-[11px] font-medium text-[#6B7280] mb-1 tracking-wider uppercase">
            Max Upload File Size (MB)
          </label>
          <input
            type="number"
            value={maxUploadSize}
            onChange={(e) => setMaxUploadSize(e.target.value)}
            className="w-full h-[38px] px-3 bg-white border border-[#E5E7EB] rounded-[12px] text-[14px] text-[#1F2937] focus:outline-none focus:ring-2 focus:ring-[#1F6B3A]/20 focus:border-[#1F6B3A] transition-all"
          />
        </div>

        <div>
          <label className="block text-[11px] font-medium text-[#6B7280] mb-1 tracking-wider uppercase">
            Allowed File Types
          </label>
          <input
            type="text"
            value={allowedFileTypes}
            onChange={(e) => setAllowedFileTypes(e.target.value)}
            className="w-full h-[38px] px-3 bg-white border border-[#E5E7EB] rounded-[12px] text-[14px] text-[#1F2937] focus:outline-none focus:ring-2 focus:ring-[#1F6B3A]/20 focus:border-[#1F6B3A] transition-all"
          />
        </div>

        <div>
          <label className="block text-[11px] font-medium text-[#6B7280] mb-1 tracking-wider uppercase">
            OTP Expiration (Minutes)
          </label>
          <input
            type="number"
            value={otpExpiration}
            onChange={(e) => setOtpExpiration(e.target.value)}
            className="w-full h-[38px] px-3 bg-white border border-[#E5E7EB] rounded-[12px] text-[14px] text-[#1F2937] focus:outline-none focus:ring-2 focus:ring-[#1F6B3A]/20 focus:border-[#1F6B3A] transition-all"
          />
        </div>

        <div>
          <label className="block text-[11px] font-medium text-[#6B7280] mb-1 tracking-wider uppercase">
            Password Minimum Length
          </label>
          <input
            type="number"
            value={passwordMinLength}
            onChange={(e) => setPasswordMinLength(e.target.value)}
            className="w-full h-[38px] px-3 bg-white border border-[#E5E7EB] rounded-[12px] text-[14px] text-[#1F2937] focus:outline-none focus:ring-2 focus:ring-[#1F6B3A]/20 focus:border-[#1F6B3A] transition-all"
          />
        </div>
      </div>

      <button
        onClick={handleSaveSettings}
        className="mt-3 px-3 h-[32px] bg-[#1F6B3A] rounded-[10px] text-[12px] font-semibold text-white hover:bg-[#14532D] transition-colors"
      >
        Save Settings
      </button>
    </div>
  );
}
