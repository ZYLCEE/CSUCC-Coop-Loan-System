"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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

function createNavGroups(prefix: string, committeeAccess: boolean): NavSection[] {
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
        ...(committeeAccess ? [{ icon: Users, label: "Committee Accounts", href: href("committee-accounts") }] : []),
        { icon: Folder, label: "Documents", href: href("documents") },
        { icon: BarChart3, label: "Reports", href: href("reports") },
        { icon: ClipboardList, label: "Active Logs", href: href("active-logs") },
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
  const { isCollapsed, isMobile, toggleSidebar } = useSidebar();
  const toggleButton = useRef<HTMLButtonElement>(null);
  const { user, signOut,can } = useAdminAuth();
  const role = getAdminRole(user) ?? "super_admin";
  const accountName = user?.user_metadata.full_name;
  const displayName = (typeof accountName === "string" ? accountName.trim() : "") || user?.email || "Account";
  const roleLabel = role === "admin" ? "Administrator" : "Super Administrator";
  const initials = displayName.split(/[\s@._-]+/).filter(Boolean).slice(0,2).map((part:string)=>part[0]?.toUpperCase()??"").join("");
  const legacyRoute =
    !pathname.startsWith("/admin/") &&
    !pathname.startsWith("/super-admin/");
  const navGroups = useMemo(
    () => createNavGroups(legacyRoute ? "" : role === "super_admin" ? "/super-admin" : "/admin", role === "super_admin"||can("committee.accounts.manage")),
    [legacyRoute, role,can],
  );
  const navItemClass = (isActive: boolean) =>
    `${styles.item} ${isActive ? styles.active : ""} ${isCollapsed ? "justify-center" : "gap-2.5 px-3"}`;

  return (
    <aside
      aria-label="CSUCC MPC sidebar"
      className={`${styles.sidebar} ${styles.adminSidebar} fixed start-0 top-0 z-20 flex flex-col bg-coop-dashboard-green text-white`}
      onKeyDown={(event) => {
        if (event.key === "Escape" && isMobile && !isCollapsed) {
          toggleSidebar();
          toggleButton.current?.focus();
        }
      }}
    >
      <div className={`${styles.header} flex shrink-0 items-center border-b border-white/10 ${isCollapsed ? "justify-center px-0" : "justify-between gap-3 px-4"}`}>
        {!isCollapsed && (
          <div className="flex min-w-0 items-center gap-2">
            <span title={cooperativeName} className={`${styles.brand} truncate text-caption font-bold uppercase leading-none tracking-wide`}>
              {cooperativeName}
            </span>
          </div>
        )}
        <button
          ref={toggleButton}
          type="button"
          onClick={toggleSidebar}
          aria-label="Toggle sidebar"
          aria-expanded={!isCollapsed}
          aria-controls="sidebar-navigation"
          title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          className={`${styles.toggle} flex shrink-0 items-center justify-center border border-white/10 bg-white/[0.04] transition-colors`}
        >
          <Menu className="size-icon" strokeWidth={2} aria-hidden="true" />
        </button>
      </div>

      <nav id="sidebar-navigation" aria-label="Main navigation" className={`${styles.navigation} ${styles.adminNavigation}`}>
        <div role="group" aria-label="Signed-in account" title={isCollapsed?displayName+" · "+roleLabel:undefined}
          className={styles.account+" "+(isCollapsed?styles.accountCollapsed:"")}>
          <span className={styles.avatar} aria-hidden="true">{initials}</span>
          <div className={isCollapsed?"sr-only":"min-w-0"}>
            <p className={styles.accountName} title={displayName}>{displayName}</p>
            <p className={styles.accountRole}>{roleLabel}</p>
          </div>
        </div>
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
                      onNavigate={() => {
                        if (isMobile && !isCollapsed) toggleSidebar();
                      }}
                      aria-current={pathname === item.href ? "page" : undefined}
                      title={isCollapsed ? item.label : undefined}
                    >
                      <item.icon className="size-icon shrink-0" strokeWidth={1.9} aria-hidden="true" />
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
          <LogOut className="size-icon shrink-0" strokeWidth={1.9} aria-hidden="true" />
          <span className={isCollapsed ? "sr-only" : "whitespace-nowrap"}>Log Out</span>
        </button>
      </div>
    </aside>
  );
}
