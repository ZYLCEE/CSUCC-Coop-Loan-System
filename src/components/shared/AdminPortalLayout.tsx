"use client";

import { AdminRole } from "@/lib/auth/roles";
import { AdminAuthProvider } from "@/components/auth/AdminAuthProvider";
import { SecureAdminActionProvider } from "@/components/auth/SecureAdminActionProvider";
import Sidebar from "@/components/shared/Sidebar";
import Navbar from "@/components/shared/Navbar";
import { SidebarProvider, useSidebar } from "@/contexts/SidebarContext";

function PortalContent({ children }: { children: React.ReactNode }) {
  const { isCollapsed } = useSidebar();
  return (
    <main
      className={`mt-[72px] min-w-0 px-4 py-6 sm:px-6 xl:px-9 transition-all duration-300 ${
        isCollapsed ? "ml-[76px]" : "ml-64"
      }`}
    >
      {children}
    </main>
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
      <SecureAdminActionProvider enabled={role === "super_admin"}>
        <SidebarProvider>
          <div className="portal-shell min-h-screen bg-[#F5F6F8]">
            <Sidebar />
            <Navbar />
            <PortalContent>{children}</PortalContent>
          </div>
        </SidebarProvider>
      </SecureAdminActionProvider>
    </AdminAuthProvider>
  );
}
