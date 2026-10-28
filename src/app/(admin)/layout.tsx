"use client";

import Sidebar from "@/components/shared/Sidebar";
import Navbar from "@/components/shared/Navbar";
import { SidebarProvider, useSidebar } from "@/contexts/SidebarContext";
import { AdminAuthProvider } from "@/components/auth/AdminAuthProvider";
import { SecureAdminActionProvider } from "@/components/auth/SecureAdminActionProvider";

function AdminContent({ children }: { children: React.ReactNode }) {
  const { isCollapsed } = useSidebar();

  return (
    <main className={`transition-all duration-300 ${
      isCollapsed ? "ml-[76px]" : "ml-64"
    } mt-[72px] px-9 py-7`}>
      {children}
    </main>
  );
}

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AdminAuthProvider>
      <SecureAdminActionProvider>
        <SidebarProvider>
          <div className="min-h-screen bg-[#F5F6F8]">
            <Sidebar />
            <Navbar />
            <AdminContent>{children}</AdminContent>
          </div>
        </SidebarProvider>
      </SecureAdminActionProvider>
    </AdminAuthProvider>
  );
}
