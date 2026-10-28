"use client";

import { ReactNode } from "react";
import { Info } from "lucide-react";
import { useAdminAuth } from "@/components/auth/AdminAuthProvider";

const editableSections = new Set(["dashboard", "all-accounts", "loan-applications", "profile"]);

export default function AdminReadOnlySection({
  section,
  children,
}: {
  section: string;
  children: ReactNode;
}) {
  const { role } = useAdminAuth();
  const readOnly = role === "admin" && !editableSections.has(section);

  return (
    <>
      {readOnly && (
        <div
          className="mb-4 flex items-start gap-2 rounded-lg border border-[#D6E8DE] bg-[#F0F7F3] px-4 py-3 text-[13px] leading-5 text-[#315C46]"
          role="status"
        >
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p>
            This section is view-only for Admin accounts. Administrative changes
            are not enabled until the cooperative confirms the Admin permissions.
          </p>
        </div>
      )}
      <div inert={readOnly}>{children}</div>
    </>
  );
}
