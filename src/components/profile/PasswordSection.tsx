"use client";

import { useState } from "react";
import { Eye, EyeOff, Lock } from "lucide-react";

export default function PasswordSection() {
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [formData, setFormData] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });

  const handleUpdatePassword = () => {
    console.log("Updating password:", formData);
  };

  return (
    <div className="bg-white rounded-[18px] shadow-[0_2px_12px_rgba(0,0,0,0.06)] border border-[#E5E7EB] p-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-[#DCFCE7] flex items-center justify-center">
          <Lock className="w-5 h-5 text-[#166534]" strokeWidth={2} />
        </div>
        <h2 className="text-[20px] font-semibold text-[#111827]">Password & Security</h2>
      </div>

      {/* Form */}
      <div className="space-y-5 mb-6">
        {/* Current Password */}
        <div>
          <label className="block text-[14px] font-medium text-[#111827] mb-2">Current Password</label>
          <div className="relative">
            <input
              type={showCurrentPassword ? "text" : "password"}
              value={formData.currentPassword}
              onChange={(e) => setFormData({ ...formData, currentPassword: e.target.value })}
              placeholder="Enter current password"
              className="w-full h-[44px] px-4 pr-12 bg-white border border-[#D9DEE8] rounded-[12px] text-[16px] text-[#111827] placeholder-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#166534]/20 focus:border-[#166534] transition-all"
            />
            <button
              onClick={() => setShowCurrentPassword(!showCurrentPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[#6B7280] hover:text-[#111827]"
            >
              {showCurrentPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {/* New Password */}
        <div>
          <label className="block text-[14px] font-medium text-[#111827] mb-2">New Password</label>
          <div className="relative">
            <input
              type={showNewPassword ? "text" : "password"}
              value={formData.newPassword}
              onChange={(e) => setFormData({ ...formData, newPassword: e.target.value })}
              placeholder="Enter new password"
              className="w-full h-[44px] px-4 pr-12 bg-white border border-[#D9DEE8] rounded-[12px] text-[16px] text-[#111827] placeholder-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#166534]/20 focus:border-[#166534] transition-all"
            />
            <button
              onClick={() => setShowNewPassword(!showNewPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[#6B7280] hover:text-[#111827]"
            >
              {showNewPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {/* Confirm Password */}
        <div>
          <label className="block text-[14px] font-medium text-[#111827] mb-2">Confirm Password</label>
          <div className="relative">
            <input
              type={showConfirmPassword ? "text" : "password"}
              value={formData.confirmPassword}
              onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
              placeholder="Confirm new password"
              className="w-full h-[44px] px-4 pr-12 bg-white border border-[#D9DEE8] rounded-[12px] text-[16px] text-[#111827] placeholder-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#166534]/20 focus:border-[#166534] transition-all"
            />
            <button
              onClick={() => setShowConfirmPassword(!showConfirmPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[#6B7280] hover:text-[#111827]"
            >
              {showConfirmPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {/* Password Requirements */}
        <div className="bg-[#F8FAFC] rounded-lg p-4">
          <p className="text-[13px] font-medium text-[#111827] mb-2">Password must contain at least:</p>
          <ul className="text-[13px] text-[#6B7280] space-y-1">
            <li>• 8 characters</li>
            <li>• 1 uppercase letter</li>
            <li>• 1 number</li>
            <li>• 1 special character</li>
          </ul>
        </div>
      </div>

      {/* Update Button */}
      <button
        onClick={handleUpdatePassword}
        className="px-6 h-[44px] bg-[#166534] rounded-[12px] text-[15px] font-semibold text-white hover:bg-[#14532D] transition-colors"
      >
        Update Password
      </button>
    </div>
  );
}
