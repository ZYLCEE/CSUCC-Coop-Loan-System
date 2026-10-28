"use client";

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  totalItems: number;
  onPageChange: (page: number) => void;
}

export default function Pagination({ currentPage, totalPages, totalItems, onPageChange }: PaginationProps) {
  return (
    <div className="flex items-center justify-between px-3 py-2 border-t border-[#E5E7EB]">
      <p className="text-[12px] text-[#6B7280]">Showing 6 of {totalItems.toLocaleString()} members</p>
      <div className="flex items-center gap-1">
        {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
          <button
            key={page}
            onClick={() => onPageChange(page)}
            className={`w-7 h-7 rounded-full flex items-center justify-center text-[12px] font-medium transition-colors ${
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
