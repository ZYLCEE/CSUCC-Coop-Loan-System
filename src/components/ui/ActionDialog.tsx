"use client";

import { useId, useSyncExternalStore, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { CircleHelp, X, type LucideIcon } from "lucide-react";
import { useDialogFocus } from "./useDialogFocus";

const subscribe = () => () => {};
const clientBody = () => document.body;
const serverBody = () => null;
export type ActionTone = "primary" | "destructive" | "warning" | "success";
export interface ActionDialogProps {
  title: string;
  titleId?: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  busy?: boolean;
  className?: string;
  overlayClassName?: string;
  closeLabel?: string;
  dismissOnBackdrop?: boolean;
  closeOnEscape?: boolean;
  showClose?: boolean;
  icon?: LucideIcon;
  tone?: ActionTone;
  returnFocusRef?: RefObject<HTMLElement | null>;
}

export function ActionDialog(props: ActionDialogProps) {
  const body = useSyncExternalStore(subscribe, clientBody, serverBody);
  // Mount focus handling after the portal target exists, including during hydration.
  return body ? createPortal(<DialogPanel {...props} />, body) : null;
}

function DialogPanel({ title, titleId, subtitle, children, footer, onClose, busy = false,
  className = "max-w-2xl", overlayClassName = "", closeLabel, dismissOnBackdrop = false,
  closeOnEscape = true, showClose = true, icon: Icon = CircleHelp, tone = "primary", returnFocusRef,
}: ActionDialogProps) {
  const id = useId();
  const headingId = titleId ?? id;
  const close = () => { if (!busy) onClose(); };
  const { panel, onKeyDown } = useDialogFocus(() => { if (closeOnEscape) close(); }, true, returnFocusRef);
  return <div data-action-dialog-root className={`action-backdrop ui-dialog-overlay ${overlayClassName}`}
    onMouseDown={event => { if (dismissOnBackdrop && event.target === event.currentTarget) close(); }}>
    <section ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={headingId}
      onClick={event => {
        if (event.target instanceof Element && event.target.closest("[data-dialog-close]")?.closest('[role="dialog"]') === event.currentTarget) close();
      }}
      aria-describedby={subtitle ? `${id}-description` : undefined} aria-busy={busy}
      onKeyDown={onKeyDown} className={`ui-dialog-panel flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden outline-none ${className}`}>
      <header className="ui-dialog-header shrink-0">
        <div className="flex min-w-0 items-center gap-3">
          <span className={`ui-dialog-icon ui-dialog-icon--${tone}`}><Icon aria-hidden="true" className="h-5 w-5" /></span>
          <div className="min-w-0"><h2 id={headingId} className="ui-dialog-title">{title}</h2>
            {subtitle && <p id={`${id}-description`} className="mt-1 break-words text-support text-portal-secondary">{subtitle}</p>}
          </div>
        </div>
        {showClose && <button type="button" className="ui-icon-button ui-button--ghost" aria-label={closeLabel ?? `Close ${title}`} disabled={busy} onClick={close}>
          <X className="size-icon" aria-hidden="true" />
        </button>}
      </header>
      <div className="ui-dialog-body min-h-0 overflow-y-auto overscroll-contain p-portal-card">{children}</div>
      {footer && <footer className="ui-dialog-footer shrink-0">{footer}</footer>}
    </section>
  </div>;
}
