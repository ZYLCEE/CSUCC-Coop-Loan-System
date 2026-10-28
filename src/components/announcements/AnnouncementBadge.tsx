import { announcementStatusLabels, type AnnouncementStatus } from "./AnnouncementsData";
const styles: Record<AnnouncementStatus, string> = {
  published: "border-green-200 bg-green-50 text-green-700",
  scheduled: "border-amber-200 bg-amber-50 text-amber-700",
  draft: "border-slate-200 bg-slate-50 text-slate-600",
  archived: "border-gray-200 bg-gray-100 text-gray-600",
};
export default function AnnouncementBadge({ status }: { status: AnnouncementStatus }) {
  return <span className={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-1 text-[11px] font-medium ${styles[status]}`}>{announcementStatusLabels[status]}</span>;
}
