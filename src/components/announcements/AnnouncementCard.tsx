"use client";
import { Eye, MoreHorizontal, Pencil } from "lucide-react";
import { announcementDate, type Announcement } from "./AnnouncementsData";
import AnnouncementBadge from "./AnnouncementBadge";

export default function AnnouncementCard({ announcement, canManage, onView, onEdit, onActions }: {
  announcement: Announcement; canManage: boolean; onView: () => void; onEdit: () => void; onActions: () => void;
}) {
  const dateLabel = announcement.status === "scheduled" ? "Scheduled" : announcement.publishedAt ? "Published" : "Created";
  const date = announcement.scheduledAt ?? announcement.publishedAt ?? announcement.createdAt;
  return <article className="min-w-0 rounded-[14px] border border-[#E2E8F0] bg-white p-4 shadow-sm transition-colors hover:border-[#C5D8CE] sm:p-5">
    <div className="flex flex-wrap items-start justify-between gap-3"><h2 className="min-w-0 flex-1 break-words text-[15px] font-semibold leading-6 text-[#17212F]">{announcement.title}</h2><AnnouncementBadge status={announcement.status} /></div>
    <p className="mt-2 line-clamp-2 whitespace-pre-wrap break-words text-sm leading-6 text-[#64748B]">{announcement.content || "No content added to this draft yet."}</p>
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-[#64748B]"><span className="rounded-md bg-[#F0F6F2] px-2 py-1 font-medium text-[#315C46]">{announcement.category}</span><span>{dateLabel}: <time dateTime={date}>{announcementDate(date)}</time></span>{announcement.author && <span>By {announcement.author}</span>}</div>
    <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[#F1F5F9] pt-3">
      <button type="button" onClick={onView} className="announcement-secondary"><Eye className="h-3.5 w-3.5" />View</button>
      {canManage && announcement.status !== "archived" && <button type="button" onClick={onEdit} className="announcement-secondary"><Pencil className="h-3.5 w-3.5" />Edit</button>}
      {canManage && <button type="button" onClick={onActions} aria-label={`More actions for ${announcement.title}`} className="announcement-secondary ml-auto"><MoreHorizontal className="h-4 w-4" />More Actions</button>}
    </div>
  </article>;
}
