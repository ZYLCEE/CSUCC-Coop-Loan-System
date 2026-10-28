import { User } from "@supabase/supabase-js";

export type AdminRole = "admin" | "super_admin";

export function getAdminRole(user: User | null): AdminRole | null {
  const role = user?.app_metadata.role;
  if (role === "super_admin") return "super_admin";
  if (role === "admin" || role === "coop_admin") return "admin";
  return null;
}

export function getAdminDashboardPath(role: AdminRole): string {
  return role === "super_admin"
    ? "/super-admin/dashboard"
    : "/admin/dashboard";
}
