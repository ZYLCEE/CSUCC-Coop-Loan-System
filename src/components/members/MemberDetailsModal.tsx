"use client";

import { Button } from "@/components/ui/Button";
import { DetailDialog } from "@/components/ui/DetailDialog";
import { UserRound } from "lucide-react";
import type { ReactNode } from "react";
import { Member } from "./MembersData";
import RoleBadge from "./RoleBadge";
import {formatAccountNumber} from "@/lib/accountPresentation";
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

  const created = new Date(member.createdAt);
  const sections: Array<{ title: string; fields: Array<{ label: string; value: ReactNode; wide?: boolean }> }> = [
    { title: "Personal Information", fields: [
      { label: "ID Number", value: formatAccountNumber(member.idNumber) },
      { label: "Full Name", value: member.fullName },
      ...(member.role === "Member" ? [
        { label: "Membership Type", value: <MembershipTypeBadge membershipType={member.membershipType} /> },
        { label: "Department", value: member.department },
      ] : []),
    ] },
    { title: "Contact Information", fields: [
      { label: "Email Address", value: member.email },
      { label: "Contact Number", value: member.phone },
      { label: "Address", value: member.address, wide: true },
    ] },
    { title: "Account Information", fields: [
      { label: "Role", value: <RoleBadge role={member.role} /> },
      { label: "Status", value: <StatusBadge status={member.status} /> },
      ...(member.createdAt && Number.isFinite(created.getTime()) ? [{ label: "Date Registered", value: new Intl.DateTimeFormat("en-PH", { dateStyle: "long", timeZone: "Asia/Manila" }).format(created) }] : []),
    ] },
  ];

  return (
    <DetailDialog icon={UserRound} title="Account Details" titleId="member-details-title" subtitle={formatAccountNumber(member.idNumber)}
      closeLabel="Close member details" onClose={onClose} dismissOnBackdrop className="max-w-[900px]"
      footer={<Button variant="primary" onClick={onClose}>Close</Button>}>
        <div className="space-y-5">
          {sections.map(({ title, fields }, index) => <section key={title} aria-labelledby={`member-details-section-${index}`} className="border-b border-portal-border pb-5 last:border-b-0 last:pb-0">
            <h3 id={`member-details-section-${index}`} className="mb-3 text-sm font-bold text-coop-primary">{title}</h3>
            <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
              {fields.map(({ label, value, wide }) => <div key={label} className={`min-w-0 ${wide ? "col-span-full" : ""}`}>
                <dt className="mb-1 text-caption font-semibold text-portal-muted">{label}</dt>
                <dd className="whitespace-pre-wrap text-body font-medium text-portal-primary [overflow-wrap:anywhere]">{value || "Not recorded"}</dd>
              </div>)}
            </dl>
          </section>)}
          {member.integrityIssue && (
            <div className="rounded-portal-control bg-status-warning-surface px-3 py-2 text-caption text-status-warning">
              Data integrity issue: {member.integrityIssue}
            </div>
          )}
        </div>
    </DetailDialog>
  );
}
