"use client";
import PortalPageHeading from "@/components/shared/PortalPageHeading";

import { Input } from "@/components/ui/Fields";
import { Card } from "@/components/ui/Card";
import { EmptyState, LoadingState } from "@/components/ui/Feedback";
import { Pagination, PaginationControls } from "@/components/ui/Pagination";
import type { DateSortOrder } from "@/lib/tablePagination";
import { useEffect, useRef, useState } from "react";
import { Megaphone, Plus, RefreshCw, Search, X } from "lucide-react";
import { useAdminAuth } from "@/components/auth/AdminAuthProvider";
import { announcementPageSize, fetchAnnouncementSetup, fetchAnnouncements, manageAnnouncement, type AnnouncementAction } from "@/lib/announcements";
import AnnouncementCard from "@/components/announcements/AnnouncementCard";
import AnnouncementBadge from "@/components/announcements/AnnouncementBadge";
import { ConfirmActionDialog } from "@/components/ui/ConfirmActionDialog";
import { ActionResultDialog } from "@/components/ui/ActionResultDialog";
import AnnouncementDialog from "@/components/announcements/AnnouncementDialog";
import AnnouncementEditor from "@/components/announcements/AnnouncementEditor";
import { announcementDate, announcementFilters, type Announcement, type AnnouncementCategory, type AnnouncementFilter, type AnnouncementStatus } from "@/components/announcements/AnnouncementsData";
import styles from "@/components/announcements/Announcements.module.css";

type EditState = { announcement?: Announcement; initialStatus?: Exclude<AnnouncementStatus, "archived"> };
type ConfirmState = { announcement: Announcement; action: Exclude<AnnouncementAction, "save"> };
const actionLabels = { archive: "Archive Announcement", restore: "Restore to Draft", cancel_schedule: "Cancel Schedule", delete: "Delete Draft" };
export default function AnnouncementsPage() {
  const { user, role } = useAdminAuth();
  const userId = user?.id ?? "", canManage = role === "super_admin";
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<AnnouncementFilter>("all");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(announcementPageSize);
  const [sortOrder, setSortOrder] = useState<DateSortOrder>("Newest");
  const [attempt, setAttempt] = useState(0);
  const [items, setItems] = useState<Announcement[]>([]);
  const [categories, setCategories] = useState<AnnouncementCategory[]>([]);
  const [schedulingEnabled, setSchedulingEnabled] = useState(false);
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editor, setEditor] = useState<EditState | null>(null);
  const [details, setDetails] = useState<Announcement | null>(null);
  const [confirmation, setConfirmation] = useState<ConfirmState | null>(null);
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const request = useRef<{ key: string; promise: ReturnType<typeof fetchAnnouncements> } | null>(null);
  const categoryRequest = useRef<{ userId: string; promise: ReturnType<typeof fetchAnnouncementSetup> } | null>(null);
  useEffect(() => {
    const timeout = window.setTimeout(() => { const next = searchDraft.trim(); if (next !== search) { setLoading(true); setPage(0); setSearch(next); } }, 350);
    return () => window.clearTimeout(timeout);
  }, [searchDraft, search]);
  useEffect(() => {
    if (!userId) return;
    let active = true;
    const key = JSON.stringify([userId, filter, search, page, pageSize, sortOrder, attempt]);
    if (!request.current || request.current.key !== key) request.current = { key, promise: fetchAnnouncements(userId, filter, search, page * pageSize, pageSize, sortOrder) };
    if (!categoryRequest.current || categoryRequest.current.userId !== userId) categoryRequest.current = { userId, promise: fetchAnnouncementSetup(userId) };
    void Promise.allSettled([request.current.promise, categoryRequest.current.promise]).then(([listResult, categoriesResult]) => {
      if (!active) return;
      if (categoriesResult.status === "fulfilled") { setCategories(categoriesResult.value.categories); setSchedulingEnabled(categoriesResult.value.schedulingEnabled); setNotificationsEnabled(categoriesResult.value.notificationsEnabled); }
      else { setCategories([]); setSchedulingEnabled(false); setNotificationsEnabled(false); }
      if (listResult.status === "fulfilled") {
        const lastPage = Math.max(0, Math.ceil(listResult.value.total / pageSize) - 1);
        if (page > lastPage) { setPage(lastPage); return; }
        setItems(listResult.value.items); setTotal(listResult.value.total); setError("");
      }
      else { setItems([]); setTotal(null); setError(listResult.reason instanceof Error ? listResult.reason.message : "Announcements are unavailable. Please retry."); }
      setLoading(false);
    });
    return () => { active = false; };
  }, [userId, filter, search, page, pageSize, sortOrder, attempt]);
  const refresh = () => { categoryRequest.current = null; setLoading(true); setAttempt((value) => value + 1); };
  const saved = () => { setEditor(null); setNotice("Announcement saved successfully."); setLoading(true); setPage(0); setAttempt((value) => value + 1); };
  const edit = (announcement: Announcement, initialStatus?: EditState["initialStatus"]) => { setDetails(null); setEditor({ announcement, initialStatus }); };
  const ask = (announcement: Announcement, action: ConfirmState["action"]) => { setDetails(null); setActionError(""); setConfirmation({ announcement, action }); };
  const runAction = async () => {
    if (!confirmation || busyRef.current) return;
    busyRef.current = true; setBusy(true); setActionError("");
    try {
      await manageAnnouncement(userId, confirmation.action, confirmation.announcement.id, confirmation.announcement.updatedAt);
      setNotice(confirmation.action === "restore" ? "Announcement restored as a private draft." : confirmation.action === "cancel_schedule" ? "Schedule cancelled. The announcement is now a draft." : confirmation.action === "archive" ? "Announcement archived and removed from the member feed." : "Draft deleted.");
      setConfirmation(null); setLoading(true); setPage(0); setAttempt((value) => value + 1);
    } catch (failure) { setActionError(failure instanceof Error ? failure.message : "Unable to complete this action. Please retry."); }
    finally { busyRef.current = false; setBusy(false); }
  };
  const newButton = <button type="button" onClick={() => setEditor({})} className="ui-button ui-button--primary"><Plus className="h-4 w-4 shrink-0" />New Announcement</button>;
  return <div className={styles.scope}>
    <Card padded={false} className="overflow-hidden" aria-label="Announcements">
      <PortalPageHeading section="announcements" />
      <div className="space-y-4 p-4 sm:p-6">
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
          <form role="search" aria-label="Search announcements" className="relative w-full min-w-0 sm:max-w-[420px]" onSubmit={(event) => { event.preventDefault(); if (search !== searchDraft.trim()) { setLoading(true); setPage(0); setSearch(searchDraft.trim()); } }}>
            <label htmlFor="announcements-search" className="sr-only">Search announcements</label><button type="submit" aria-label="Search announcements" className="ui-icon-button absolute left-1 top-1/2 -translate-y-1/2 border-0 bg-transparent"><Search className="h-4 w-4" /></button>
            <Input id="announcements-search" type="search" maxLength={160} value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} placeholder="Search announcements..." className="w-full pl-10 pr-10" />
            {searchDraft && <button type="button" aria-label="Clear announcement search" onClick={() => { setSearchDraft(""); if (search) { setLoading(true); setSearch(""); setPage(0); } }} className="ui-icon-button absolute right-1 top-1/2 -translate-y-1/2 border-0 bg-transparent"><X className="h-4 w-4" /></button>}
          </form>
          {canManage && newButton}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E2E8F0] pb-3"><div role="group" aria-label="Announcement status filters" className="flex flex-wrap gap-1">{announcementFilters.map((option) => <button type="button" key={option.value} aria-pressed={filter === option.value} onClick={() => { if (filter !== option.value) { setLoading(true); setFilter(option.value); setPage(0); } }} className={`ui-button ui-button--compact ${filter === option.value ? "ui-button--primary" : "ui-button--ghost"}`}>{option.label}</button>)}</div><button type="button" aria-label="Refresh announcements" disabled={loading} onClick={refresh} className="ui-icon-button"><RefreshCw className="h-4 w-4" /></button></div>
        {notice && <ActionResultDialog success title="Announcement updated" message={notice} onClose={() => setNotice("")} />}
        <div aria-busy={loading}>
          {loading ? <LoadingState label="Loading announcements…" />
            : error ? <div role="alert" className="rounded-xl border border-[#E2E8F0] bg-white px-5 py-10 text-center"><Megaphone className="mx-auto mb-3 h-7 w-7 text-[#64748B]" /><p className="text-sm font-semibold">Announcements unavailable</p><p className="mx-auto mt-2 max-w-lg text-xs leading-6 text-[#64748B]">{error}</p><button type="button" onClick={refresh} className="ui-button ui-button--compact mt-4">Retry announcements</button></div>
              : items.length === 0 ? <div className="ui-card">
                  <EmptyState icon={Megaphone} title={filter === "all" && !search ? "No announcements yet." : "No matching announcements found."}
                    description={filter === "all" && !search ? "Create your first announcement to share important cooperative updates with members." : "Try adjusting your search or filters."}
                    action={canManage && filter === "all" && !search ? newButton : undefined} />
                </div>
                : <div className="space-y-3">{items.map((announcement) => <AnnouncementCard key={announcement.id} announcement={announcement} canManage={canManage} onView={() => setDetails(announcement)} onEdit={() => edit(announcement)} onActions={() => setDetails(announcement)} />)}</div>}
        </div>
      </div>
      {!loading && !error && total !== null && <Pagination label="Announcement pagination"
        currentPage={page + 1} totalPages={Math.max(1, Math.ceil(total / pageSize))}
        showingFrom={page * pageSize + 1} showingTo={page * pageSize + items.length}
        totalItems={total} itemLabel="announcements" onPageChange={next => { if (next !== page + 1) { setLoading(true); setPage(next - 1); } }}
        controls={<PaginationControls sortOption={sortOrder} pageSize={pageSize} sortLabel="Sort announcements" pageSizeLabel="Announcements per page"
          onSortChange={value => { if (value !== sortOrder) { setLoading(true); setSortOrder(value); setPage(0); } }}
          onPageSizeChange={value => { if (value !== pageSize) { setLoading(true); setPageSize(value); setPage(0); } }} />} />}
    </Card>
    {editor && <AnnouncementEditor userId={userId} {...editor} categories={categories} schedulingEnabled={schedulingEnabled} notificationsEnabled={notificationsEnabled} onClose={() => setEditor(null)} onSaved={saved} />}
    {details && <AnnouncementDialog title="Announcement Details" onClose={() => setDetails(null)} footer={<>
      <button type="button" className="ui-button ui-button--compact" onClick={() => setDetails(null)}>Close</button>
      {canManage && details.status !== "archived" && <button type="button" className="ui-button ui-button--compact" onClick={() => edit(details)}>Edit</button>}
      {canManage && details.status === "draft" && <><button type="button" className="ui-button ui-button--compact" onClick={() => edit(details, "published")}>Publish</button><button type="button" className="ui-button ui-button--compact" onClick={() => edit(details, "scheduled")}>Schedule</button>{!details.publishedAt && <button type="button" className="ui-button ui-button--compact" onClick={() => ask(details, "delete")}>Delete Draft</button>}</>}
      {canManage && details.status === "scheduled" && <><button type="button" className="ui-button ui-button--compact" onClick={() => edit(details, "scheduled")}>Reschedule</button><button type="button" className="ui-button ui-button--compact" onClick={() => ask(details, "cancel_schedule")}>Cancel Schedule</button></>}
      {canManage && details.status === "published" && <button type="button" className="ui-button ui-button--compact" onClick={() => ask(details, "archive")}>Archive</button>}
      {canManage && details.status === "archived" && <button type="button" className="ui-button ui-button--compact" onClick={() => ask(details, "restore")}>Restore to Draft</button>}
    </>}>
      <div className="flex flex-wrap items-center gap-2"><AnnouncementBadge status={details.status} /><span className="text-xs text-[#64748B]">{details.category}</span></div><h3 className="mt-4 break-words text-xl font-bold leading-8">{details.title}</h3><p className="mt-4 whitespace-pre-wrap break-words text-sm leading-7 text-[#475569]">{details.content || "No content added to this draft yet."}</p>
      <dl className="mt-6 grid gap-3 border-t border-[#E2E8F0] pt-4 text-xs sm:grid-cols-2"><div><dt className="text-[#64748B]">Created</dt><dd className="mt-1">{announcementDate(details.createdAt)}</dd></div>{details.publishedAt && <div><dt className="text-[#64748B]">Published</dt><dd className="mt-1">{announcementDate(details.publishedAt)}</dd></div>}{details.scheduledAt && <div><dt className="text-[#64748B]">Scheduled (Philippine time)</dt><dd className="mt-1">{announcementDate(details.scheduledAt)}</dd></div>}{details.author && <div><dt className="text-[#64748B]">Author</dt><dd className="mt-1">{details.author}</dd></div>}</dl>
    </AnnouncementDialog>}
    {confirmation && <ConfirmActionDialog title={actionLabels[confirmation.action]} busy={busy}
      tone={confirmation.action === "delete" ? "destructive" : confirmation.action === "archive" || confirmation.action === "cancel_schedule" ? "warning" : "primary"}
      onClose={() => { if (!busyRef.current) setConfirmation(null); }} onConfirm={runAction}
      confirmLabel={actionLabels[confirmation.action]} error={actionError}
      details={[{ label: "Announcement", value: confirmation.announcement.title }]}
      question={confirmation.action === "delete" ? "Permanently delete this private draft? This cannot be undone." : confirmation.action === "archive" ? "Remove this announcement from the member app? It will remain in your archived records." : confirmation.action === "restore" ? "Restore this announcement as a private draft? You can review and publish it again later." : "Cancel future publication and keep this announcement as a private draft?"} />}

  </div>;
}
