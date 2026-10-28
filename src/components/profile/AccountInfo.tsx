"use client";

import { profile } from "./ProfileData";

export default function AccountInfo() {
  return (
    <div className="bg-white rounded-[18px] shadow-[0_2px_12px_rgba(0,0,0,0.06)] border border-[#E5E7EB] p-6">
      <h2 className="text-[20px] font-semibold text-[#111827] mb-6">Account Information</h2>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* Username */}
        <div>
          <label className="block text-[14px] font-medium text-[#111827] mb-2">Username</label>
          <input
            type="text"
            value={profile.username}
            disabled
            className="w-full h-[44px] px-4 bg-gray-50 border border-[#E5E7EB] rounded-[12px] text-[16px] text-[#6B7280] cursor-not-allowed"
          />
        </div>

        {/* Role */}
        <div>
          <label className="block text-[14px] font-medium text-[#111827] mb-2">Role</label>
          <input
            type="text"
            value={profile.role}
            disabled
            className="w-full h-[44px] px-4 bg-gray-50 border border-[#E5E7EB] rounded-[12px] text-[16px] text-[#6B7280] cursor-not-allowed"
          />
        </div>

        {/* Account Status */}
        <div>
          <label className="block text-[14px] font-medium text-[#111827] mb-2">Account Status</label>
          <input
            type="text"
            value={profile.accountStatus}
            disabled
            className="w-full h-[44px] px-4 bg-gray-50 border border-[#E5E7EB] rounded-[12px] text-[16px] text-[#6B7280] cursor-not-allowed"
          />
        </div>

        {/* Date Created */}
        <div>
          <label className="block text-[14px] font-medium text-[#111827] mb-2">Date Created</label>
          <input
            type="text"
            value={profile.dateCreated}
            disabled
            className="w-full h-[44px] px-4 bg-gray-50 border border-[#E5E7EB] rounded-[12px] text-[16px] text-[#6B7280] cursor-not-allowed"
          />
        </div>

        {/* Last Password Change */}
        <div className="md:col-span-2">
          <label className="block text-[14px] font-medium text-[#111827] mb-2">Last Password Change</label>
          <input
            type="text"
            value={profile.lastPasswordChange}
            disabled
            className="w-full h-[44px] px-4 bg-gray-50 border border-[#E5E7EB] rounded-[12px] text-[16px] text-[#6B7280] cursor-not-allowed"
          />
        </div>
      </div>
    </div>
  );
}
