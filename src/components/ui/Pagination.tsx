import type { ReactNode } from "react";
import { Button } from "./Button";
import { Select } from "./Fields";
import { paginationPages } from "@/lib/tablePagination";

export function PaginationControls<Sort extends string>({
  sortOption, pageSize, onSortChange, onPageSizeChange, sortOptions,
  sortLabel = "Sort records", pageSizeLabel = "Records per page", disabled = false,
}: {
  sortOption: Sort;
  pageSize: number;
  onSortChange: (value: Sort) => void;
  onPageSizeChange: (value: number) => void;
  sortOptions?: readonly Sort[];
  sortLabel?: string;
  pageSizeLabel?: string;
  disabled?: boolean;
}) {
  const options: readonly string[] = sortOptions ?? ["Newest", "Oldest"];
  return <div className="mr-2 flex max-w-full flex-wrap items-center gap-2">
    <Select value={sortOption} onChange={event => onSortChange(event.target.value as Sort)} size="compact"
      className="w-[108px]" aria-label={sortLabel} disabled={disabled}>
      {options.map(option => <option key={option} value={option}>{option}</option>)}
    </Select>
    <Select value={pageSize} onChange={event => onPageSizeChange(Number(event.target.value))} size="compact"
      className="w-[124px]" aria-label={pageSizeLabel} disabled={disabled}>
      {[10, 15, 25].map(size => <option key={size} value={size}>{size} per page</option>)}
    </Select>
  </div>;
}

type PaginationProps = {
  currentPage: number;
  totalPages: number;
  totalItems: number;
  showingFrom: number;
  showingTo: number;
  onPageChange: (page: number) => void;
  itemLabel?: string;
  controls?: ReactNode;
  showStepButtons?: boolean;
  mode?: "numbered" | "summary";
  label?: string;
};

export function Pagination({
  currentPage, totalPages, totalItems, showingFrom, showingTo, onPageChange,
  itemLabel = "records", controls, showStepButtons = true, mode = "numbered", label = "Pagination",
}: PaginationProps) {
  const stepButtons = showStepButtons || mode === "summary";
  const hasVisibleRows = totalItems > 0 && showingTo >= showingFrom;
  return (
    <nav aria-label={label} className="flex flex-col gap-3 border-t border-portal-border bg-surface-card px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
      <p aria-live="polite" aria-atomic="true" className="shrink-0 text-support text-portal-muted">
        Showing {hasVisibleRows ? showingFrom : 0}-{hasVisibleRows ? showingTo : 0} of {totalItems.toLocaleString()} {itemLabel}
      </p>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {controls}
        {stepButtons && (
          <Button size="compact" aria-label="Previous page" disabled={currentPage <= 1} onClick={() => onPageChange(currentPage - 1)}>
            {mode === "summary" ? "Previous" : "« Prev"}
          </Button>
        )}
        {mode === "summary" ? (
          <span className="text-support text-portal-muted">Page {currentPage} of {totalPages}</span>
        ) : paginationPages(currentPage, totalPages).map((page, index) => page === null
          ? <span key={`ellipsis-${index}`} aria-hidden="true" className="px-1 text-support text-portal-muted">…</span>
          : <Button key={page} size="compact" variant={currentPage === page ? "primary" : "ghost"}
            className="min-w-control-compact px-1" aria-label={`Page ${page}`}
            aria-current={currentPage === page ? "page" : undefined} onClick={() => onPageChange(page)}>
            {page}
          </Button>
        )}
        {stepButtons && (
          <Button size="compact" aria-label="Next page" disabled={currentPage >= totalPages} onClick={() => onPageChange(currentPage + 1)}>
            {mode === "summary" ? "Next" : "Next »"}
          </Button>
        )}
      </div>
    </nav>
  );
}
