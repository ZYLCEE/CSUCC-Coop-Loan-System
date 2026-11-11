import type { KeyboardEvent } from "react";

export function recordMenuPosition(trigger: HTMLElement, width: number, preferredHeight: number) {
  const gap = 6;
  const edge = 12;
  const rect = trigger.getBoundingClientRect();
  const below = window.innerHeight - rect.bottom - edge - gap;
  const above = rect.top - edge - gap;
  const openBelow = below >= preferredHeight || below >= above;

  return {
    left: Math.max(edge, Math.min(rect.right - width, window.innerWidth - width - edge)),
    top: openBelow ? rect.bottom + gap : undefined,
    bottom: openBelow ? undefined : window.innerHeight - rect.top + gap,
    maxHeight: Math.max(0, openBelow ? below : above),
  };
}

export function navigateRecordMenu(event: KeyboardEvent<HTMLElement>, close: () => void) {
  const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)'));
  const index = items.indexOf(document.activeElement as HTMLButtonElement);

  if (event.key === "Escape" || event.key === "Tab") {
    if (event.key === "Escape") event.preventDefault();
    close();
  } else if (items.length && ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
    event.preventDefault();
    const next = event.key === "Home" ? 0
      : event.key === "End" ? items.length - 1
      : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
  }
}
