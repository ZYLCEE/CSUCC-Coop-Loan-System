"use client";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import styles from "./Announcements.module.css";

export default function AnnouncementDialog({ title, children, footer, onClose, busy = false, wide = false }: {
  title: string; children: ReactNode; footer?: ReactNode; onClose: () => void; busy?: boolean; wide?: boolean;
}) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  const busyRef = useRef(busy);
  useEffect(() => { closeRef.current = onClose; busyRef.current = busy; }, [onClose, busy]);
  useEffect(() => {
    const previous = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel.current?.focus();
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busyRef.current) { event.preventDefault(); closeRef.current(); }
      if (event.key !== "Tab") return;
      const controls = [...(panel.current?.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex="0"]') ?? [])].filter((control) => control.getClientRects().length > 0);
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panel.current)) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", keyboard);
    return () => { document.body.style.overflow = overflow; document.removeEventListener("keydown", keyboard); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  return createPortal(<div className={`${styles.scope} fixed inset-0 z-[80] flex items-center justify-center bg-[#0F172A]/35 p-3 sm:p-6`}>
    <div ref={panel} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className={`flex max-h-[90dvh] w-full min-w-0 flex-col overflow-hidden rounded-2xl border border-[#E2E8F0] bg-white shadow-xl outline-none ${wide ? "max-w-[1080px]" : "max-w-[720px]"}`}>
      <div className="flex shrink-0 items-start justify-between gap-3 border-b border-[#E2E8F0] px-4 py-4 sm:px-6"><h2 id={titleId} className="text-base font-semibold">{title}</h2><button type="button" aria-label="Close announcement panel" disabled={busy} onClick={onClose} className="rounded-lg p-1 text-[#64748B] hover:bg-slate-100"><X className="h-5 w-5" /></button></div>
      <div className="min-h-0 overflow-y-auto overscroll-contain p-4 sm:p-6">{children}</div>
      {footer && <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-[#E2E8F0] px-4 py-3 sm:px-6">{footer}</div>}
    </div>
  </div>, document.body);
}
