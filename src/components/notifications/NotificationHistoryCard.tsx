"use client";

import { DataTable } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/Feedback";
import { Input } from "@/components/ui/Fields";
import { Pagination, PaginationControls } from "@/components/ui/Pagination";
import type { DateSortOrder } from "@/lib/tablePagination";
import { StatusBadge } from "@/components/ui/StatusBadge";

import { useEffect, useRef, useState } from "react";
import { Clock, RefreshCw, Search, Send } from "lucide-react";
import { useAdminAuth } from "@/components/auth/AdminAuthProvider";
import { fetchOutgoingNotifications, type OutgoingNotification, type OutgoingStatus } from "@/lib/memberNotifications";

const formatDate = (value: string) => new Date(value).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Manila" });

export default function NotificationHistoryCard() {
  const { user, can } = useAdminAuth();
  const canSend = can("notifications.send");
  const [status, setStatus] = useState<OutgoingStatus>("all");
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const [sortOrder, setSortOrder] = useState<DateSortOrder>("Newest");
  const [attempt, setAttempt] = useState(0);
  const [items, setItems] = useState<OutgoingNotification[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const request = useRef<{ key: string; promise: ReturnType<typeof fetchOutgoingNotifications> } | null>(null);
  const userId = user?.id ?? "";

  useEffect(() => {
    if (!userId || !canSend) return;
    let active = true;
    let correctedPage = false;
    const key = JSON.stringify([userId, status, search, page, pageSize, sortOrder, attempt]);
    if (!request.current || request.current.key !== key) {
      request.current = { key, promise: fetchOutgoingNotifications(userId, status, search, page * pageSize, pageSize, sortOrder) };
    }
    void request.current.promise.then((result) => {
      if (active) {
        const lastPage = Math.max(0, Math.ceil(result.total / pageSize) - 1);
        if (page > lastPage) { correctedPage = true; setPage(lastPage); return; }
        setItems(result.items); setTotal(result.total); setError("");
      }
    }).catch((failure: unknown) => {
      if (active) { setItems([]); setTotal(null); setError(failure instanceof Error ? failure.message : "Outgoing history is unavailable. Please retry."); }
    }).finally(() => { if (active && !correctedPage) setLoading(false); });
    return () => { active = false; };
  }, [userId, canSend, status, search, page, pageSize, sortOrder, attempt]);
  const reload = () => { setLoading(true); setError(""); setAttempt((value) => value + 1); };

  return (
    <section aria-labelledby="outgoing-history-heading" aria-busy={canSend && loading} className="ui-card overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
        <div><h2 id="outgoing-history-heading" className="text-card-title">Outgoing Notification History</h2><p className="mt-1 text-xs leading-5 text-[#64748B]">Messages sent or scheduled for members. Statuses are reported by the notification service.</p></div>
        <button type="button" onClick={reload} disabled={loading || !canSend} aria-label="Refresh outgoing history" className="ui-icon-button"><RefreshCw className="h-4 w-4" /></button>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-y border-portal-border px-5 py-3">
        <div role="group" aria-label="Outgoing status filters" className="flex flex-wrap gap-1">{(["all", "sent", "scheduled", "failed"] as const).map((value) => <button type="button" key={value} disabled={!canSend} aria-pressed={status === value} onClick={() => { if (value !== status) { setLoading(true); setPage(0); setStatus(value); } }} className={`ui-button ui-button--compact ${value === status ? "ui-button--primary" : "ui-button--ghost"}`}>{value.charAt(0).toUpperCase() + value.slice(1)}</button>)}</div>
        <form className="flex max-w-full gap-2" onSubmit={(event) => { event.preventDefault(); const next = searchDraft.trim().slice(0, 160); if (next !== search) { setLoading(true); setPage(0); setSearch(next); } }}>
          <label htmlFor="outgoing-search" className="sr-only">Search outgoing notification titles</label><Input size="compact" id="outgoing-search" type="search" value={searchDraft} maxLength={160} disabled={!canSend} onChange={(event) => setSearchDraft(event.target.value)} placeholder="Search outgoing titles" className="w-full" /><button type="submit" disabled={!canSend} aria-label="Search outgoing history" className="ui-icon-button"><Search className="h-4 w-4" /></button>
        </form>
      </div>
      {!canSend ? <p className="px-5 py-8 text-sm text-[#64748B]">Outgoing history requires member notification privileges.</p>
        : loading ? <div role="status" className="space-y-3 p-5"><span className="sr-only">Loading outgoing history</span>{[0, 1, 2].map((index) => <div key={index} className="h-10 animate-pulse rounded bg-slate-100 motion-reduce:animate-none" />)}</div>
        : error ? <div role="alert" className="px-5 py-8 text-center"><p className="text-sm font-semibold text-[#17212F]">Outgoing history unavailable</p><p className="mx-auto mt-2 max-w-xl text-xs leading-6 text-[#64748B]">{error}</p><button type="button" onClick={reload} className="mt-3 rounded-lg border border-portal-border px-3 py-2 text-xs font-semibold text-[#145B3C] focus-visible:outline-2 focus-visible:outline-[#145B3C]">Retry outgoing history</button></div>
        : items.length === 0 ? <EmptyState icon={Send} title="No outgoing notifications found" description="Sent and scheduled messages will appear when recorded by the delivery service." />
        : <DataTable label="Outgoing notification history table" className="min-w-[760px]">
          <thead><tr>{["Notification", "Recipients", "Delivery", "Created", "Status"].map((heading) => <th scope="col" key={heading} className="px-5 py-3 font-semibold">{heading}</th>)}</tr></thead>
          <tbody className="divide-y divide-[#F1F5F9]">{items.map((item) => <tr key={item.id} className="hover:bg-slate-50"><td className="max-w-xs px-5 py-4"><p className="font-semibold text-[#17212F]">{item.title}</p><p className="mt-1 line-clamp-2 break-words leading-5 text-[#64748B]">{item.message}</p><span className="mt-1 inline-block text-[10px] text-[#64748B]">{item.type}</span></td><td className="px-5 py-4 text-[#334155]"><p>{item.recipient}</p><p className="mt-1 text-[10px] text-[#64748B]">{item.recipientCount.toLocaleString()} recipients</p></td><td className="whitespace-nowrap px-5 py-4 text-[#64748B]">{item.scheduledAt ? <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" />{formatDate(item.scheduledAt)}</span> : "Send Now"}</td><td className="whitespace-nowrap px-5 py-4 text-[#64748B]">{formatDate(item.createdAt)}</td><td className="px-5 py-4"><StatusBadge status={item.status} className="capitalize" /></td></tr>)}</tbody>
        </DataTable>}
      {!loading && !error && total !== null && canSend && <Pagination label="Outgoing notification pagination"
        currentPage={page + 1} totalPages={Math.max(1, Math.ceil(total / pageSize))}
        showingFrom={page * pageSize + 1} showingTo={page * pageSize + items.length}
        totalItems={total} itemLabel="notifications" onPageChange={next => { if (next !== page + 1) { setLoading(true); setPage(next - 1); } }}
        controls={<PaginationControls sortOption={sortOrder} pageSize={pageSize} sortLabel="Sort outgoing notifications" pageSizeLabel="Notifications per page"
          onSortChange={value => { if (value !== sortOrder) { setLoading(true); setSortOrder(value); setPage(0); } }}
          onPageSizeChange={value => { if (value !== pageSize) { setLoading(true); setPageSize(value); setPage(0); } }} />} />}
    </section>
  );
}
