"use client";

import { useEffect, useRef, useState } from "react";
import {
  CalendarDays,
  Eye,
  History,
  MoreVertical,
  Printer,
  UserRound,
} from "lucide-react";
import { ActiveLoan } from "./ActiveLoansData";
import LoanStatusBadge from "./LoanStatusBadge";
import MembersPagination from "@/components/members/MembersPagination";

interface ActiveLoansTableProps {
  loans: ActiveLoan[];
  currentPage: number;
  totalPages: number;
  totalItems: number;
  showingFrom: number;
  showingTo: number;
  hasActiveFilters: boolean;
  onPageChange: (page: number) => void;
}

interface ActionMenuState {
  loanNumber: string;
  top: number;
  left: number;
}

const formatCurrency = (amount: string) => {
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

export default function ActiveLoansTable({
  loans,
  currentPage,
  totalPages,
  totalItems,
  showingFrom,
  showingTo,
  hasActiveFilters,
  onPageChange,
}: ActiveLoansTableProps) {
  const [openMenu, setOpenMenu] = useState<ActionMenuState | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const selectedLoan = openMenu
    ? loans.find((loan) => loan.loanNumber === openMenu.loanNumber)
    : null;

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement;

      if (target.closest("[data-active-loan-action-button='true']")) {
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
    loan: ActiveLoan,
    event: React.MouseEvent<HTMLButtonElement>
  ) => {
    if (openMenu?.loanNumber === loan.loanNumber) {
      setOpenMenu(null);
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    const menuWidth = 230;

    setOpenMenu({
      loanNumber: loan.loanNumber,
      top: rect.bottom + 6,
      left: Math.max(12, Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 12)),
    });
  };

  const handleMenuAction = (action: string, loan: ActiveLoan) => {
    window.alert(`Frontend only: ${action} for ${loan.loanNumber}.`);
    setOpenMenu(null);
  };

  return (
    <div className="relative">
      <div className="overflow-hidden border-t border-[#E5E7EB]">
        <table className="w-full table-fixed">
          <colgroup>
            <col className="w-[19%]" />
            <col className="w-[11%]" />
            <col className="w-[14%]" />
            <col className="w-[14%]" />
            <col className="w-[12%]" />
            <col className="w-[14%]" />
            <col className="w-[9%]" />
            <col className="w-[7%]" />
          </colgroup>
          <thead>
            <tr className="h-11 border-b border-[#E5E7EB] bg-[#F8FAFC]">
              <th className="px-3 text-left text-[10px] font-semibold uppercase tracking-wide text-[#64748B]">
                Loan / Member
              </th>
              <th className="px-3 text-left text-[10px] font-semibold uppercase tracking-wide text-[#64748B]">
                Loan Type
              </th>
              <th className="px-3 text-left text-[10px] font-semibold uppercase tracking-wide text-[#64748B]">
                Original Amount
              </th>
              <th className="px-3 text-left text-[10px] font-semibold uppercase tracking-wide text-[#64748B]">
                Balance
              </th>
              <th className="px-3 text-left text-[10px] font-semibold uppercase tracking-wide text-[#64748B]">
                Monthly Due
              </th>
              <th className="px-3 text-left text-[10px] font-semibold uppercase tracking-wide text-[#64748B]">
                Next Due
              </th>
              <th className="px-3 text-center text-[10px] font-semibold uppercase tracking-wide text-[#64748B]">
                Status
              </th>
              <th className="px-3 text-center text-[10px] font-semibold uppercase tracking-wide text-[#64748B]">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {loans.length > 0 ? (
              loans.map((loan) => (
                <tr
                  key={loan.loanNumber}
                  className="h-[68px] border-b border-[#E5E7EB] transition-colors last:border-b-0 hover:bg-[#F8FAFC]"
                >
                  <td className="px-3">
                    <p className="truncate whitespace-nowrap text-[11px] font-semibold text-[#155D3B]" title={loan.loanNumber}>
                      {loan.loanNumber}
                    </p>
                    <p className="mt-0.5 truncate whitespace-nowrap text-[13px] font-semibold text-[#0F172A]" title={loan.memberName}>
                      {loan.memberName}
                    </p>
                    <p className="mt-0.5 truncate whitespace-nowrap text-[11px] font-medium text-[#64748B]" title={loan.memberId}>
                      {loan.memberId}
                    </p>
                  </td>
                  <td className="truncate whitespace-nowrap px-3 text-[13px] font-normal text-[#334155]" title={loan.type}>
                    {loan.type}
                  </td>
                  <td className="truncate whitespace-nowrap px-3 text-[13px] font-semibold text-[#0F172A]" title={loan.originalAmount}>
                    {formatCurrency(loan.originalAmount)}
                  </td>
                  <td className="truncate whitespace-nowrap px-3 text-[13px] font-bold text-[#0F172A]" title={loan.balance}>
                    {formatCurrency(loan.balance)}
                  </td>
                  <td className="truncate whitespace-nowrap px-3 text-[13px] font-normal text-[#334155]" title={loan.monthlyDue}>
                    {formatCurrency(loan.monthlyDue)}
                  </td>
                  <td
                    className={`truncate whitespace-nowrap px-3 text-[13px] font-normal ${
                      loan.status === "Overdue" ? "text-[#DC2626]" : "text-[#334155]"
                    }`}
                    title={loan.nextDue}
                  >
                    {formatDate(loan.nextDue)}
                  </td>
                  <td className="px-3 text-center">
                    <LoanStatusBadge status={loan.status} />
                  </td>
                  <td className="px-3">
                    <div className="flex justify-center">
                      <button
                        type="button"
                        data-active-loan-action-button="true"
                        onClick={(event) => handleActionButtonClick(loan, event)}
                        className="flex h-[34px] w-[34px] items-center justify-center rounded-[8px] border border-[#D1D5DB] bg-white text-[#64748B] transition-colors hover:border-[#155D3B] hover:bg-[#F8FAFC] hover:text-[#155D3B] focus:outline-none focus:ring-2 focus:ring-[#155D3B]/20"
                        aria-label={`Open actions for ${loan.loanNumber}`}
                        aria-expanded={openMenu?.loanNumber === loan.loanNumber}
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
                    No active loans found.
                  </p>
                  <p className="mt-1 text-[13px] text-[#64748B]">
                    {hasActiveFilters
                      ? "Try changing your search or filters."
                      : "There are currently no active loans."}
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
        itemLabel="active loans"
      />

      {openMenu && selectedLoan && (
        <div
          ref={menuRef}
          style={{ top: openMenu.top, left: openMenu.left }}
          className="fixed z-[60] w-[230px] rounded-[10px] border border-[#E5E7EB] bg-white py-1.5 shadow-[0_12px_30px_rgba(15,23,42,0.16)]"
          role="menu"
        >
          <button
            type="button"
            onClick={() => handleMenuAction("view loan details", selectedLoan)}
            className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[12px] font-medium text-[#374151] transition-colors hover:bg-[#F8FAFC] hover:text-[#155D3B]"
            role="menuitem"
          >
            <Eye className="h-4 w-4" />
            View Loan Details
          </button>
          <button
            type="button"
            onClick={() => handleMenuAction("payment schedule", selectedLoan)}
            className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[12px] font-medium text-[#374151] transition-colors hover:bg-[#F8FAFC] hover:text-[#155D3B]"
            role="menuitem"
          >
            <CalendarDays className="h-4 w-4" />
            Payment Schedule
          </button>
          <button
            type="button"
            onClick={() => handleMenuAction("payment history", selectedLoan)}
            className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[12px] font-medium text-[#374151] transition-colors hover:bg-[#F8FAFC] hover:text-[#155D3B]"
            role="menuitem"
          >
            <History className="h-4 w-4" />
            Payment History
          </button>
          <button
            type="button"
            onClick={() => handleMenuAction("member details", selectedLoan)}
            className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[12px] font-medium text-[#374151] transition-colors hover:bg-[#F8FAFC] hover:text-[#155D3B]"
            role="menuitem"
          >
            <UserRound className="h-4 w-4" />
            Member Details
          </button>
          <div className="my-1 border-t border-[#F1F5F9]" />
          <button
            type="button"
            onClick={() => handleMenuAction("print or export loan details", selectedLoan)}
            className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[12px] font-medium text-[#374151] transition-colors hover:bg-[#F8FAFC] hover:text-[#155D3B]"
            role="menuitem"
          >
            <Printer className="h-4 w-4" />
            Print / Export Loan Details
          </button>
        </div>
      )}
    </div>
  );
}
