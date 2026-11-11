"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Banknote, Eye, History, MoreVertical } from "lucide-react";
import { navigateRecordMenu, recordMenuPosition } from "./recordMenu";

interface RecordActionsMenuProps {
  label: string;
  onView: () => void;
  onPayment?: () => void;
  onRepayments?: () => void;
  canRecordPayment?: boolean;
}

export default function RecordActionsMenu({ label, onView, onPayment, onRepayments, canRecordPayment = false }: RecordActionsMenuProps) {
  const menuId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const anchorBounds = useRef<DOMRect | null>(null);
  const [position, setPosition] = useState<ReturnType<typeof recordMenuPosition> | null>(null);

  useEffect(() => {
    if (!position) return;
    menu.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus({ preventScroll: true });
    const dismiss = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!menu.current?.contains(target) && !trigger.current?.contains(target)) setPosition(null);
    };
    const close = () => setPosition(null);
    const onScroll = (event: Event) => {
      if (event.target instanceof Node && menu.current?.contains(event.target)) return;
      const before = anchorBounds.current;
      const after = trigger.current?.getBoundingClientRect();
      // A queued scroll event can arrive after the trigger has already scrolled into view.
      // Keep the menu when its anchor has not moved since opening.
      if (!before || !after || Math.abs(after.top - before.top) > 0.5 || Math.abs(after.left - before.left) > 0.5) close();
    };
    document.addEventListener("pointerdown", dismiss);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [position]);

  const openMenu = () => {
    if (trigger.current) {
      anchorBounds.current = trigger.current.getBoundingClientRect();
      setPosition(recordMenuPosition(trigger.current, 200, 12 + (1 + Number(!!onPayment) + Number(!!onRepayments)) * 36));
    }
  };

  const select = (action: () => void) => {
    setPosition(null);
    trigger.current?.focus();
    action();
  };
  const itemClass = "ui-button ui-button--ghost ui-button--compact w-full justify-start text-start";

  return <>
    <button ref={trigger} type="button" aria-label={`Open actions for ${label}`} aria-haspopup="menu" aria-expanded={!!position} aria-controls={position ? menuId : undefined}
      className="ui-icon-button"
      onClick={() => position ? setPosition(null) : openMenu()}
      onKeyDown={event => { if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); openMenu(); } }}>
      <MoreVertical className="size-icon" aria-hidden="true" />
    </button>
    {position && createPortal(<div ref={menu} id={menuId} role="menu" aria-label={`Actions for ${label}`}
      onKeyDown={event => navigateRecordMenu(event, () => { setPosition(null); trigger.current?.focus({ preventScroll: true }); })}
      style={position} className="ui-card fixed z-[70] w-[200px] overflow-y-auto p-1 shadow-portal-dropdown">
      <button type="button" role="menuitem" tabIndex={-1} onClick={() => select(onView)} className={itemClass}>
        <Eye className="h-4 w-4" aria-hidden="true" />View details
      </button>
      {onRepayments && <button type="button" role="menuitem" tabIndex={-1} onClick={() => select(onRepayments)} className={itemClass}>
        <History className="h-4 w-4" aria-hidden="true" />Repayment details
      </button>}
      {onPayment && <button type="button" role="menuitem" tabIndex={-1} onClick={() => select(onPayment)} className={`${itemClass} text-coop-dashboard-green`}>
        {canRecordPayment ? <><Banknote className="h-4 w-4" aria-hidden="true" />Record payment</> : <><History className="h-4 w-4" aria-hidden="true" />Payment history</>}
      </button>}
    </div>, document.body)}
  </>;
}
