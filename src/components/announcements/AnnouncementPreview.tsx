import { CalendarDays, Megaphone, Smartphone } from "lucide-react";
import { announcementDate } from "./AnnouncementsData";
export default function AnnouncementPreview({ title, content, category, date }: { title: string; content: string; category: string; date?: string | null }) {
  return <aside aria-label="Member app announcement preview" className="min-w-0 rounded-xl border border-[#E2E8F0] bg-[#F8FAF9] p-4">
    <h3 className="flex items-center gap-2 text-sm font-semibold"><Smartphone className="h-4 w-4 text-[#145B3C]" />Member App Preview</h3>
    <p className="mt-1 text-xs leading-5 text-[#64748B]">Preview only — not yet published</p>
    <div className="mx-auto mt-5 w-full max-w-[340px] overflow-hidden rounded-[20px] border border-[#DDE6DF] bg-[#F3F5F4] shadow-sm">
      <div className="bg-[#206A3B] px-4 py-5"><p className="text-xs font-bold tracking-[0.12em] text-[#E7C84B]">CSUCC MPC</p><p className="mt-1 text-xs text-white/90">Cooperative Announcements</p></div>
      <div className="p-3"><div className="rounded-[18px] border border-[#E6E6E6] bg-white p-4">
        <span className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-[#EDF5EF] px-2 py-1 text-[10px] font-semibold text-[#206A3B]"><Megaphone className="h-3 w-3 shrink-0" /><span className="break-words">{category || "Category"}</span></span>
        <h4 className="mt-3 break-words text-base font-bold leading-6 text-[#153D22]">{title.trim() || "Announcement title"}</h4>
        <p className="mt-2 whitespace-pre-wrap break-words text-xs leading-6 text-[#7C8B82]">{content.trim() || "Your announcement details will appear here as you write."}</p>
        <p className="mt-4 flex items-start gap-1.5 border-t border-[#E6E6E6] pt-3 text-[10px] leading-5 text-[#7C8B82]"><CalendarDays className="mt-1 h-3 w-3 shrink-0" />{date ? announcementDate(date) : "Publication date appears after publishing"}</p>
      </div></div>
    </div>
  </aside>;
}
