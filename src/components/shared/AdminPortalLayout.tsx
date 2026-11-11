"use client";

import type { AdminRole } from "@/lib/auth/roles";
import { AdminAuthProvider } from "@/components/auth/AdminAuthProvider";
import { SecureAdminActionProvider } from "@/components/auth/SecureAdminActionProvider";
import Sidebar from "@/components/shared/Sidebar";
import Navbar from "@/components/shared/Navbar";
import { SidebarProvider, useSidebar } from "@/contexts/SidebarContext";
import SuperAdminLoanAlerts from "@/components/shared/SuperAdminLoanAlerts";
import PortalFooter from "./PortalFooter";

export function PortalShell({ children, role }: { children: React.ReactNode; role: AdminRole }) {
  const { isCollapsed, toggleSidebar } = useSidebar();

  return (
    <div className="portal-shell admin-portal-shell" data-sidebar-collapsed={isCollapsed}>
      <Sidebar />
      <Navbar />
      <main className="portal-content">{children}</main>
      <div className="portal-content-watermark" aria-hidden="true" />
      <PortalFooter />
      {role === "super_admin" && <SuperAdminLoanAlerts />}
      <button
        type="button"
        className="portal-sidebar-dismiss"
        tabIndex={-1}
        aria-label="Close sidebar"
        onClick={toggleSidebar}
      />
    </div>
  );
}

export default function AdminPortalLayout({
  children,
  role,
}: {
  children: React.ReactNode;
  role: AdminRole;
}) {
  return (
    <AdminAuthProvider requiredRole={role}>
      <SecureAdminActionProvider>
        <SidebarProvider>
          <PortalShell role={role}>{children}</PortalShell>
        </SidebarProvider>
      </SecureAdminActionProvider>
    </AdminAuthProvider>
  );
}
