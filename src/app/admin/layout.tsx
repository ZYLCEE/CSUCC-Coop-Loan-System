import AdminPortalLayout from "@/components/shared/AdminPortalLayout";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AdminPortalLayout role="admin">{children}</AdminPortalLayout>;
}
