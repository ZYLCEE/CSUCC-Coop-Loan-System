"use client";

import { useEffect, useRef, useState } from "react";
import { Clock, RefreshCw, Search, Send } from "lucide-react";
import { useAdminAuth } from "@/components/auth/AdminAuthProvider";
import { fetchOutgoingNotifications, type OutgoingNotification, type OutgoingStatus } from "@/lib/memberNotifications";

const statusStyles = {
  sent: "border-green-200 bg-green-50 text-green-700",
  scheduled: "border-amber-200 bg-amber-50 text-amber-700",
  failed: "border-red-200 bg-red-50 text-red-700",
};
const formatDate = (value: string) => new Date(value).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Manila" });

export default function NotificationHistoryCard() {
  const { user, role } = useAdminAuth();
  const [status, setStatus] = useState<OutgoingStatus>("all");
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [items, setItems] = useState<OutgoingNotification[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const request = useRef<{ key: string; promise: ReturnType<typeof fetchOutgoingNotifications> } | null>(null);
  const userId = user?.id ?? "";

  useEffect(() => {
    if (!userId || role !== "super_admin") return;
    let active = true;
    const key = JSON.stringify([userId, status, search, page, attempt]);
    if (!request.current || request.current.key !== key) {
      request.current = { key, promise: fetchOutgoingNotifications(userId, status, search, page * 20) };
    }
    void request.current.promise.then((result) => {
      if (active) { setItems(result.items); setTotal(result.total); setError(""); }
    }).catch((failure: unknown) => {
      if (active) { setItems([]); setTotal(null); setError(failure instanceof Error ? failure.message : "Outgoing history is unavailable. Please retry."); }
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [userId, role, status, search, page, attempt]);
  const reload = () => { setLoading(true); setError(""); setAttempt((value) => value + 1); };

  return (
    <section aria-labelledby="outgoing-history-heading" aria-busy={role === "super_admin" && loading} className="min-w-0 overflow-hidden rounded-[14px] border border-[#E2E8F0] bg-white shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
        <div><h2 id="outgoing-history-heading" className="text-base font-semibold text-[#17212F]">Outgoing Notification History</h2><p className="mt-1 text-xs leading-5 text-[#64748B]">Messages sent or scheduled for members. Statuses are reported by the notification service.</p></div>
        <button type="button" onClick={reload} disabled={loading || role !== "super_admin"} aria-label="Refresh outgoing history" className="rounded-lg border border-[#E2E8F0] p-2 text-[#64748B] hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-[#145B3C] disabled:opacity-40"><RefreshCw className="h-4 w-4" /></button>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-y border-[#E2E8F0] px-5 py-3">
        <div role="group" aria-label="Outgoing status filters" className="flex flex-wrap gap-1">{(["all", "sent", "scheduled", "failed"] as const).map((value) => <button type="button" key={value} disabled={role !== "super_admin"} aria-pressed={status === value} onClick={() => { if (value !== status) { setLoading(true); setPage(0); setStatus(value); } }} className={`rounded-lg px-3 py-1.5 text-xs font-medium focus-visible:outline-2 focus-visible:outline-[#145B3C] ${value === status ? "bg-[#E7F0EB] text-[#145B3C]" : "text-[#64748B] hover:bg-slate-50"}`}>{value.charAt(0).toUpperCase() + value.slice(1)}</button>)}</div>
        <form className="flex max-w-full gap-2" onSubmit={(event) => { event.preventDefault(); const next = searchDraft.trim().slice(0, 160); if (next !== search) { setLoading(true); setPage(0); setSearch(next); } }}>
          <label htmlFor="outgoing-search" className="sr-only">Search outgoing notification titles</label><input id="outgoing-search" type="search" value={searchDraft} maxLength={160} disabled={role !== "super_admin"} onChange={(event) => setSearchDraft(event.target.value)} placeholder="Search outgoing titles" className="h-9 min-w-0 rounded-lg border border-[#E2E8F0] px-3 text-xs text-[#17212F] focus:outline-2 focus:outline-[#145B3C]" /><button type="submit" disabled={role !== "super_admin"} aria-label="Search outgoing history" className="rounded-lg border border-[#E2E8F0] px-2 text-[#145B3C]"><Search className="h-4 w-4" /></button>
        </form>
      </div>
      {role !== "super_admin" ? <p className="px-5 py-8 text-sm text-[#64748B]">Outgoing history requires the existing Super Admin permission.</p>
        : loading ? <div role="status" className="space-y-3 p-5"><span className="sr-only">Loading outgoing history</span>{[0, 1, 2].map((index) => <div key={index} className="h-10 animate-pulse rounded bg-slate-100 motion-reduce:animate-none" />)}</div>
        : error ? <div role="alert" className="px-5 py-8 text-center"><p className="text-sm font-semibold text-[#17212F]">Outgoing history unavailable</p><p className="mx-auto mt-2 max-w-xl text-xs leading-6 text-[#64748B]">{error}</p><button type="button" onClick={reload} className="mt-3 rounded-lg border border-[#E2E8F0] px-3 py-2 text-xs font-semibold text-[#145B3C] focus-visible:outline-2 focus-visible:outline-[#145B3C]">Retry outgoing history</button></div>
        : items.length === 0 ? <div className="px-5 py-8 text-center"><Send className="mx-auto mb-3 h-5 w-5 text-slate-400" /><p className="text-sm font-semibold text-[#17212F]">No outgoing notifications found</p><p className="mt-2 text-xs text-[#64748B]">Sent and scheduled messages will appear when recorded by the delivery service.</p></div>
        : <div role="region" aria-label="Outgoing notification history table" tabIndex={0} className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-xs">
          <thead className="border-b border-[#E2E8F0] bg-[#F8FAFC] text-[10px] uppercase tracking-wide text-[#64748B]"><tr>{["Notification", "Recipients", "Delivery", "Created", "Status"].map((heading) => <th scope="col" key={heading} className="px-5 py-3 font-semibold">{heading}</th>)}</tr></thead>
          <tbody className="divide-y divide-[#F1F5F9]">{items.map((item) => <tr key={item.id} className="hover:bg-slate-50"><td className="max-w-xs px-5 py-4"><p className="font-semibold text-[#17212F]">{item.title}</p><p className="mt-1 line-clamp-2 break-words leading-5 text-[#64748B]">{item.message}</p><span className="mt-1 inline-block text-[10px] text-[#64748B]">{item.type}</span></td><td className="px-5 py-4 text-[#334155]"><p>{item.recipient}</p><p className="mt-1 text-[10px] text-[#64748B]">{item.recipientCount.toLocaleString()} recipients</p></td><td className="whitespace-nowrap px-5 py-4 text-[#64748B]">{item.scheduledAt ? <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" />{formatDate(item.scheduledAt)}</span> : "Send Now"}</td><td className="whitespace-nowrap px-5 py-4 text-[#64748B]">{formatDate(item.createdAt)}</td><td className="px-5 py-4"><span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-medium ${statusStyles[item.status]}`}>{item.status.charAt(0).toUpperCase() + item.status.slice(1)}</span></td></tr>)}</tbody>
        </table></div>}
      {!loading && !error && total !== null && role === "super_admin" && <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#E2E8F0] px-5 py-3 text-xs text-[#64748B]"><span>{total === 0 ? "0 records" : `${page * 20 + 1}–${page * 20 + items.length} of ${total}`}</span><div className="flex gap-2"><button type="button" disabled={page === 0} onClick={() => { setLoading(true); setPage((value) => value - 1); }} className="rounded-lg border border-[#E2E8F0] px-3 py-1.5 disabled:opacity-40">Previous</button><button type="button" disabled={(page + 1) * 20 >= total} onClick={() => { setLoading(true); setPage((value) => value + 1); }} className="rounded-lg border border-[#E2E8F0] px-3 py-1.5 disabled:opacity-40">Next</button></div></div>}
    </section>
  );
}
