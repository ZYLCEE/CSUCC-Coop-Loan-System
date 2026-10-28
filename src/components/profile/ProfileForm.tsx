"use client";

import { useState } from "react";
import { Lock } from "lucide-react";
import { profile } from "./ProfileData";
import FormField from "../settings/FormField";

export default function ProfileForm() {
  const [formData, setFormData] = useState({
    firstName: profile.firstName,
    lastName: profile.lastName,
    email: profile.email,
    phone: profile.phone,
    department: profile.department,
    position: profile.position,
  });

  const handleSave = () => {
    console.log("Saving profile:", formData);
  };

  const handleChangePassword = () => {
    console.log("Change password clicked");
  };

  return (
    <div className="bg-white rounded-[14px] shadow-[0_2px_12px_rgba(0,0,0,0.06)] border border-[#E5E7EB] p-3 h-full flex flex-col">
      {/* Header */}
      <h2 className="text-[14px] font-semibold text-[#111827] mb-3">Edit Profile</h2>

      {/* Form */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3 flex-1">
        <FormField
          label="First Name"
          value={formData.firstName}
          onChange={(value) => setFormData({ ...formData, firstName: value })}
          placeholder="Enter first name"
          required
        />
        <FormField
          label="Last Name"
          value={formData.lastName}
          onChange={(value) => setFormData({ ...formData, lastName: value })}
          placeholder="Enter last name"
          required
        />
        <FormField
          label="Email Address"
          value={formData.email}
          onChange={(value) => setFormData({ ...formData, email: value })}
          placeholder="Enter email address"
          type="email"
          required
        />
        <FormField
          label="Mobile Number"
          value={formData.phone}
          onChange={(value) => setFormData({ ...formData, phone: value })}
          placeholder="Enter mobile number"
        />
        <FormField
          label="Department"
          value={formData.department}
          onChange={(value) => setFormData({ ...formData, department: value })}
          placeholder="Enter department"
        />
        <FormField
          label="Position"
          value={formData.position}
          onChange={(value) => setFormData({ ...formData, position: value })}
          placeholder="Enter position"
        />
      </div>

      {/* Action Buttons */}
      <div className="flex items-center gap-2">
        <button
          onClick={handleSave}
          className="px-4 h-8 bg-[#166534] rounded-[10px] text-[12px] font-semibold text-white hover:bg-[#14532D] transition-colors"
        >
          Save Changes
        </button>
        <button
          onClick={handleChangePassword}
          className="flex items-center gap-1.5 px-4 h-8 bg-white border border-[#E5E7EB] rounded-[10px] text-[12px] font-semibold text-[#1F2937] hover:bg-[#F9FAFB] transition-colors"
        >
          <Lock className="w-3 h-3" />
          Change Password
        </button>
      </div>
    </div>
  );
}
