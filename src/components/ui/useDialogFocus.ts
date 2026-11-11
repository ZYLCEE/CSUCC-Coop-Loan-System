"use client";

import { useEffect, useRef, type KeyboardEvent, type RefObject } from "react";

const stack: HTMLElement[] = [];
const inertBefore = new Map<HTMLElement, boolean>();
const restoreTargets = new Map<HTMLElement, Element | null>();
let overflowBefore = "";
let paddingBefore = "";
let backgroundObserver: MutationObserver | null = null;

function syncBackground() {
  for (const [element, inert] of inertBefore) element.inert = inert;
  inertBefore.clear();
  stack.forEach((panel, index) => {
    const layer = panel.closest<HTMLElement>("[data-action-dialog-root]");
    if (layer) layer.style.zIndex = String(150 + index * 10);
  });
  const root = stack.at(-1)?.closest("[data-action-dialog-root]");
  if (!root) return;
  for (const child of document.body.children) {
    if (child instanceof HTMLElement && child !== root && !child.contains(root)) {
      inertBefore.set(child, child.inert);
      child.inert = true;
    }
  }
}

export function useDialogFocus<T extends HTMLElement = HTMLElement>(onClose: () => void, active = true, returnFocusRef?: RefObject<HTMLElement | null>) {
  const panel = useRef<T>(null);

  useEffect(() => {
    const current = panel.current;
    if (!active || !current) return;
    const previous = document.activeElement;
    const explicitTarget = returnFocusRef?.current;
    restoreTargets.set(current, previous);
    if (!stack.length) {
      overflowBefore = document.body.style.overflow;
      paddingBefore = document.body.style.paddingRight;
      const gutter = window.innerWidth - document.documentElement.clientWidth;
      document.body.style.overflow = "hidden";
      if (gutter > 0) document.body.style.paddingRight = `${parseFloat(getComputedStyle(document.body).paddingRight) + gutter}px`;
    }
    stack.push(current);
    syncBackground();
    if (!backgroundObserver) {
      backgroundObserver = new MutationObserver(syncBackground);
      backgroundObserver.observe(document.body, { childList: true });
    }
    (current.querySelector<HTMLElement>("[data-dialog-autofocus]") ?? current).focus({ preventScroll: true });
    const contain = (event: FocusEvent) => {
      if (stack.at(-1) === current && event.target instanceof Node && !current.contains(event.target)) current.focus({ preventScroll: true });
    };
    document.addEventListener("focusin", contain);
    return () => {
      document.removeEventListener("focusin", contain);
      const wasTop = stack.at(-1) === current;
      const fallback = restoreTargets.get(current);
      for (const [other, target] of restoreTargets) {
        if (other !== current && target && current.contains(target)) restoreTargets.set(other, fallback ?? null);
      }
      restoreTargets.delete(current);
      stack.splice(stack.indexOf(current), 1);
      syncBackground();
      if (!stack.length) {
        backgroundObserver?.disconnect();
        backgroundObserver = null;
        document.body.style.overflow = overflowBefore;
        document.body.style.paddingRight = paddingBefore;
      }
      if (wasTop) {
        const target = explicitTarget?.isConnected ? explicitTarget : fallback;
        if (target instanceof HTMLElement && target.isConnected && !target.closest("[inert]")) target.focus({ preventScroll: true });
        else stack.at(-1)?.focus({ preventScroll: true });
      }
    };
  }, [active, returnFocusRef]);

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (stack.at(-1) !== panel.current || event.defaultPrevented || (event.target instanceof Element && event.target.closest('[role="dialog"]') !== panel.current)) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;

    const controls = Array.from(panel.current?.querySelectorAll<HTMLElement>(
      'a[href], button, input, select, textarea, [tabindex], [contenteditable="true"]',
    ) ?? []).filter(control =>
      control.tabIndex >= 0 && !control.matches(":disabled") && !control.closest("[inert]")
      && control.getClientRects().length > 0 && getComputedStyle(control).visibility !== "hidden",
    );
    const first = controls[0];
    const last = controls.at(-1);
    const focused = document.activeElement;
    if (!first || focused === panel.current || focused === (event.shiftKey ? first : last)) {
      event.preventDefault();
      (event.shiftKey ? last : first)?.focus();
    }
  }

  return { panel, onKeyDown };
}
