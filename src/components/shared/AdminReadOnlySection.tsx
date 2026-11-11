"use client";

import { ReactNode } from "react";
import { Info } from "lucide-react";
import { useAdminAuth } from "@/components/auth/AdminAuthProvider";

export default function AdminReadOnlySection({
  section,
  children,
}: {
  section: string;
  children: ReactNode;
}) {
  const { role, can } = useAdminAuth();
  const granted = (section === "settings" && can("settings.manage")) ||
    (section==="committee-accounts"&&can("committee.accounts.manage")) ||
    (section === "settings" && can("workflow.policy.manage")) ||
    (section === "loan-applications" && (can("applications.verify") || can("applications.return"))) ||
    (["system-management", "documents"].includes(section) && (can("documents.review") || can("documents.upload") || can("documents.delete"))) ||
    (["communication", "notifications"].includes(section));

  return (
    <>
      {role === "admin" && section !== "profile" && !granted && (
        <div
          className="mb-4 flex items-start gap-2 rounded-lg border border-[#D6E8DE] bg-[#F0F7F3] px-4 py-3 text-[13px] leading-5 text-[#315C46]"
          role="status"
        >
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p>
            Your Admin account has view access. Extra administrative tasks are enabled individually by your Super Admin in Settings → Roles &amp; Permissions.
          </p>
        </div>
      )}
      <div>{children}</div>
    </>
  );
}
