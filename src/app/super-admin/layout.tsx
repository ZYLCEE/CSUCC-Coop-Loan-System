import AdminPortalLayout from "@/components/shared/AdminPortalLayout";

export default function SuperAdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AdminPortalLayout role="super_admin">{children}</AdminPortalLayout>;
}
