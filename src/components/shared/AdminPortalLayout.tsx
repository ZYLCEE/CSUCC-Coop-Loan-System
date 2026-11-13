"use client";

import type { AdminRole } from "@/lib/auth/roles";
import { AdminAuthProvider } from "@/components/auth/AdminAuthProvider";
import { SecureAdminActionProvider } from "@/components/auth/SecureAdminActionProvider";
import Sidebar from "@/components/shared/Sidebar";
import Navbar from "@/components/shared/Navbar";
import { SidebarProvider } from "@/contexts/SidebarContext";
import SuperAdminLoanAlerts from "@/components/shared/SuperAdminLoanAlerts";
import PortalFrame from "./PortalFrame";

export function PortalShell({ children, role }: { children: React.ReactNode; role: AdminRole }) {
  return <PortalFrame sidebar={<Sidebar/>} header={<Navbar/>} utilities={role==="super_admin"?<SuperAdminLoanAlerts/>:undefined}>{children}</PortalFrame>;
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
