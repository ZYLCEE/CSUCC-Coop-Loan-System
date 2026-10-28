"use client";

interface MembersPaginationProps {
  currentPage: number;
  totalPages: number;
  totalItems: number;
  showingFrom: number;
  showingTo: number;
  onPageChange: (page: number) => void;
  itemLabel?: string;
}

export default function MembersPagination({
  currentPage,
  totalPages,
  totalItems,
  showingFrom,
  showingTo,
  onPageChange,
  itemLabel = "members",
}: MembersPaginationProps) {
  return (
    <div className="flex min-h-[58px] flex-col gap-2 border-t border-[#E5E7EB] px-8 py-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-[13px] font-medium text-[#64748B]">
        Showing {showingFrom}-{showingTo} of {totalItems.toLocaleString()} {itemLabel}
      </p>
      <div className="flex flex-wrap items-center gap-1">
        {Array.from({ length: totalPages }, (_, index) => index + 1).map((page) => (
          <button
            key={page}
            type="button"
            onClick={() => onPageChange(page)}
            className={`flex h-8 w-8 items-center justify-center rounded-full text-[13px] font-semibold transition-colors ${
              currentPage === page
                ? "bg-[#155D3B] text-white"
                : "text-[#6B7280] hover:bg-[#F1F5F9]"
            }`}
          >
            {page}
          </button>
        ))}
      </div>
    </div>
  );
}
