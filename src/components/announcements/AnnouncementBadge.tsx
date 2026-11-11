import { announcementStatusLabels, type AnnouncementStatus } from "./AnnouncementsData";
import { StatusBadge } from "@/components/ui/StatusBadge";

export default function AnnouncementBadge({ status }: { status: AnnouncementStatus }) {
  return <StatusBadge status={status} label={announcementStatusLabels[status]} className="shrink-0" />;
}
