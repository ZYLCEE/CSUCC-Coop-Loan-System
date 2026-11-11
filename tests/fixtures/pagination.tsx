import MembersPage from "../../src/app/(admin)/members/page";
import ActiveLoansWorkspace from "../../src/components/active-loans/ActiveLoansWorkspace";
import NotificationHistoryCard from "../../src/components/notifications/NotificationHistoryCard";
import AnnouncementsPage from "../../src/app/(admin)/announcements/page";
import DocumentManager from "../../src/components/documents/DocumentManager";
import ReportWorkspace from "../../src/components/reports/ReportWorkspace";
import RecordsView from "../../src/components/shared/RecordsView";
import { SecureAdminActionProvider } from "../../src/components/auth/SecureAdminActionProvider";

export default function PaginationPreview() {
  const view = new URLSearchParams(window.location.search).get("view");
  return <SecureAdminActionProvider><main className="min-w-0" style={{fontFamily:"Arial, Helvetica, sans-serif"}}>
    {view === "accounts" ? <MembersPage /> : view === "active" ? <ActiveLoansWorkspace />
      : view === "notifications" ? <NotificationHistoryCard /> : view === "announcements" ? <AnnouncementsPage />
      : view === "documents" ? <DocumentManager /> : view === "reports" ? <ReportWorkspace />
      : <RecordsView resource="audit" title="Audit logs" />}
  </main></SecureAdminActionProvider>;
}
