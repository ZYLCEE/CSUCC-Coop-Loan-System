"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { useSidebar } from "@/contexts/SidebarContext";
import { useAdminAuth } from "@/components/auth/AdminAuthProvider";
import { getAdminRole } from "@/lib/auth/roles";
import {
  LayoutDashboard,
  FileText,
  Users,
  CreditCard,
  Bell,
  Megaphone,
  Folder,
  Layers3,
  BarChart3,
  ClipboardList,
  Settings,
  User,
  LogOut,
  Menu,
  type LucideIcon,
} from "lucide-react";
import { adminRequest } from "@/lib/adminRequest";
import styles from "./Sidebar.module.css";

type NavItem = {
  icon: LucideIcon;
  label: string;
  href: string;
};

type NavSection = {
  label: string;
  items: NavItem[];
};

function createNavGroups(prefix: string): NavSection[] {
  const href = (path: string) => `${prefix}/${path}`;
  return [
    {
      label: "MAIN",
      items: [
        { icon: LayoutDashboard, label: "Dashboard", href: href("dashboard") },
      ],
    },
    {
      label: "LOAN MANAGEMENT",
      items: [
        { icon: FileText, label: "Loan Applications", href: href("loan-applications") },
        { icon: Users, label: "All Accounts", href: href(prefix ? "all-accounts" : "members") },
        { icon: CreditCard, label: "Active Loans", href: href("active-loans") },
      ],
    },
    {
      label: "COMMUNICATION",
      items: [
        { icon: Bell, label: "Notifications", href: href(prefix ? "communication" : "notifications") },
        { icon: Megaphone, label: "Announcements", href: href("announcements") },
      ],
    },
    {
      label: "SYSTEM MANAGEMENT",
      items: [
        { icon: Folder, label: "Documents", href: href(prefix ? "system-management" : "documents") },
        { icon: Layers3, label: "Content Manager", href: href("content-manager") },
        { icon: BarChart3, label: "Reports", href: href("reports") },
        { icon: ClipboardList, label: "Audit Logs", href: href("audit-logs") },
      ],
    },
    {
      label: "ACCOUNT",
      items: [
        { icon: Settings, label: "Settings", href: href("settings") },
        { icon: User, label: "My Profile", href: href("profile") },
      ],
    },
  ];
}

export default function Sidebar() {
  const [cooperativeName, setCooperativeName] = useState("CSUCC MPC");
  useEffect(() => {
    let active = true;
    void adminRequest("general").then(data => { if (active && data.cooperativeName) setCooperativeName(data.cooperativeName); }).catch(() => {});
    const changed = (event: Event) => setCooperativeName((event as CustomEvent).detail.cooperativeName);
    window.addEventListener("coop-settings-changed", changed);
    return () => { active = false; window.removeEventListener("coop-settings-changed", changed); };
  }, []);
  const pathname = usePathname();
  const { isCollapsed, toggleSidebar } = useSidebar();
  const { user, signOut } = useAdminAuth();
  const role = getAdminRole(user) ?? "super_admin";
  const legacyRoute =
    !pathname.startsWith("/admin/") &&
    !pathname.startsWith("/super-admin/");
  const navGroups = useMemo(
    () => createNavGroups(legacyRoute ? "" : role === "super_admin" ? "/super-admin" : "/admin"),
    [legacyRoute, role],
  );
  const navItemClass = (isActive: boolean) =>
    `${styles.item} ${isActive
      ? "bg-white text-[#155D3B]"
      : "text-white hover:bg-white/10"
    } ${isCollapsed ? "justify-center px-0" : "gap-2.5 px-3"}`;

  return (
    <aside
      aria-label="CSUCC MPC sidebar"
      className={`${styles.sidebar} fixed left-0 top-0 z-20 flex flex-col bg-[#155D3B] text-white transition-[width] duration-300 motion-reduce:transition-none ${isCollapsed ? "w-[76px]" : "w-64"}`}
    >
      <div className={`${styles.header} flex shrink-0 items-center border-b border-white/10 ${isCollapsed ? "justify-center px-0" : "justify-between px-4"}`}>
        {!isCollapsed && (
          <h1 title={cooperativeName} className="truncate text-xs font-bold uppercase leading-none tracking-wide text-[#E7C84B]">
            {cooperativeName}
          </h1>
        )}
        <button
          type="button"
          onClick={toggleSidebar}
          aria-label="Toggle sidebar"
          aria-expanded={!isCollapsed}
          aria-controls="sidebar-navigation"
          title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          className={`${styles.toggle} flex shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-[#E7C84B] transition-colors hover:bg-white/10`}
        >
          <Menu className="h-5 w-5" strokeWidth={2} aria-hidden="true" />
        </button>
      </div>

      <nav id="sidebar-navigation" aria-label="Main navigation" className={styles.navigation}>
        <div className={styles.groups}>
          {navGroups.map((group) => (
            <section key={group.label} aria-label={group.label}>
              <h2 className={isCollapsed ? "sr-only" : styles.heading}>{group.label}</h2>
              <ul className={styles.items}>
                {group.items.map((item) => (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={navItemClass(pathname === item.href)}
                      aria-current={pathname === item.href ? "page" : undefined}
                      title={isCollapsed ? item.label : undefined}
                    >
                      <item.icon className="h-[18px] w-[18px] shrink-0" strokeWidth={1.9} aria-hidden="true" />
                      <span className={isCollapsed ? "sr-only" : "whitespace-nowrap"}>{item.label}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </nav>

      <div className={`${styles.footer} mt-auto shrink-0 border-t border-white/15`}>
        <button
          type="button"
          onClick={() => {
            void signOut().catch((error: unknown) => {
              console.error("Failed to sign out admin:", error);
            });
          }}
          className={`${navItemClass(false)} w-full`}
          aria-label="Log out"
          title={isCollapsed ? "Log Out" : undefined}
        >
          <LogOut className="h-[18px] w-[18px] shrink-0" strokeWidth={1.9} aria-hidden="true" />
          <span className={isCollapsed ? "sr-only" : "whitespace-nowrap"}>Log Out</span>
        </button>
      </div>
    </aside>
  );
}
