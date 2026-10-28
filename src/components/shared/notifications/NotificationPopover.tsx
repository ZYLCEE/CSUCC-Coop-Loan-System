"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { ArrowLeft, Bell, Check, CheckCheck, CircleAlert, FileCheck, RefreshCw, Search, Wallet, X } from "lucide-react";
import { notificationCategoryOptions, notificationHref, notificationRelativeTime, type NotificationCategory } from "@/lib/adminNotifications";
import { useNotificationInbox } from "./useNotificationInbox";

const notificationIcons: Record<string, ReactNode> = {
  loan_approval: <FileCheck className="h-4 w-4" aria-hidden="true" />,
  loan_rejection: <CircleAlert className="h-4 w-4" aria-hidden="true" />,
  payment_reminder: <Wallet className="h-4 w-4" aria-hidden="true" />,
  warning: <CircleAlert className="h-4 w-4" aria-hidden="true" />,
  error: <CircleAlert className="h-4 w-4" aria-hidden="true" />,
};
const focusStyle = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145B3C]";

export default function NotificationPopover({ userId, routePrefix }: { userId: string; routePrefix: string }) {
  const router = useRouter();
  const panelId = useId();
  const bell = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [searchDraft, setSearchDraft] = useState("");
  const searchInput = useRef<HTMLInputElement>(null);
  const [now, setNow] = useState(() => Date.now());
  const [position, setPosition] = useState<{ left: number; top: number; width: number; maxHeight: number; height?: number }>({ left: 12, top: 64, width: 384, maxHeight: 480 });
  const inbox = useNotificationInbox(userId);

  const close = useCallback((restoreFocus = false) => {
    setOpen(false);
    setExpanded(false);
    setSearchDraft("");
    if (restoreFocus) bell.current?.focus();
  }, []);

  const positionPanel = useCallback((center: boolean) => {
    const rect = bell.current?.getBoundingClientRect();
    if (!rect) return;
    const viewport = window.visualViewport;
    const leftEdge = viewport?.offsetLeft ?? 0;
    const topEdge = viewport?.offsetTop ?? 0;
    const width = Math.max(0, Math.min(center ? 620 : 384, (viewport?.width ?? window.innerWidth) - 24));
    const bottom = topEdge + (viewport?.height ?? window.innerHeight);
    if (center) {
      const height = Math.max(0, Math.min(Math.floor((viewport?.height ?? window.innerHeight) * 0.8), (viewport?.height ?? window.innerHeight) - 24));
      setPosition({ width, height, maxHeight: height, left: leftEdge + ((viewport?.width ?? window.innerWidth) - width) / 2, top: topEdge + ((viewport?.height ?? window.innerHeight) - height) / 2 });
      return;
    }
    const left = Math.max(leftEdge + 12, Math.min(rect.right - width, leftEdge + (viewport?.width ?? window.innerWidth) - width - 12));
    const top = Math.max(topEdge + 12, Math.min(rect.bottom + 10, bottom - 12));
    setPosition({ left, top, width, maxHeight: Math.max(0, Math.min(480, bottom - top - 12)) });
  }, []);

  const expandCenter = () => {
    positionPanel(true);
    setExpanded(true);
  };
  const backToRecent = () => {
    positionPanel(false);
    setExpanded(false);
    setSearchDraft("");
    void inbox.resetRecent();
  };

  useEffect(() => {
    if (!open) return;
    if (expanded) searchInput.current?.focus();
    else panel.current?.focus();
    const outside = (event: PointerEvent | FocusEvent) => {
      const target = event.target;
      if (target instanceof Node && !panel.current?.contains(target) && !bell.current?.contains(target)) close();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); close(true); }
      if (expanded && event.key === "Tab") {
        const controls = [...(panel.current?.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),[tabindex="0"]') ?? [])].filter((element) => element.getClientRects().length > 0);
        const first = controls[0], last = controls[controls.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    const interval = window.setInterval(() => setNow(Date.now()), 60000);
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    document.addEventListener("keydown", escape);
    const reposition = () => positionPanel(expanded);
    window.addEventListener("resize", reposition);
    window.visualViewport?.addEventListener("resize", reposition);
    window.visualViewport?.addEventListener("scroll", reposition);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", outside);
      document.removeEventListener("keydown", escape);
      window.removeEventListener("resize", reposition);
      window.visualViewport?.removeEventListener("resize", reposition);
      window.visualViewport?.removeEventListener("scroll", reposition);
    };
  }, [open, expanded, close, positionPanel]);

  return (
    <>
      <button ref={bell} type="button" aria-label="Open notifications" aria-expanded={open}
        aria-haspopup="dialog" aria-controls={open ? panelId : undefined} aria-describedby={`${panelId}-count`}
        onClick={() => {
          if (open) close();
          else { positionPanel(false); setExpanded(false); setSearchDraft(""); setNow(Date.now()); setOpen(true); void inbox.resetRecent(); }
        }}
        className={`relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#E5E7EB] bg-white text-[#64748B] transition-colors hover:border-[#145B3C] hover:bg-[#F5F6F8] hover:text-[#145B3C] ${focusStyle}`}>
        <Bell className="h-[15px] w-[15px]" aria-hidden="true" />
        {inbox.unreadCount !== null && inbox.unreadCount > 0 && <span aria-hidden="true" className="absolute -right-1.5 -top-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full border-2 border-white bg-[#145B3C] px-0.5 text-[9px] font-bold text-white">{inbox.unreadCount > 99 ? "99+" : inbox.unreadCount}</span>}
      </button>
      <span id={`${panelId}-count`} className="sr-only">{inbox.unreadCount === null ? "Unread notification count unavailable" : `${inbox.unreadCount} unread notifications`}</span>
      {open && createPortal(
        <>
        {expanded && <div aria-hidden="true" className="fixed inset-0 z-[60] bg-[#0F172A]/25" />}
        <div ref={panel} id={panelId} role="dialog" aria-modal={expanded} aria-labelledby={`${panelId}-title`} tabIndex={-1}
          style={position} className="fixed z-[70] flex flex-col overflow-y-auto rounded-xl border border-[#E2E8F0] bg-white text-[#17212F] shadow-[0_12px_40px_rgba(15,23,42,0.16)] outline-none">
          <div className="shrink-0 border-b border-[#E2E8F0] px-4 pb-3 pt-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 id={`${panelId}-title`} className="text-base font-semibold">{expanded ? "Notification Center" : "Notifications"}</h2>
                <p className="mt-0.5 text-xs text-[#64748B]">{inbox.unreadCount === null ? inbox.loading ? "Checking unread notifications…" : "Unread count unavailable" : `${inbox.unreadCount.toLocaleString()} unread`}</p>
              </div>
              <div className="flex items-center gap-1">
                <button type="button" aria-label="Refresh notifications" disabled={inbox.loading || inbox.busy} onClick={() => void inbox.refresh()} className={`flex h-7 w-7 items-center justify-center rounded-md text-[#64748B] hover:bg-slate-100 disabled:opacity-50 ${focusStyle}`}><RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /></button>
                <button type="button" aria-label="Close notifications" onClick={() => close(true)} className={`flex h-7 w-7 items-center justify-center rounded-md text-[#64748B] hover:bg-slate-100 ${focusStyle}`}><X className="h-4 w-4" aria-hidden="true" /></button>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <div role="group" aria-label="Notification filters" className="flex gap-1 rounded-lg bg-[#F4F6F8] p-0.5">
                {(expanded ? (["all", "unread", "read"] as const) : (["all", "unread"] as const)).map((filter) => <button key={filter} type="button" aria-pressed={inbox.filter === filter} disabled={inbox.busy} onClick={() => inbox.changeFilter(filter)} className={`rounded-md px-3 py-1 text-xs font-medium disabled:opacity-50 ${inbox.filter === filter ? "bg-white text-[#145B3C] shadow-sm" : "text-[#64748B] hover:text-[#145B3C]"} ${focusStyle}`}>{filter === "all" ? "All" : filter === "unread" ? "Unread" : "Read"}</button>)}
              </div>
              <button type="button" disabled={inbox.loading || inbox.busy || !inbox.unreadCount || !!inbox.error} onClick={() => void inbox.markRead()} className={`inline-flex items-center gap-1 rounded px-1 py-1 text-[11px] font-semibold text-[#145B3C] hover:underline disabled:cursor-not-allowed disabled:opacity-40 disabled:no-underline ${focusStyle}`}><CheckCheck className="h-3.5 w-3.5" aria-hidden="true" />Mark all as read</button>
            </div>
          </div>
          {expanded && <form onSubmit={(event) => { event.preventDefault(); inbox.changeQuery({ search: searchDraft }); }} className="flex shrink-0 flex-wrap gap-2 border-b border-[#E2E8F0] px-4 py-3">
            <label htmlFor={`${panelId}-search`} className="sr-only">Search incoming notifications</label>
            <input ref={searchInput} id={`${panelId}-search`} type="search" value={searchDraft} maxLength={160} onChange={(event) => setSearchDraft(event.target.value)} placeholder="Search titles and messages…" disabled={inbox.busy} className={`h-9 min-w-0 flex-1 rounded-lg border border-[#E2E8F0] px-3 text-xs ${focusStyle}`} />
            <button type="submit" disabled={inbox.busy || inbox.loading} className={`inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#145B3C] px-3 text-xs font-semibold text-white disabled:opacity-40 ${focusStyle}`}><Search className="h-3.5 w-3.5" aria-hidden="true" />Search</button>
            <label className="flex w-full flex-wrap items-center gap-2 text-xs text-[#64748B]">Category
              <select aria-label="Notification category" value={inbox.category} disabled={inbox.busy} onChange={(event) => inbox.changeQuery({ category: event.target.value as NotificationCategory })} className={`h-8 min-w-0 rounded-lg border border-[#E2E8F0] bg-white px-2 text-xs text-[#17212F] ${focusStyle}`}>{notificationCategoryOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
              {(inbox.search || inbox.category !== "all") && <button type="button" onClick={() => { setSearchDraft(""); inbox.changeQuery({ search: "", category: "all" }); }} className={`ml-auto shrink-0 rounded text-xs font-semibold text-[#145B3C] ${focusStyle}`}>Clear filters</button>}
            </label>
          </form>}
          {inbox.actionError && <p role="alert" className="shrink-0 border-b border-red-100 bg-red-50 px-4 py-2 text-xs leading-5 text-red-700">{inbox.actionError}</p>}
          <div role="region" aria-label="Notification list" tabIndex={0} aria-busy={inbox.loading} className="min-h-0 flex-1 overflow-y-auto overscroll-contain focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#145B3C]">
            {inbox.loading ? <div role="status" className="space-y-4 p-4"><span className="sr-only">Loading notifications</span>{[0, 1, 2].map((index) => <div key={index} className="flex gap-3"><div className="h-8 w-8 shrink-0 animate-pulse rounded-lg bg-slate-100 motion-reduce:animate-none" /><div className="flex-1 space-y-2"><div className="h-3 w-3/4 animate-pulse rounded bg-slate-100 motion-reduce:animate-none" /><div className="h-3 w-full animate-pulse rounded bg-slate-100 motion-reduce:animate-none" /></div></div>)}</div>
              : inbox.error ? <div role="alert" className="px-5 py-8 text-center"><p className="text-sm font-semibold">Notifications unavailable</p><p className="mt-2 text-xs leading-5 text-[#64748B]">{inbox.error}</p><button type="button" onClick={() => void inbox.refresh()} className={`mt-3 rounded border border-[#E2E8F0] px-3 py-1.5 text-xs font-semibold text-[#145B3C] ${focusStyle}`}>Retry notifications</button></div>
              : inbox.items.length === 0 ? <div className="px-5 py-8 text-center"><Bell className="mx-auto mb-3 h-6 w-6 text-slate-400" aria-hidden="true" /><p className="text-sm font-semibold">{inbox.search || inbox.category !== "all" ? "No matching notifications" : inbox.filter === "unread" ? "You’re all caught up" : inbox.filter === "read" ? "No read notifications yet" : "No notifications yet"}</p><p className="mt-2 text-xs leading-5 text-[#64748B]">{inbox.filter === "unread" ? "You have no unread notifications." : "Alerts addressed to your account will appear here."}</p></div>
              : <ul className="divide-y divide-[#F1F5F9]">{inbox.items.map((notification) => (
                <li key={notification.id} className={notification.read ? "bg-white" : "bg-[#F2F8F5]"}>
                  <div className="flex items-start gap-3 px-4 py-3">
                    <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#E7F0EB] text-[#145B3C]">{notificationIcons[notification.type] ?? <Bell className="h-4 w-4" aria-hidden="true" />}</span>
                    <div className="min-w-0 flex-1">
                      <button type="button" disabled={inbox.busy} onClick={async () => {
                        if (inbox.busy) return;
                        if (!notification.read && !await inbox.markRead(notification.id)) return;
                        const href = notificationHref(notification.type, routePrefix);
                        if (href) { close(); router.push(href); }
                        else if (!expanded) expandCenter();
                      }} className={`block w-full rounded text-left ${focusStyle}`}>
                        <span className="flex items-start gap-2"><span className={`min-w-0 flex-1 break-words text-[13px] leading-5 ${notification.read ? "font-medium" : "font-semibold"}`}>{notification.title}</span>{!notification.read && <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#145B3C]" role="img" aria-label="Unread" />}</span>
                        <span className={`mt-0.5 block break-words text-xs leading-5 text-[#64748B] ${expanded ? "whitespace-pre-wrap" : "line-clamp-2"}`}>{notification.message}</span>
                      </button>
                      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
                        <time dateTime={notification.createdAt} title={new Date(notification.createdAt).toLocaleString("en-PH", { timeZone: "Asia/Manila" })} className="text-[10px] text-[#64748B]">{notificationRelativeTime(notification.createdAt, now)}</time>
                        {notification.read && <span className="text-[10px] text-[#64748B]">Read</span>}
                        {!notification.read && <button type="button" disabled={inbox.busy} onClick={() => void inbox.markRead(notification.id)} aria-label={`Mark ${notification.title} as read`} className={`inline-flex items-center gap-1 rounded text-[10px] font-semibold text-[#145B3C] hover:underline disabled:opacity-40 ${focusStyle}`}><Check className="h-3 w-3" aria-hidden="true" />Mark as read</button>}
                      </div>
                    </div>
                  </div>
                </li>
              ))}</ul>}
            {!inbox.loading && !inbox.error && inbox.hasMore && <div className="px-4 py-3 text-center"><button type="button" disabled={inbox.loadingMore || inbox.busy} onClick={() => void inbox.loadMore()} className={`rounded px-3 py-1.5 text-xs font-semibold text-[#145B3C] hover:bg-slate-50 disabled:opacity-50 ${focusStyle}`}>{inbox.loadingMore ? "Loading…" : "Load more notifications"}</button></div>}
          </div>
          <div className="flex shrink-0 items-center justify-center gap-3 border-t border-[#E2E8F0] px-4 py-3">
            {expanded ? <><button type="button" onClick={backToRecent} className={`mr-auto inline-flex items-center gap-1.5 rounded text-xs font-semibold text-[#145B3C] hover:underline ${focusStyle}`}><ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />Back to Recent</button><span className="text-[11px] text-[#64748B]">{inbox.total === null ? "History unavailable" : `${inbox.items.length} of ${inbox.total} alerts`}</span></>
              : <button type="button" onClick={expandCenter} className={`rounded text-xs font-semibold text-[#145B3C] hover:underline ${focusStyle}`}>View All Notifications</button>}
          </div>
        </div></>, document.body,
      )}
    </>
  );
}
