import type { ComponentType } from "react";
import { notFound } from "next/navigation";
import DashboardPage from "@/app/(admin)/dashboard/page";
import LoanApplicationsPage from "@/app/(admin)/loan-applications/page";
import MembersPage from "@/app/(admin)/members/page";
import ActiveLoansPage from "@/app/(admin)/active-loans/page";
import NotificationsPage from "@/app/(admin)/notifications/page";
import AnnouncementsPage from "@/app/(admin)/announcements/page";
import DocumentsPage from "@/app/(admin)/documents/page";
import ContentManagerPage from "@/app/(admin)/content-manager/page";
import ReportsPage from "@/app/(admin)/reports/page";
import AuditLogsPage from "@/app/(admin)/audit-logs/page";
import SettingsPage from "@/app/(admin)/settings/page";
import ProfilePage from "@/app/(admin)/profile/page";

const pages: Record<string, ComponentType> = {
  dashboard: DashboardPage,
  "loan-applications": LoanApplicationsPage,
  "all-accounts": MembersPage,
  members: MembersPage,
  "active-loans": ActiveLoansPage,
  communication: NotificationsPage,
  notifications: NotificationsPage,
  announcements: AnnouncementsPage,
  "system-management": DocumentsPage,
  documents: DocumentsPage,
  "content-manager": ContentManagerPage,
  reports: ReportsPage,
  "audit-logs": AuditLogsPage,
  settings: SettingsPage,
  profile: ProfilePage,
};

export default async function SuperAdminSectionPage({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  const { section } = await params;
  const Page = pages[section];
  if (!Page) notFound();
  return <Page />;
}
