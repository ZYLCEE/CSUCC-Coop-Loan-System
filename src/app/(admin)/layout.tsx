"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AdminAuthProvider, useAdminAuth } from "@/components/auth/AdminAuthProvider";
import { getAdminPortalPrefix } from "@/lib/auth/roles";

function LegacyAdminRedirect() {
  const { role } = useAdminAuth();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (role) {
      const { search, hash } = window.location;
      router.replace(`${getAdminPortalPrefix(role)}${pathname}${search}${hash}`);
    }
  }, [pathname, role, router]);

  return <p role="status" className="p-6">Opening the admin portal...</p>;
}

export default function LegacyAdminLayout() {
  return (
    <AdminAuthProvider requiredRole={null}>
      <LegacyAdminRedirect />
    </AdminAuthProvider>
  );
}
