"use client";

import { Mail, Phone, Building2, Clock, ShieldCheck } from "lucide-react";
import { profile } from "./ProfileData";

export default function ProfileCard() {
  const initials = `${profile.firstName[0]}${profile.lastName[0]}`;

  return (
    <div className="bg-white rounded-[14px] shadow-[0_2px_12px_rgba(0,0,0,0.06)] border border-[#E5E7EB] p-3 h-full flex flex-col">
      {/* Avatar */}
      <div className="flex flex-col items-center mb-3">
        <div className="w-16 h-16 rounded-full bg-[#166534] flex items-center justify-center mb-2">
          <span className="text-[22px] font-bold text-white">{initials}</span>
        </div>
        
        {/* Verified Badge */}
        <div className="mb-1.5">
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#ECFDF5] text-[#15803D] text-[10px] font-medium">
            <ShieldCheck className="w-2 h-2" />
            Verified Admin
          </span>
        </div>

        {/* Name */}
        <h2 className="text-[16px] font-bold text-[#111827] mb-0.5">
          {profile.firstName} {profile.lastName}
        </h2>

        {/* Role */}
        <p className="text-[12px] font-medium text-[#166534] mb-0.5">{profile.position}</p>

        {/* ID */}
        <p className="text-[10px] text-[#6B7280]">{profile.id}</p>
      </div>

      {/* Divider */}
      <div className="border-t border-[#E5E7EB] mb-3" />

      {/* Profile Information */}
      <div className="space-y-2.5 flex-1">
        {/* Email */}
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-lg bg-[#DCFCE7] flex items-center justify-center flex-shrink-0">
            <Mail className="w-3 h-3 text-[#166534]" strokeWidth={2} />
          </div>
          <div>
            <p className="text-[10px] text-[#6B7280]">Email</p>
            <p className="text-[11px] text-[#111827]">{profile.email}</p>
          </div>
        </div>

        {/* Phone */}
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-lg bg-[#DCFCE7] flex items-center justify-center flex-shrink-0">
            <Phone className="w-3 h-3 text-[#166534]" strokeWidth={2} />
          </div>
          <div>
            <p className="text-[10px] text-[#6B7280]">Phone</p>
            <p className="text-[11px] text-[#111827]">{profile.phone}</p>
          </div>
        </div>

        {/* Office */}
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-lg bg-[#DCFCE7] flex items-center justify-center flex-shrink-0">
            <Building2 className="w-3 h-3 text-[#166534]" strokeWidth={2} />
          </div>
          <div>
            <p className="text-[10px] text-[#6B7280]">Office</p>
            <p className="text-[11px] text-[#111827]">{profile.office}</p>
          </div>
        </div>

        {/* Last Login */}
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-lg bg-[#DCFCE7] flex items-center justify-center flex-shrink-0">
            <Clock className="w-3 h-3 text-[#166534]" strokeWidth={2} />
          </div>
          <div>
            <p className="text-[10px] text-[#6B7280]">Last Login</p>
            <p className="text-[11px] text-[#111827]">{profile.lastLogin}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
