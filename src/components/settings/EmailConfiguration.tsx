"use client";

import { useState } from "react";

export default function EmailConfiguration() {
  const [smtpHost, setSmtpHost] = useState("smtp.gmail.com");
  const [smtpPort, setSmtpPort] = useState("587");
  const [senderEmail, setSenderEmail] = useState("noreply@csucccoop.ph");
  const [senderName, setSenderName] = useState("CSUCC MPC System");
  const [maintenanceMode, setMaintenanceMode] = useState(false);

  const handleSaveEmailConfig = () => {
    console.log("Saving email configuration");
  };

  return (
    <div className="bg-white rounded-[14px] shadow-[0_2px_10px_rgba(0,0,0,0.05)] border border-[#E5E7EB] p-4">
      <h2 className="text-[16px] font-bold text-[#111827] mb-4">Email Configuration</h2>
      
      <div className="space-y-3">
        <div>
          <label className="block text-[11px] font-medium text-[#6B7280] mb-1 tracking-wider uppercase">
            SMTP Host
          </label>
          <input
            type="text"
            value={smtpHost}
            onChange={(e) => setSmtpHost(e.target.value)}
            className="w-full h-[38px] px-3 bg-white border border-[#E5E7EB] rounded-[12px] text-[14px] text-[#1F2937] focus:outline-none focus:ring-2 focus:ring-[#1F6B3A]/20 focus:border-[#1F6B3A] transition-all"
          />
        </div>

        <div>
          <label className="block text-[11px] font-medium text-[#6B7280] mb-1 tracking-wider uppercase">
            SMTP Port
          </label>
          <input
            type="number"
            value={smtpPort}
            onChange={(e) => setSmtpPort(e.target.value)}
            className="w-full h-[38px] px-3 bg-white border border-[#E5E7EB] rounded-[12px] text-[14px] text-[#1F2937] focus:outline-none focus:ring-2 focus:ring-[#1F6B3A]/20 focus:border-[#1F6B3A] transition-all"
          />
        </div>

        <div>
          <label className="block text-[11px] font-medium text-[#6B7280] mb-1 tracking-wider uppercase">
            Sender Email
          </label>
          <input
            type="email"
            value={senderEmail}
            onChange={(e) => setSenderEmail(e.target.value)}
            className="w-full h-[38px] px-3 bg-white border border-[#E5E7EB] rounded-[12px] text-[14px] text-[#1F2937] focus:outline-none focus:ring-2 focus:ring-[#1F6B3A]/20 focus:border-[#1F6B3A] transition-all"
          />
        </div>

        <div>
          <label className="block text-[11px] font-medium text-[#6B7280] mb-1 tracking-wider uppercase">
            Sender Name
          </label>
          <input
            type="text"
            value={senderName}
            onChange={(e) => setSenderName(e.target.value)}
            className="w-full h-[38px] px-3 bg-white border border-[#E5E7EB] rounded-[12px] text-[14px] text-[#1F2937] focus:outline-none focus:ring-2 focus:ring-[#1F6B3A]/20 focus:border-[#1F6B3A] transition-all"
          />
        </div>
      </div>

      {/* Divider */}
      <div className="border-t border-[#E5E7EB] my-4" />

      {/* Maintenance Mode */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-[14px] font-semibold text-[#111827]">Maintenance Mode</h3>
          <p className="text-[12px] text-[#6B7280] mt-1">Disables mobile app access during maintenance</p>
        </div>
        <button
          onClick={() => setMaintenanceMode(!maintenanceMode)}
          className={`w-12 h-7 rounded-full transition-colors ${
            maintenanceMode ? "bg-[#1F6B3A]" : "bg-[#E5E7EB]"
          }`}
        >
          <div
            className={`w-5 h-5 bg-white rounded-full transition-transform ${
              maintenanceMode ? "translate-x-6" : "translate-x-1"
            }`}
          />
        </button>
      </div>

      <button
        onClick={handleSaveEmailConfig}
        className="mt-3 px-3 h-[32px] bg-[#1F6B3A] rounded-[10px] text-[12px] font-semibold text-white hover:bg-[#14532D] transition-colors"
      >
        Save Email Config
      </button>
    </div>
  );
}
