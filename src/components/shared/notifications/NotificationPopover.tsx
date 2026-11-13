"use client";

import { actionButtonStyles } from "@/components/shared/actionButtonStyles";
import { ActionDialog } from "@/components/ui/ActionDialog";
import { Button } from "@/components/ui/Button";
import { EmptyState, LoadingState } from "@/components/ui/Feedback";
import { Input, Select } from "@/components/ui/Fields";
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Bell, Check, CheckCheck, CircleAlert, FileCheck, RefreshCw, Search, Wallet, X } from "lucide-react";
import { notificationCategoryOptions, notificationHref, notificationRelativeTime, type NotificationCategory } from "@/lib/adminNotifications";
import { useNotificationInbox } from "./useNotificationInbox";

const notificationIcons: Record<string, ReactNode> = {
  loan_submitted: <FileCheck className="h-4 w-4" aria-hidden="true" />,
  loan_approval: <FileCheck className="h-4 w-4" aria-hidden="true" />,
  loan_rejection: <CircleAlert className="h-4 w-4" aria-hidden="true" />,
  payment_reminder: <Wallet className="h-4 w-4" aria-hidden="true" />,
  warning: <CircleAlert className="h-4 w-4" aria-hidden="true" />,
  error: <CircleAlert className="h-4 w-4" aria-hidden="true" />,
};
const focusStyle = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-coop-primary";

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
  const inbox = useNotificationInbox(userId, open);
  const hasFilters = !!inbox.search || inbox.category !== "all";

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
    const contentStart = Math.max(leftEdge, bell.current?.closest("header")?.getBoundingClientRect().left ?? leftEdge);
    const right = leftEdge + (viewport?.width ?? window.innerWidth);
    const viewportHeight = viewport?.height ?? window.innerHeight;
    const width = Math.max(0, Math.min(center ? 620 : 384, right - contentStart - 24));
    const bottom = topEdge + viewportHeight;
    if (center) {
      const height = Math.max(0, Math.min(Math.floor(viewportHeight * 0.88), viewportHeight - 24));
      setPosition({ width, height, maxHeight: height, left: contentStart + (right - contentStart - width) / 2, top: topEdge + (viewportHeight - height) / 2 });
      return;
    }
    const left = Math.max(contentStart + 12, Math.min(rect.right - width, right - width - 12));
    const top = bottom - rect.bottom >= 240 ? Math.max(topEdge + 12, rect.bottom + 8) : topEdge + 12;
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
    };
    const interval = window.setInterval(() => setNow(Date.now()), 60000);
    if (!expanded) {
      document.addEventListener("pointerdown", outside);
      document.addEventListener("focusin", outside);
      document.addEventListener("keydown", escape);
    }
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

  const content = <>
          <div className="shrink-0 border-b border-portal-border p-3 sm:px-4">
            {expanded&&<nav aria-label="Communication tools" className="flex flex-wrap justify-center gap-2 border-t border-portal-border p-3"><Link className={actionButtonStyles()} href={`${routePrefix}/${routePrefix?"communication":"notifications"}`}>Activity Inbox & Member Messages</Link><Link className={actionButtonStyles()} href={`${routePrefix}/announcements`}>Announcements</Link></nav>}
          {!expanded && <div className="flex items-start justify-between gap-3">
              <div>
                <h2 id={`${panelId}-title`} className="text-card-title">{expanded ? "Notification Center" : "Notifications"}</h2>
                <p className="mt-1 text-caption text-portal-secondary">{inbox.unreadCount === null ? inbox.loading ? "Checking unread notifications…" : "Unread count unavailable" : `${inbox.unreadCount.toLocaleString()} unread`}</p>
              </div>
              <div className="flex items-center gap-1">
                <button type="button" aria-label="Refresh notifications" disabled={inbox.loading || inbox.busy} onClick={() => void inbox.refresh()} className="ui-icon-button ui-button--ghost"><RefreshCw className="size-icon-compact" aria-hidden="true" /></button>
                <button type="button" aria-label="Close notifications" onClick={() => close(true)} className="ui-icon-button ui-button--ghost"><X className="size-icon" aria-hidden="true" /></button>
              </div>
            </div>}
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <div role="group" aria-label="Notification filters" className="flex flex-wrap gap-1 rounded-portal-control bg-surface-muted p-1">
                {(expanded ? (["all", "unread", "read"] as const) : (["all", "unread"] as const)).map((filter) => <Button key={filter} size="compact" variant={inbox.filter === filter ? "primary" : "ghost"} aria-pressed={inbox.filter === filter} disabled={inbox.busy} onClick={() => inbox.changeFilter(filter)}>{filter === "all" ? "All" : filter === "unread" ? "Unread" : "Read"}</Button>)}
              </div>
              <Button size="compact" disabled={inbox.loading || inbox.busy || !inbox.unreadCount || !!inbox.error} onClick={() => void inbox.markRead()}><CheckCheck className="size-icon-compact" aria-hidden="true" />Mark all as read</Button>
            </div>
          </div>
          {expanded && <form onSubmit={(event) => { event.preventDefault(); inbox.changeQuery({ search: searchDraft }); }} className="flex shrink-0 flex-wrap gap-2 border-b border-portal-border px-4 py-3">
            <label htmlFor={`${panelId}-search`} className="sr-only">Search incoming notifications</label>
            <Input size="compact" ref={searchInput} data-dialog-autofocus id={`${panelId}-search`} type="search" value={searchDraft} maxLength={160} onChange={(event) => setSearchDraft(event.target.value)} placeholder="Search titles and messages…" disabled={inbox.busy} className="min-w-0 flex-1" />
            <Button type="submit" size="compact" variant="primary" disabled={inbox.busy || inbox.loading}><Search className="size-icon-compact" aria-hidden="true" />Search</Button>
            <label className="flex w-full flex-wrap items-center gap-2 text-xs text-portal-secondary">Category
              <Select size="compact" aria-label="Notification category" value={inbox.category} disabled={inbox.busy} onChange={(event) => inbox.changeQuery({ category: event.target.value as NotificationCategory })}>{notificationCategoryOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</Select>
              {hasFilters && <Button size="compact" variant="ghost" onClick={() => { setSearchDraft(""); inbox.changeQuery({ search: "", category: "all" }); }}>Clear filters</Button>}
            </label>
          </form>}
          {inbox.actionError && <p role="alert" className="shrink-0 border-b border-portal-border bg-status-danger-surface px-4 py-2 text-caption text-status-danger">{inbox.actionError}</p>}
          <div role="region" aria-label="Notification list" tabIndex={0} aria-busy={inbox.loading}
            className="min-h-20 flex-1 overflow-y-auto overscroll-contain focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-coop-primary">
            {inbox.loading ? <LoadingState label="Loading notifications…" />
              : inbox.error ? <div role="alert">
                  <EmptyState icon={CircleAlert} title="Notifications unavailable" description={inbox.error}
                    action={<Button size="compact" onClick={() => void inbox.refresh()}>Retry notifications</Button>} />
                </div>
              : inbox.items.length === 0 ? <EmptyState icon={Bell}
                  title={hasFilters ? "No matching notifications" : inbox.filter === "unread" ? "No unread notifications" : inbox.filter === "read" ? "No read notifications yet" : "No notifications yet"}
                  description={hasFilters ? "Try changing your search or category." : inbox.filter === "unread" ? "You’re all caught up." : "Alerts addressed to your account will appear here."} />
              : <ul className="divide-y divide-portal-border-subtle">{inbox.items.map((notification) => (
                <li key={notification.id} className={notification.read ? "bg-surface-card" : "bg-surface-muted"}>
                  <div className="flex items-start gap-3 p-3 sm:px-4">
                    <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-portal-control bg-status-info-surface text-status-info">{notificationIcons[notification.type] ?? <Bell className="h-4 w-4" aria-hidden="true" />}</span>
                    <div className="min-w-0 flex-1">
                      <button type="button" disabled={inbox.busy} onClick={async () => {
                        if (inbox.busy) return;
                        if (!notification.read && !await inbox.markRead(notification.id)) return;
                        const href = notificationHref(notification.type, routePrefix,notification);
                        if (href) { close(); router.push(href); }
                        else if (!expanded) expandCenter();
                      }} className={`block w-full rounded-portal-control text-start hover:text-coop-primary ${focusStyle}`}>
                        <span className="flex items-start gap-2"><span className={`min-w-0 flex-1 text-support [overflow-wrap:anywhere] ${notification.read ? "font-medium" : "font-semibold"}`}>{notification.title}</span>{!notification.read && <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-coop-dashboard-green" role="img" aria-label="Unread" />}</span>
                        <span className={`mt-1 block whitespace-pre-wrap text-caption text-portal-muted [overflow-wrap:anywhere] ${expanded ? "" : "line-clamp-3"}`}>{notification.message}</span>{notification.actorName&&<span className="mt-1 block text-caption text-portal-secondary">{notification.actorName}{notification.actorRole?"  -  "+notification.actorRole.replaceAll("_"," "):""}</span>}<span className="mt-1 block text-caption font-semibold text-coop-dashboard-green">View Details</span>
                      </button>
                      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
                        <time dateTime={notification.createdAt} title={new Date(notification.createdAt).toLocaleString("en-PH", { timeZone: "Asia/Manila" })} className="text-caption text-portal-secondary">{notificationRelativeTime(notification.createdAt, now)}</time>
                        {notification.read && <span className="text-caption text-portal-secondary">Read</span>}
                        {!notification.read && <button type="button" disabled={inbox.busy} onClick={() => void inbox.markRead(notification.id)} aria-label={`Mark ${notification.title} as read`} className={actionButtonStyles()}><Check className="h-3 w-3" aria-hidden="true" />Mark as read</button>}
                      </div>
                    </div>
                  </div>
                </li>
              ))}</ul>}
            {!inbox.loading && !inbox.error && inbox.hasMore && <div className="px-4 py-3 text-center"><Button size="compact" loading={inbox.loadingMore} disabled={inbox.busy} onClick={() => void inbox.loadMore()}>{inbox.loadingMore ? "Loading…" : "Load more notifications"}</Button></div>}
          </div>
          {expanded&&<nav aria-label="Communication tools" className="flex flex-wrap justify-center gap-2 border-t border-portal-border p-3"><Link className={actionButtonStyles()} href={`${routePrefix}/${routePrefix?"communication":"notifications"}`}>Activity Inbox & Member Messages</Link><Link className={actionButtonStyles()} href={`${routePrefix}/announcements`}>Announcements</Link></nav>}
          {!expanded && <div className="flex shrink-0 justify-center border-t border-portal-border p-3"><Button onClick={expandCenter}>View All Notifications</Button></div>}
  </>;
  return (
    <>
      <button ref={bell} type="button" aria-label="Open notifications" aria-expanded={open}
        aria-haspopup="dialog" aria-controls={open && !expanded ? panelId : undefined} aria-describedby={`${panelId}-count`}
        onClick={() => {
          if (open) close();
          else { positionPanel(false); setExpanded(false); setSearchDraft(""); setNow(Date.now()); setOpen(true); void inbox.resetRecent(); }
        }}
        className={`relative flex size-control-compact shrink-0 items-center justify-center rounded-full border border-portal-border bg-surface-card text-portal-secondary transition-colors hover:border-coop-dashboard-green hover:bg-surface-page hover:text-coop-dashboard-green ${focusStyle}`}>
        <Bell className="size-icon-compact" aria-hidden="true" />
        {inbox.unreadCount !== null && inbox.unreadCount > 0 && <span aria-hidden="true" className="absolute -right-1.5 -top-1.5 flex min-h-5 min-w-5 items-center justify-center rounded-full border-2 border-surface-card bg-status-danger px-0.5 text-caption font-bold leading-none text-white">{inbox.unreadCount > 99 ? "99+" : inbox.unreadCount}</span>}
      </button>
      <span id={`${panelId}-count`} className="sr-only">{inbox.unreadCount === null ? "Unread notification count unavailable" : `${inbox.unreadCount} unread notifications`}</span>
      {open && (expanded ? <ActionDialog title="Notification Center" icon={Bell} returnFocusRef={bell} className="max-w-[720px]" onClose={() => close(true)}
        subtitle={inbox.unreadCount === null ? "Unread count unavailable" : `${inbox.unreadCount} unread`}
        footer={<><Button className="mr-auto" onClick={backToRecent}><ArrowLeft className="h-4 w-4" aria-hidden="true" />Back to Recent</Button>
          <Button size="compact" aria-label="Refresh notifications" disabled={inbox.loading || inbox.busy} onClick={() => void inbox.refresh()}><RefreshCw className="h-4 w-4" aria-hidden="true" />Refresh</Button>
          <span className="text-caption text-portal-secondary">{inbox.total === null ? "History unavailable" : `${inbox.items.length} of ${inbox.total} alerts`}</span></>}>
        {content}
      </ActionDialog> : createPortal(<div ref={panel} id={panelId} role="dialog" aria-modal={false} aria-labelledby={`${panelId}-title`} tabIndex={-1}
        style={position} className="fixed z-[70] flex flex-col overflow-y-auto ui-card shadow-portal-dropdown outline-none">{content}</div>, document.body))}

    </>
  );
}
