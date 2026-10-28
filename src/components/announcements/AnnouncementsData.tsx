export type AnnouncementStatus = "published" | "scheduled" | "draft" | "archived";
export type AnnouncementFilter = "all" | AnnouncementStatus;
export interface AnnouncementCategory { id: string; name: string }
export interface Announcement {
  id: string; title: string; content: string; categoryId: string; category: string;
  status: AnnouncementStatus; createdAt: string; updatedAt: string;
  publishedAt: string | null; scheduledAt: string | null; author: string | null; notifyMembers: boolean;
}
export const announcementFilters: { value: AnnouncementFilter; label: string }[] = [
  { value: "all", label: "All" }, { value: "published", label: "Published" },
  { value: "scheduled", label: "Scheduled" }, { value: "draft", label: "Drafts" }, { value: "archived", label: "Archived" },
];
export const announcementStatusLabels: Record<AnnouncementStatus, string> = {
  published: "Published", scheduled: "Scheduled", draft: "Draft", archived: "Archived",
};
export const announcementTimezone = "Asia/Manila";
export const titleLimit = 160;
export const contentLimit = 20000;
export function announcementDate(value: string) {
  return new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "short", timeZone: announcementTimezone }).format(new Date(value));
}
export function manilaDateInput(value: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: announcementTimezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(value));
  const part = (name: string) => parts.find((part) => part.type === name)?.value;
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}
export function manilaInputToIso(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const date = new Date(`${value}:00+08:00`);
  if (!Number.isFinite(date.getTime()) || manilaDateInput(date.toISOString()) !== value) return null;
  return date.toISOString();
}
