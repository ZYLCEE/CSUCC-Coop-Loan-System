"use client";

import { createContext, useContext, useState, useSyncExternalStore, type ReactNode } from "react";

// Keep this in sync with the portal shell's mobile breakpoint.
const mobileQuery = "(width < 768px)";

function subscribeToViewport(onChange: () => void) {
  const viewport = window.matchMedia(mobileQuery);
  viewport.addEventListener("change", onChange);
  return () => viewport.removeEventListener("change", onChange);
}

function isMobileViewport() {
  return window.matchMedia(mobileQuery).matches;
}

function isMobileOnServer() {
  return false;
}

interface SidebarContextType {
  isCollapsed: boolean;
  isMobile: boolean;
  toggleSidebar: () => void;
}

const SidebarContext = createContext<SidebarContextType | undefined>(undefined);

export function SidebarProvider({ children }: { children: ReactNode }) {
  const isMobile = useSyncExternalStore(subscribeToViewport, isMobileViewport, isMobileOnServer);
  const [collapsedOverride, setCollapsedOverride] = useState<boolean>();
  const isCollapsed = collapsedOverride ?? isMobile;

  const toggleSidebar = () => {
    setCollapsedOverride((current) => !(current ?? isMobile));
  };

  return (
    <SidebarContext.Provider value={{ isCollapsed, isMobile, toggleSidebar }}>
      {children}
    </SidebarContext.Provider>
  );
}

export function useSidebar() {
  const context = useContext(SidebarContext);
  if (context === undefined) {
    throw new Error("useSidebar must be used within a SidebarProvider");
  }
  return context;
}
