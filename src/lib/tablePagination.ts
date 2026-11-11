export type DateSortOrder = "Newest" | "Oldest";

export function sortRowsByDate<T>(rows: readonly T[], date: (row: T) => unknown, order: DateSortOrder): T[] {
  return [...rows].sort((first, second) => {
    const a = Date.parse(String(date(first) ?? ""));
    const b = Date.parse(String(date(second) ?? ""));
    if (!Number.isFinite(a)) return Number.isFinite(b) ? 1 : 0;
    if (!Number.isFinite(b)) return -1;
    return order === "Oldest" ? a - b : b - a;
  });
}

export function paginationPages(currentPage: number, totalPages: number): (number | null)[] {
  const total = Math.max(1, totalPages);
  const current = Math.min(Math.max(1, currentPage), total);
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);
  if (current <= 4) return [1, 2, 3, 4, 5, null, total];
  if (current >= total - 3) return [1, null, total - 4, total - 3, total - 2, total - 1, total];
  return [1, null, current - 1, current, current + 1, null, total];
}
