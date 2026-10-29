"use client";

import { usePathname } from "next/navigation";
import { CalendarDays } from "lucide-react";
import { useSidebar } from "@/contexts/SidebarContext";
import { useAdminAuth } from "@/components/auth/AdminAuthProvider";
import NotificationPopover from "./notifications/NotificationPopover";

const pageHeaders: Record<string, { title: string; subtitle: string }> = {
  "/dashboard": {
    title: "Dashboard",
    subtitle: "Overview of cooperative activities and system information",
  },
  "/all-accounts": {
    title: "All Accounts",
    subtitle: "Manage member and administrator accounts",
  },
  "/loan-applications": {
    title: "Loan Applications",
    subtitle: "Review and manage member loan applications",
  },
  "/members": {
    title: "All Accounts",
    subtitle: "Manage member and administrator accounts",
  },
  "/active-loans": {
    title: "Active Loans",
    subtitle: "Monitor and manage active member loans",
  },
  "/notifications": {
    title: "Notifications",
    subtitle: "View and manage system notifications",
  },
  "/communication": {
    title: "Communication",
    subtitle: "View cooperative communication",
  },
  "/announcements": {
    title: "Announcements",
    subtitle: "Create and manage cooperative announcements",
  },
  "/documents": {
    title: "Documents",
    subtitle: "Manage cooperative and member documents",
  },
  "/reports": {
    title: "Reports",
    subtitle: "View and generate cooperative reports",
  },
  "/audit-logs": {
    title: "Audit Logs",
    subtitle: "Review system activities and account actions",
  },
  "/system-management": {
    title: "System Management",
    subtitle: "View system information and management resources",
  },
  "/settings": {
    title: "Settings",
    subtitle: "Manage system settings and preferences",
  },
  "/profile": {
    title: "My Profile",
    subtitle: "View and manage your account information",
  },
};

export default function Navbar() {
  const pathname = usePathname();
  const { isCollapsed } = useSidebar();
  const { user, role } = useAdminAuth();
  const routePrefix = pathname.startsWith("/admin/")
    ? "/admin"
    : pathname.startsWith("/super-admin/")
      ? "/super-admin"
      : "";
  const routeSection = pathname.slice(routePrefix.length) || "/dashboard";
  const headerSection =
    routeSection === "/members"
      ? "/all-accounts"
      : routeSection === "/documents"
        ? "/system-management"
        : routeSection;
  const pageHeader = pageHeaders[headerSection] ?? pageHeaders["/dashboard"];

  const currentDate = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const email = user?.email ?? "";
  const displayName =
    typeof user?.user_metadata.full_name === "string"
      ? user.user_metadata.full_name
      : email;
  const initials = displayName
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <header className={`fixed top-0 right-0 z-10 flex h-[72px] items-center justify-between gap-3 border-b border-[#E5E7EB] bg-white px-3 transition-all duration-300 sm:px-7 ${
      isCollapsed ? "left-[76px]" : "left-64"
    }`}>
      {/* Left Section */}
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-base font-bold leading-none text-[#0F172A] sm:text-[20px]" title={pageHeader.title}>
          {pageHeader.title}
        </h1>
        <p className="mt-1 hidden truncate text-[13px] font-medium leading-none text-[#64748B] sm:block" title={pageHeader.subtitle}>
          {pageHeader.subtitle}
        </p>
      </div>

      {/* Right Section */}
      <div className="flex min-w-0 items-center gap-2 sm:gap-3">
        <div className="hidden h-8 shrink-0 items-center gap-1.5 rounded-full border border-[#D1D5DB] bg-white px-3 text-[13px] font-semibold text-[#334155] sm:flex">
          <CalendarDays className="h-[14px] w-[14px] text-[#155D3B]" strokeWidth={2.3} />
          <span>{currentDate}</span>
        </div>

        {/* Notification */}
        {user && role && <NotificationPopover key={`${user.id}:${pathname}`} userId={user.id} routePrefix={routePrefix} />}

        {/* User Profile */}
        <div className="flex min-w-0 items-center gap-2 sm:gap-2.5 sm:pl-1">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#155D3B]">
            <span className="text-[12px] font-bold text-white">{initials}</span>
          </div>
          <div className="min-w-0 max-w-24 sm:max-w-48">
            <p className="truncate text-xs font-bold leading-none text-[#0F172A] sm:text-[14px]" title={displayName}>
              {displayName}
            </p>
            <p className="mt-0.5 truncate text-[10px] font-semibold leading-none text-[#155D3B] sm:text-[11px]" title={role === "admin" ? "Administrator" : "Super Administrator"}>
              {role === "admin" ? "Administrator" : "Super Administrator"}
            </p>
          </div>
        </div>
      </div>
    </header>
  );
}
