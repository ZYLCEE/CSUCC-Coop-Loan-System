"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Banknote, Eye, History, MoreVertical } from "lucide-react";

interface RecordActionsMenuProps {
  label: string;
  onView: () => void;
  onPayment?: () => void;
  canRecordPayment?: boolean;
}

export default function RecordActionsMenu({ label, onView, onPayment, canRecordPayment = false }: RecordActionsMenuProps) {
  const menuId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (!position) return;
    menu.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    const dismiss = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!menu.current?.contains(target) && !trigger.current?.contains(target)) setPosition(null);
    };
    const close = () => setPosition(null);
    const onScroll = (event: Event) => {
      if (!(event.target instanceof Node) || !menu.current?.contains(event.target)) close();
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
    const rect = trigger.current?.getBoundingClientRect();
    if (!rect) return;
    const height = onPayment ? 100 : 56;
    setPosition({
      left: Math.max(12, Math.min(rect.right - 200, window.innerWidth - 212)),
      top: rect.bottom + height + 8 <= window.innerHeight ? rect.bottom + 6 : Math.max(12, rect.top - height - 6),
    });
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const index = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (current + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
      items[index]?.focus();
    } else if (event.key === "Escape" || event.key === "Tab") {
      if (event.key === "Escape") event.preventDefault();
      setPosition(null);
      trigger.current?.focus();
    }
  };

  const select = (action: () => void) => {
    setPosition(null);
    trigger.current?.focus();
    action();
  };
  const itemClass = "flex min-h-10 w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#155D3B]/30";

  return <>
    <button ref={trigger} type="button" aria-label={`Open actions for ${label}`} aria-haspopup="menu" aria-expanded={!!position} aria-controls={position ? menuId : undefined}
      className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 shadow-sm transition-colors hover:border-[#155D3B]/40 hover:bg-[#F0F7F3] hover:text-[#155D3B] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#155D3B]"
      onClick={() => position ? setPosition(null) : openMenu()}
      onKeyDown={event => { if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); openMenu(); } }}>
      <MoreVertical className="h-[18px] w-[18px]" aria-hidden="true" />
    </button>
    {position && createPortal(<div ref={menu} id={menuId} role="menu" aria-label={`Actions for ${label}`} onKeyDown={handleKeyDown}
      style={position} className="fixed z-[70] w-[200px] rounded-xl border border-slate-200 bg-white p-1.5 shadow-[0_12px_30px_rgba(15,23,42,0.16)]">
      <button type="button" role="menuitem" tabIndex={-1} onClick={() => select(onView)} className={`${itemClass} text-slate-700 hover:bg-slate-50 hover:text-[#155D3B]`}>
        <Eye className="h-4 w-4" aria-hidden="true" />View details
      </button>
      {onPayment && <button type="button" role="menuitem" tabIndex={-1} onClick={() => select(onPayment)} className={`${itemClass} text-[#155D3B] hover:bg-[#F0F7F3]`}>
        {canRecordPayment ? <><Banknote className="h-4 w-4" aria-hidden="true" />Record payment</> : <><History className="h-4 w-4" aria-hidden="true" />Payment history</>}
      </button>}
    </div>, document.body)}
  </>;
}
