"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Eye, FileCheck2, Files, MoreVertical } from "lucide-react";
import { LoanApplication } from "@/lib/api";
import MembersPagination from "@/components/members/MembersPagination";
import MembershipTypeBadge from "@/components/shared/MembershipTypeBadge";
import { useSecureAdminAction } from "@/components/auth/SecureAdminActionProvider";
import LoanDocumentsModal from "./LoanDocumentsModal";

interface LoanApplicationsTableProps {
  applications: LoanApplication[];
  currentPage: number;
  totalPages: number;
  totalItems: number;
  showingFrom: number;
  showingTo: number;
  hasActiveFilters: boolean;
  readOnly?: boolean;
  onPageChange: (page: number) => void;
  onApplicationUpdated: () => void;
}

interface ActionMenuState {
  id: string;
  top: number;
  left: number;
}

const statusStyles: Record<LoanApplication["status"], string> = {
  Pending: "bg-[#FFFBEB] text-[#B45309] border-[#FDE68A]",
  "Under Review": "bg-blue-50 text-blue-600 border-blue-200",
  Approved: "bg-green-50 text-green-600 border-green-200",
  Rejected: "bg-red-50 text-red-600 border-red-200",
  Released: "bg-teal-50 text-teal-600 border-teal-200",
  Completed: "bg-gray-50 text-gray-600 border-gray-200",
  Overdue: "bg-red-100 text-red-700 border-red-300",
};

const formatAmount = (amount: string) => {
  const numericAmount = Number(amount.replace(/[^\d.-]/g, ""));

  if (!Number.isFinite(numericAmount)) {
    return amount;
  }

  return `₱${numericAmount.toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
};

const formatDate = (date: string) => {
  const parsedDate = Date.parse(date);

  if (Number.isNaN(parsedDate)) {
    return date;
  }

  return new Date(parsedDate).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};

export default function LoanApplicationsTable({
  applications,
  currentPage,
  totalPages,
  totalItems,
  showingFrom,
  showingTo,
  hasActiveFilters,
  readOnly = false,
  onPageChange,
  onApplicationUpdated,
}: LoanApplicationsTableProps) {
  const [openMenu, setOpenMenu] = useState<ActionMenuState | null>(null);
  const [documentApplicationId, setDocumentApplicationId] = useState<string | null>(null);
  const { beginSecureAction } = useSecureAdminAction();
  const menuRef = useRef<HTMLDivElement>(null);
  const selectedApplication = openMenu
    ? applications.find((application) => application.id === openMenu.id)
    : null;

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement;

      if (target.closest("[data-loan-action-button='true']")) {
        return;
      }

      if (menuRef.current && !menuRef.current.contains(target)) {
        setOpenMenu(null);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenMenu(null);
      }
    };

    const closeOnViewportChange = () => setOpenMenu(null);

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    window.addEventListener("resize", closeOnViewportChange);
    window.addEventListener("scroll", closeOnViewportChange, true);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
      window.removeEventListener("resize", closeOnViewportChange);
      window.removeEventListener("scroll", closeOnViewportChange, true);
    };
  }, []);

  const handleActionButtonClick = (
    application: LoanApplication,
    event: React.MouseEvent<HTMLButtonElement>
  ) => {
    if (openMenu?.id === application.id) {
      setOpenMenu(null);
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    const menuWidth = 214;

    setOpenMenu({
      id: application.id,
      top: rect.bottom + 6,
      left: Math.max(12, Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 12)),
    });
  };

  const handleMenuAction = (action: string, application: LoanApplication) => {
    setOpenMenu(null);
    if (action === "view documents") {
      setDocumentApplicationId(application.id);
      return;
    }

    if (action === "review application") {
      beginSecureAction({
        action: "review-loan",
        target: application.id,
        title: "Review Loan Application",
        question: `Move ${application.id} to Under Review?`,
        confirmLabel: "Start Review",
        successMessage: "Loan application moved to Under Review.",
        payload: {},
        details: [
          { label: "Application ID", value: application.id },
          { label: "Member", value: application.member },
          { label: "Amount", value: formatAmount(application.amount) },
        ],
        onSuccess: onApplicationUpdated,
      });
      return;
    }

    if (action === "approve application") {
      beginSecureAction({
        action: "approve-loan",
        target: application.id,
        title: "Approve Loan Application",
        question: `Approve ${application.id} for ${formatAmount(application.amount)}? The member's status, loan policy, and required documents will be checked first.`,
        confirmLabel: "Approve Loan",
        successMessage: "Loan application approved successfully.",
        payload: {},
        details: [
          { label: "Application ID", value: application.id },
          { label: "Member", value: application.member },
          { label: "Amount", value: formatAmount(application.amount) },
          { label: "Current Status", value: application.status },
        ],
        onSuccess: onApplicationUpdated,
      });
      return;
    }

    window.alert(`Frontend only: ${action} for ${application.id}.`);
  };

  return (
    <div className="relative">
      {documentApplicationId && <LoanDocumentsModal key={documentApplicationId} applicationId={documentApplicationId} onClose={() => setDocumentApplicationId(null)} />}
      <div className="overflow-x-auto border-t border-[#E5E7EB]">
        <table className="w-full min-w-[1000px] table-fixed">
          <colgroup>
            <col className="w-[13%]" />
            <col className="w-[15%]" />
            <col className="w-[13%]" />
            <col className="w-[12%]" />
            <col className="w-[12%]" />
            <col className="w-[14%]" />
            <col className="w-[14%]" />
            <col className="w-[7%]" />
          </colgroup>
          <thead>
            <tr className="h-11 border-b border-[#E5E7EB] bg-[#F8FAFC]">
              <th className="px-3 text-left text-[10px] font-semibold uppercase tracking-wide text-[#64748B]">
                Application ID
              </th>
              <th className="px-3 text-left text-[10px] font-semibold uppercase tracking-wide text-[#64748B]">
                Member
              </th>
              <th className="px-3 text-left text-[10px] font-semibold uppercase tracking-wide text-[#64748B]">
                Loan Type
              </th>
              <th className="px-2 text-center text-[10px] font-semibold uppercase tracking-wide text-[#64748B]">
                Membership Type
              </th>
              <th className="px-3 text-left text-[10px] font-semibold uppercase tracking-wide text-[#64748B]">
                Amount
              </th>
              <th className="px-3 text-center text-[10px] font-semibold uppercase tracking-wide text-[#64748B]">
                Status
              </th>
              <th className="px-3 text-left text-[10px] font-semibold uppercase tracking-wide text-[#64748B]">
                Date Applied
              </th>
              <th className="px-3 text-center text-[10px] font-semibold uppercase tracking-wide text-[#64748B]">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {applications.length > 0 ? (
              applications.map((application) => (
                <tr
                  key={application.id}
                  className="h-[62px] border-b border-[#E5E7EB] transition-colors last:border-b-0 hover:bg-[#F8FAFC]"
                >
                  <td className="truncate whitespace-nowrap px-3 text-[13px] font-semibold text-[#155D3B]" title={application.id}>
                    {application.id}
                  </td>
                  <td className="px-3">
                    <p className="truncate whitespace-nowrap text-[13px] font-semibold text-[#0F172A]" title={application.member}>
                      {application.member}
                    </p>
                    <p className="mt-0.5 truncate whitespace-nowrap text-[11px] font-medium text-[#64748B]" title={application.memberId}>
                      {application.memberId || "No member ID"}
                    </p>
                  </td>
                  <td className="truncate whitespace-nowrap px-3 text-[13px] font-normal text-[#334155]" title={application.type}>
                    {application.type}
                  </td>
                  <td className="px-2 text-center">
                    <MembershipTypeBadge
                      membershipType={application.membershipType}
                    />
                  </td>
                  <td className="truncate whitespace-nowrap px-3 text-[13px] font-semibold text-[#0F172A]" title={application.amount}>
                    {formatAmount(application.amount)}
                  </td>
                  <td className="px-3 text-center">
                    <span
                      className={`inline-flex h-7 items-center rounded-full border px-3 text-[11px] font-semibold ${statusStyles[application.status]}`}
                    >
                      {application.status}
                    </span>
                  </td>
                  <td className="truncate whitespace-nowrap px-3 text-[13px] font-normal text-[#334155]" title={application.date}>
                    {formatDate(application.date)}
                  </td>
                  <td className="px-3">
                    <div className="flex justify-center">
                      <button
                        type="button"
                        data-loan-action-button="true"
                        onClick={(event) => handleActionButtonClick(application, event)}
                        className="flex h-[34px] w-[34px] items-center justify-center rounded-[8px] border border-[#D1D5DB] bg-white text-[#64748B] transition-colors hover:border-[#155D3B] hover:bg-[#F8FAFC] hover:text-[#155D3B] focus:outline-none focus:ring-2 focus:ring-[#155D3B]/20"
                        aria-label={`Open actions for ${application.id}`}
                        aria-expanded={openMenu?.id === application.id}
                      >
                        <MoreVertical className="h-[18px] w-[18px]" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center">
                  <p className="text-[14px] font-semibold text-[#334155]">
                    No loan applications found.
                  </p>
                  <p className="mt-1 text-[13px] text-[#64748B]">
                    {hasActiveFilters
                      ? "Try changing your search or filters."
                      : "No loan applications have been submitted yet."}
                  </p>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <MembersPagination
        currentPage={currentPage}
        totalPages={totalPages}
        totalItems={totalItems}
        showingFrom={showingFrom}
        showingTo={showingTo}
        onPageChange={onPageChange}
        itemLabel="applications"
      />

      {openMenu && selectedApplication && (
        <div
          ref={menuRef}
          style={{ top: openMenu.top, left: openMenu.left }}
          className="fixed z-[60] w-[214px] rounded-[10px] border border-[#E5E7EB] bg-white py-1.5 shadow-[0_12px_30px_rgba(15,23,42,0.16)]"
          role="menu"
        >
          <button
            type="button"
            onClick={() => handleMenuAction("view details", selectedApplication)}
            className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[12px] font-medium text-[#374151] transition-colors hover:bg-[#F8FAFC] hover:text-[#155D3B]"
            role="menuitem"
          >
            <Eye className="h-4 w-4" />
            View Details
          </button>
          {!readOnly &&
            (selectedApplication.status === "Pending" ||
            selectedApplication.status === "Under Review") && (
            <>
              {selectedApplication.status === "Pending" && <button
                type="button"
                onClick={() => handleMenuAction("review application", selectedApplication)}
                className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[12px] font-medium text-[#374151] transition-colors hover:bg-[#F8FAFC] hover:text-[#155D3B]"
                role="menuitem"
              >
                <FileCheck2 className="h-4 w-4" />
                Move to Under Review
              </button>}
              <button
                type="button"
                onClick={() => handleMenuAction("approve application", selectedApplication)}
                className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[12px] font-medium text-[#047857] transition-colors hover:bg-[#ECFDF5]"
                role="menuitem"
              >
                <CheckCircle2 className="h-4 w-4" />
                Approve Application
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => handleMenuAction("view documents", selectedApplication)}
            className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[12px] font-medium text-[#374151] transition-colors hover:bg-[#F8FAFC] hover:text-[#155D3B]"
            role="menuitem"
          >
            <Files className="h-4 w-4" />
            View Documents
          </button>
        </div>
      )}
    </div>
  );
}
