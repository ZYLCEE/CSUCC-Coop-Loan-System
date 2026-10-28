"use client";

import { X } from "lucide-react";
import { Member } from "./MembersData";
import RoleBadge from "./RoleBadge";
import StatusBadge from "./StatusBadge";
import MembershipTypeBadge from "@/components/shared/MembershipTypeBadge";

interface MemberDetailsModalProps {
  member: Member | null;
  onClose: () => void;
}

export default function MemberDetailsModal({ member, onClose }: MemberDetailsModalProps) {
  if (!member) {
    return null;
  }

  const fields = [
    { label: "ID Number", value: member.idNumber },
    { label: "Full Name", value: member.fullName },
    { label: "Email Address", value: member.email },
    { label: "Department", value: member.department },
  ];

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-[#111827]/40 px-4"
      onMouseDown={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="member-details-title"
    >
      <div
        className="w-full max-w-[460px] rounded-[14px] border border-[#E5E7EB] bg-white shadow-[0_24px_60px_rgba(15,23,42,0.24)]"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[#E5E7EB] px-5 py-4">
          <div>
            <h2 id="member-details-title" className="text-[15px] font-bold text-[#1F2937]">
              Account Details
            </h2>
            <p className="mt-0.5 text-[12px] text-[#6B7280]">
              {member.idNumber || "ID number not recorded"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full text-[#6B7280] transition-colors hover:bg-[#F1F5F9] hover:text-[#155D3B]"
            aria-label="Close member details"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3 px-5 py-4">
          {fields.map((field) => (
            <div key={field.label} className="grid grid-cols-[130px_1fr] gap-3">
              <span className="text-[12px] font-semibold text-[#6B7280]">{field.label}</span>
              <span className="text-[13px] font-medium text-[#1F2937]">
                {field.value || "N/A"}
              </span>
            </div>
          ))}
          <div className="grid grid-cols-[130px_1fr] gap-3">
            <span className="text-[12px] font-semibold text-[#6B7280]">
              Membership Type
            </span>
            {member.role === "Member" ? (
              <MembershipTypeBadge membershipType={member.membershipType} />
            ) : (
              <span className="text-[12px] text-[#64748B]">N/A</span>
            )}
          </div>
          <div className="grid grid-cols-[130px_1fr] gap-3">
            <span className="text-[12px] font-semibold text-[#6B7280]">Role</span>
            <RoleBadge role={member.role} />
          </div>
          <div className="grid grid-cols-[130px_1fr] gap-3">
            <span className="text-[12px] font-semibold text-[#6B7280]">Status</span>
            <StatusBadge status={member.status} />
          </div>
          {member.integrityIssue && (
            <div className="rounded-md border border-[#FDE68A] bg-[#FFFBEB] px-3 py-2 text-[12px] text-[#92400E]">
              Data integrity issue: {member.integrityIssue}
            </div>
          )}
        </div>

        <div className="flex justify-end border-t border-[#E5E7EB] px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="h-[36px] rounded-[10px] bg-[#155D3B] px-4 text-[13px] font-semibold text-white transition-colors hover:bg-[#134A30]"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
