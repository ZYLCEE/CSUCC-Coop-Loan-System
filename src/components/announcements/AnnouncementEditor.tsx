"use client";

import { Input, Select, Textarea } from "@/components/ui/Fields";
import { useRef, useState } from "react";
import { ImageOff, LoaderCircle, Megaphone } from "lucide-react";
import { manageAnnouncement, type AnnouncementPayload } from "@/lib/announcements";
import { announcementDate, contentLimit, manilaDateInput, manilaInputToIso, titleLimit, type Announcement, type AnnouncementCategory, type AnnouncementStatus } from "./AnnouncementsData";
import { FormDialog } from "@/components/ui/FormDialog";
import { ConfirmActionDialog } from "@/components/ui/ConfirmActionDialog";
import AnnouncementPreview from "./AnnouncementPreview";

const control = "w-full";
const label = "mb-1 block text-label text-portal-primary";
export default function AnnouncementEditor({ userId, announcement, categories, initialStatus, schedulingEnabled, notificationsEnabled, onClose, onSaved }: {
  userId: string; announcement?: Announcement; categories: AnnouncementCategory[];
  initialStatus?: Exclude<AnnouncementStatus, "archived">; schedulingEnabled: boolean; notificationsEnabled: boolean; onClose: () => void; onSaved: () => void;
}) {
  const [id] = useState(() => announcement?.id ?? crypto.randomUUID());
  const [title, setTitle] = useState(announcement?.title ?? "");
  const [content, setContent] = useState(announcement?.content ?? "");
  const [category, setCategory] = useState(announcement?.categoryId ?? categories.find((item) => item.id === "general")?.id ?? categories[0]?.id ?? "");
  const [status, setStatus] = useState<Exclude<AnnouncementStatus, "archived">>(initialStatus ?? (announcement?.status === "archived" ? "draft" : announcement?.status) ?? "draft");
  const [schedule, setSchedule] = useState(announcement?.scheduledAt ? manilaDateInput(announcement.scheduledAt) : "");
  const [notify, setNotify] = useState(announcement?.notifyMembers ?? false);
  const [dirty, setDirty] = useState(false);
  const [pendingPayload, setPendingPayload] = useState<AnnouncementPayload | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState("");
  const published = announcement?.status === "published";
  const selectedCategory = category || categories.find((item) => item.id === "general")?.id || categories[0]?.id || "";
  const actionLabel = published ? "Save Changes" : status === "published" ? "Publish Announcement" : status === "scheduled" ? "Schedule Announcement" : "Save Draft";
  const edited = () => { setDirty(true); setError(""); };
  const save = async (payload: AnnouncementPayload) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError("");
    try { await manageAnnouncement(userId, "save", id, announcement?.updatedAt ?? null, payload); onSaved(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Unable to save this announcement. Please retry."); setPendingPayload(null); }
    finally { busyRef.current = false; setBusy(false); }
  };
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const scheduledAt = status === "scheduled" ? manilaInputToIso(schedule) : null;
    if (!title.trim()) { setError("Enter an announcement title."); return; }
    if (!categories.some((item) => item.id === selectedCategory)) { setError("Select an available announcement category."); return; }
    if (status === "scheduled" && !schedulingEnabled) { setError("Scheduled publication is unavailable. Save a draft or publish now."); return; }
    if (status !== "draft" && !content.trim()) { setError("Add announcement content before publishing or scheduling."); return; }
    if (status === "scheduled" && (!scheduledAt || Date.parse(scheduledAt) <= Date.now())) { setError("Choose a valid future date and time in Philippine time."); return; }
    const payload: AnnouncementPayload = { title: title.trim(), content: content.trim(), category_id: selectedCategory,
      status: published ? "published" : status, scheduled_at: scheduledAt, notify_members: status === "draft" ? false : notify };
    setError(""); setPendingPayload(payload);
  };
  return <FormDialog icon={Megaphone} title={announcement ? "Edit Announcement" : "New Announcement"} className="max-w-[1080px]" dirty={dirty} busy={busy} onClose={onClose} footer={<>
    <button type="button" data-dialog-close className="ui-button" disabled={busy}>Cancel</button>
    <button type="submit" form="announcement-editor" disabled={busy || !!pendingPayload || categories.length === 0} className="ui-button ui-button--primary">{busy && <LoaderCircle className="size-icon animate-spin motion-reduce:animate-none" aria-hidden="true" />}{busy ? "Saving..." : actionLabel}</button>
  </>}>
    {error && <p role="alert" className="ui-action-feedback ui-action-feedback--error mb-4">{error}</p>}
    {pendingPayload && <ConfirmActionDialog title={`Confirm ${actionLabel}`} confirmLabel={actionLabel} cancelLabel="Back to editing"
      question={published ? "Your changes will be visible to members immediately." : status === "draft" ? "Save this announcement as a private draft?" : status === "published" ? "This announcement will become visible to active members now." : `Publication is scheduled for ${announcementDate(pendingPayload.scheduled_at!)} (Philippine time).`}
      details={[{ label: "Title", value: title }, { label: "Category", value: categories.find(item => item.id === selectedCategory)?.name ?? selectedCategory },
        { label: "Notify members", value: pendingPayload.notify_members ? "One notification after successful publication" : "No new notification" }]}
      busy={busy} error={error} onClose={() => setPendingPayload(null)} onConfirm={() => save(pendingPayload)} />}
    <div className="grid min-w-0 gap-5 min-[64rem]:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <form id="announcement-editor" onSubmit={submit} className="min-w-0"><fieldset disabled={busy || !!pendingPayload} className="min-w-0 space-y-4">
        <div><label htmlFor="announcement-title" className={label}>Announcement Title <span className="text-red-600">*</span></label><Input id="announcement-title" value={title} maxLength={titleLimit} required onChange={(event) => { setTitle(event.target.value); edited(); }} placeholder="Enter announcement title..." className={control} /><p className="mt-1 text-right text-[10px] text-portal-secondary">{title.length}/{titleLimit}</p></div>
        <div><label htmlFor="announcement-category" className={label}>Category</label><Select id="announcement-category" value={selectedCategory} disabled={categories.length === 0} onChange={(event) => { setCategory(event.target.value); edited(); }} className={control}>{categories.length ? categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>) : <option value="">Categories unavailable</option>}</Select>{categories.length === 0 && <p className="mt-1 text-xs leading-5 text-amber-700">Enable the announcements service and refresh the page to save announcements.</p>}</div>
        <div><label htmlFor="announcement-content" className={label}>Announcement Content {status !== "draft" && <span className="text-red-600">*</span>}</label><Textarea id="announcement-content" rows={7} maxLength={contentLimit} value={content} onChange={(event) => { setContent(event.target.value); edited(); }} placeholder="Write the announcement details..." className={`${control} min-h-40 resize-y`} /><p className="mt-1 text-right text-[10px] text-portal-secondary">{content.length.toLocaleString()}/{contentLimit.toLocaleString()}</p></div>
        <div className="rounded-lg border border-dashed border-[#D1D5DB] p-3"><p className="flex items-center gap-2 text-xs font-semibold text-portal-secondary"><ImageOff className="h-4 w-4" />Cover Image (Optional)</p><p className="mt-1 text-xs leading-5 text-portal-secondary">Cover uploads aren’t available yet. You can publish a text announcement.</p></div>
        {!published && <fieldset className="min-w-0"><legend className={label}>Publishing Options</legend><div className="space-y-2">{([{ value: "published", label: "Publish Now" }, { value: "scheduled", label: "Schedule for Later" }, { value: "draft", label: "Save as Draft" }] as const).map((option) => <label key={option.value} className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm ${status === option.value ? "border-[#145B3C] bg-[#F0F7F3] text-[#145B3C]" : "border-portal-border text-portal-secondary"}`}><input type="radio" name="announcement-status" value={option.value} checked={status === option.value} disabled={option.value === "scheduled" && !schedulingEnabled} onChange={() => { setStatus(option.value); edited(); }} className="accent-[#145B3C]" />{option.label}{option.value === "scheduled" && !schedulingEnabled && <span className="text-[10px]">(unavailable)</span>}</label>)}</div></fieldset>}
        {status === "scheduled" && <div><label htmlFor="announcement-schedule" className={label}>Publication date and time</label><Input id="announcement-schedule" type="datetime-local" value={schedule} required onChange={(event) => { setSchedule(event.target.value); edited(); }} className={control} /><p className="mt-1 text-xs leading-5 text-portal-secondary">Philippine time (Asia/Manila). Publication runs through the configured server scheduler.</p></div>}
        <div><label className="flex items-start gap-2 text-xs leading-6 text-[#334155]"><input type="checkbox" checked={status !== "draft" && notify} disabled={status === "draft" || published || !notificationsEnabled} onChange={(event) => { setNotify(event.target.checked); edited(); }} className="mt-1.5 accent-[#145B3C]" />Notify members about this announcement</label><p className="mt-1 text-[11px] leading-5 text-portal-secondary">{published ? "Notification preferences are fixed after first publication." : status === "draft" ? "Drafts are private and do not send notifications." : "Sent after successful publication. Scheduled announcements notify members when published."}</p></div>
      </fieldset></form>
      <AnnouncementPreview title={title} content={content} category={categories.find((item) => item.id === selectedCategory)?.name ?? ""} date={status === "scheduled" ? manilaInputToIso(schedule) : announcement?.publishedAt} />
    </div>
  </FormDialog>;
}
