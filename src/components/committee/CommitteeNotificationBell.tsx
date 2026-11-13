"use client";

import { Bell, CheckCheck, RefreshCw, X } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useCommitteeAuth } from "./CommitteeAuthProvider";
import { getPortalPrefix, type CommitteeNotification } from "@/lib/committee";
import { committeeDate } from "@/lib/committeePresentation";
import { Button } from "@/components/ui/Button";
import CommitteePacket from "./CommitteePacket";
import { useCommitteeInbox } from "./useCommitteeInbox";

export default function CommitteeNotificationBell() {
  const { role, portalPrefix } = useCommitteeAuth();
  const router = useRouter();
  const { rows, error, busy, load, mark, unread } = useCommitteeInbox();
  const [open, setOpen] = useState(false);
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [assignment, setAssignment] = useState<string | null>(null);
  const [position, setPosition] = useState({ left: 12, top: 64, width: 384, maxHeight: 480 });
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();

  const close = useCallback((restore = true) => {
    setOpen(false);
    if (restore) trigger.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    if (!open) return;

    const positionPanel = () => {
      const rect = trigger.current?.getBoundingClientRect();
      if (!rect) return;
      const viewport = window.visualViewport;
      const leftEdge = viewport?.offsetLeft ?? 0;
      const topEdge = viewport?.offsetTop ?? 0;
      const contentStart = Math.max(leftEdge, trigger.current?.closest("header")?.getBoundingClientRect().left ?? leftEdge);
      const right = leftEdge + (viewport?.width ?? window.innerWidth);
      const bottom = topEdge + (viewport?.height ?? window.innerHeight);
      const width = Math.max(0, Math.min(384, right - contentStart - 24));
      const left = Math.max(contentStart + 12, Math.min(rect.right - width, right - width - 12));
      const top = bottom - rect.bottom >= 240 ? Math.max(topEdge + 12, rect.bottom + 8) : topEdge + 12;

      setPosition({ left, top, width, maxHeight: Math.max(0, Math.min(480, bottom - top - 12)) });
    };

    positionPanel();
    panel.current?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
    const outside = (event: Event) => {
      const target = event.target as Node;
      if (!panel.current?.contains(target) && !trigger.current?.contains(target)) close(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close();
      }
    };

    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    document.addEventListener("keydown", escape);
    window.addEventListener("resize", positionPanel);
    window.addEventListener("scroll", positionPanel, true);
    window.visualViewport?.addEventListener("resize", positionPanel);
    window.visualViewport?.addEventListener("scroll", positionPanel);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", outside);
      document.removeEventListener("keydown", escape);
      window.removeEventListener("resize", positionPanel);
      window.removeEventListener("scroll", positionPanel, true);
      window.visualViewport?.removeEventListener("resize", positionPanel);
      window.visualViewport?.removeEventListener("scroll", positionPanel);
    };
  }, [open, close]);

  const select = async (row: CommitteeNotification) => {
    if (!row.read && !await mark(row.id)) return;
    if (row.assignmentId && row.accessAvailable) {
      close();
      setAssignment(row.assignmentId);
    }
  };
  const filtered = (rows ?? []).filter((row) => !onlyUnread || !row.read);

  return (
    <>
      <button
        ref={trigger}
        type="button"
        onClick={() => {
          if (open) close();
          else {
            setOpen(true);
            void load();
          }
        }}
        className="relative flex size-control-compact shrink-0 items-center justify-center rounded-full border border-portal-border bg-surface-card text-portal-secondary transition-colors hover:border-coop-dashboard-green hover:bg-surface-page hover:text-coop-dashboard-green focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-coop-primary"
        aria-label={"My notifications" + (unread ? `, ${unread} unread` : "")}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
      >
        <Bell className="size-icon-compact" aria-hidden="true" />
        {unread > 0 && (
          <span className="absolute -right-1.5 -top-1.5 flex min-h-5 min-w-5 items-center justify-center rounded-full border-2 border-surface-card bg-status-danger px-0.5 text-caption font-bold leading-none text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>
      {open && createPortal(
        <div
          ref={panel}
          id={id}
          role="region"
          aria-label="My notifications"
          style={position}
          className="fixed z-[70] flex flex-col overflow-y-auto ui-card shadow-portal-dropdown outline-none"
        >
          <div className="shrink-0 border-b border-portal-border p-3 sm:px-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-card-title">Notifications</h2>
                <p className="mt-1 text-caption text-portal-secondary">{unread} unread</p>
              </div>
              <div className="flex items-center gap-1">
                <button type="button" aria-label="Refresh notifications" disabled={busy} onClick={() => void load()} className="ui-icon-button ui-button--ghost">
                  <RefreshCw className="size-icon-compact" aria-hidden="true" />
                </button>
                <button type="button" className="ui-icon-button ui-button--ghost" aria-label="Close notifications" onClick={() => close()}>
                  <X className="size-icon" aria-hidden="true" />
                </button>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <div role="group" aria-label="Notification filters" className="flex flex-wrap gap-1 rounded-portal-control bg-surface-muted p-1">
                <Button size="compact" variant={!onlyUnread ? "primary" : "ghost"} aria-pressed={!onlyUnread} onClick={() => setOnlyUnread(false)}>All</Button>
                <Button size="compact" variant={onlyUnread ? "primary" : "ghost"} aria-pressed={onlyUnread} onClick={() => setOnlyUnread(true)}>Unread</Button>
              </div>
              <Button size="compact" disabled={busy || !unread} onClick={() => void mark(null)}>
                <CheckCheck className="size-icon-compact" aria-hidden="true" />
                Mark all as read
              </Button>
            </div>
          </div>
          {error && (
            <div className="shrink-0 border-b border-portal-border bg-status-danger-surface px-4 py-2">
              <p role="alert" className="text-caption text-status-danger">{error}</p>
              <Button size="compact" className="mt-2" onClick={() => void load()}>Retry notifications</Button>
            </div>
          )}
          <div
            role="region"
            aria-label="Notification list"
            tabIndex={0}
            aria-busy={!rows && !error}
            className="min-h-20 flex-1 overflow-y-auto overscroll-contain focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-coop-primary"
          >
            {!rows && !error ? (
              <p role="status" className="p-4 text-support">Loading notifications…</p>
            ) : filtered.length ? (
              <ul className="divide-y divide-portal-border-subtle">
                {filtered.map((row) => (
                  <li key={row.id} className={row.read ? "bg-surface-card" : "bg-surface-muted"}>
                    <button
                      type="button"
                      disabled={busy}
                      className="flex w-full items-start gap-3 p-3 text-left hover:bg-surface-page focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-coop-primary sm:px-4"
                      onClick={() => void select(row)}
                    >
                      <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-portal-control bg-status-info-surface text-status-info">
                        <Bell className="size-icon-compact" aria-hidden="true" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-start gap-2">
                          <span className={`min-w-0 flex-1 text-support [overflow-wrap:anywhere] ${row.read ? "font-medium" : "font-semibold"}`}>{row.title}</span>
                          {!row.read && <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-coop-dashboard-green" role="img" aria-label="Unread" />}
                        </span>
                        <span className="mt-1 block whitespace-pre-wrap break-words text-caption text-portal-muted [overflow-wrap:anywhere]">{row.message}</span>
                        <time dateTime={row.createdAt} className="mt-1 block text-caption text-portal-secondary">{committeeDate(row.createdAt)}</time>
                        {row.assignmentId && (
                          <span className="mt-1 block text-caption font-semibold text-coop-dashboard-green">
                            {row.accessAvailable ? "View Details" : "Application access is no longer available."}
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="p-6 text-center text-support text-portal-secondary">
                {onlyUnread ? "You're all caught up." : "No notifications yet."}
              </p>
            )}
          </div>
          <div className="flex shrink-0 justify-center border-t border-portal-border p-3">
            <Button onClick={() => { close(); router.push((portalPrefix ?? getPortalPrefix(role)) + "/notifications"); }}>
              View All Notifications
            </Button>
          </div>
        </div>,
        document.body,
      )}
      {assignment && (
        <CommitteePacket
          key={assignment}
          assignmentId={assignment}
          onClose={() => {
            setAssignment(null);
            trigger.current?.focus({ preventScroll: true });
          }}
        />
      )}
    </>
  );
}
