import { useState } from "react";
import { ShieldCheck, Wallet } from "lucide-react";
import MemberDetailsModal from "../../src/components/members/MemberDetailsModal";
import MemberFormModal from "../../src/components/members/MemberFormModal";
import ResetPasswordModal from "../../src/components/members/ResetPasswordModal";
import LoanDetailsModal from "../../src/components/loan-applications/LoanDetailsModal";
import LoanRejectionDialog from "../../src/components/loan-applications/LoanRejectionDialog";
import LoanApplicationsTable from "../../src/components/loan-applications/LoanApplicationsTable";
import { useAdminAuth } from "../../src/components/auth/AdminAuthProvider";
import type { LoanApplication } from "../../src/lib/api";
import LoanDocumentsModal from "../../src/components/loan-applications/LoanDocumentsModal";
import LoanReleaseDialog from "../../src/components/loan-applications/LoanReleaseDialog";
import CounterPaymentDialog from "../../src/components/active-loans/CounterPaymentDialog";
import RepaymentDetailsDialog from "../../src/components/active-loans/RepaymentDetailsDialog";
import AnnouncementEditor from "../../src/components/announcements/AnnouncementEditor";
import { useSecureAdminAction } from "../../src/components/auth/SecureAdminActionProvider";
import { ConfirmActionDialog } from "../../src/components/ui/ConfirmActionDialog";
import { ActionResultDialog } from "../../src/components/ui/ActionResultDialog";
import { Button } from "../../src/components/ui/Button";
import type { Member } from "../../src/components/members/MembersData";

const member: Member = {
  accountKey: "synthetic-member", authUserId: "synthetic-user", profileLinked: true, integrityIssue: null,
  idNumber: "CSUCC-2026-0001", fullName: "Maria Dela Cruz", email: "maria.qa@example.invalid",
  phone: "09123456789", address: "Synthetic address for layout review only", department: "Cooperative Services",
  role: "Member", status: "Active", membershipType: "regular", createdAt: "2026-01-01T00:00:00Z",
};

export default function ModalPreviews() {
  const [open, setOpen] = useState("");
  const [loanApplicationId, setLoanApplicationId] = useState("APP-TEST");
  const { role } = useAdminAuth();
  const rejectionApplication: LoanApplication = { id: "APP-TEST", memberId: "CSUCC-2026-0001", member: "Maria Dela Cruz",
    type: "Emergency", amount: "₱60,000.00", status: (new URLSearchParams(window.location.search).get("loanStatus") ?? "Under Review") as LoanApplication["status"], date: "2026-10-02", membershipType: "regular" };
  const rejected = () => window.dispatchEvent(new Event("qa-loan-refreshed"));
  const close = () => setOpen("");
  const { beginSecureAction } = useSecureAdminAction();
  const approval = () => beginSecureAction({ action: "approve-loan", target: "APP-TEST", title: "Approve Loan Application",
    question: "Approve APP-TEST for ₱1,000.00? The member's status, loan policy, and required documents will be checked first.",
    confirmLabel: "Approve Loan", successMessage: "Synthetic approval response received. No live application was changed.", payload: {},
    details: [{ label: "Application ID", value: "APP-TEST" }, { label: "Member", value: "Maria Dela Cruz" },
      { label: "Amount", value: "₱1,000.00" }, { label: "Current status", value: "Under Review" }],
  });
  return <main className="min-h-screen bg-surface-page p-6">
    <div className="mx-auto max-w-5xl space-y-5">
      <div className="ui-card p-6"><p className="text-caption font-semibold text-coop-dashboard-green">CSUCC COOP · DESIGN QA</p>
        <h1 className="mt-2 text-page-title font-bold">Isolated modal previews</h1>
        <p className="mt-2 text-support text-portal-muted">Synthetic data only. Mocked services. No authenticated session or live account/financial operations.</p>
      </div>
      <div className="ui-card flex flex-wrap gap-3 p-6">
        {[["view", "View account"], ["create", "Create account"], ["edit", "Edit account"], ["reset", "Reset password"],
          ["loan", "Loan details"], ["documents", "Application documents"], ["release", "Loan release"],
          ["payment", "Counter payment"], ["repayments", "Repayment details"], ["announcement", "Announcement editor"], ["warning", "Warning confirmation"],
          ["danger", "Destructive confirmation"], ["error", "Error result"]].map(([key, label]) =>
          <Button key={key} onClick={() => setOpen(key)}>{label}</Button>)}
        <Button variant="primary" onClick={approval}><ShieldCheck className="h-4 w-4" aria-hidden="true" />Loan approval</Button>
        <button type="button" data-qa-switch-loan onClick={() => setLoanApplicationId("APP-NEXT")}>Switch preview application</button>
        <Button onClick={() => setOpen("reject-loan")}>Loan rejection</Button>
        <Button onClick={() => setOpen("loan-table")}>Loan application actions</Button>
      </div>
    </div>
    {open === "view" && <MemberDetailsModal member={member} onClose={close} />}
    {(open === "create" || open === "edit") && <MemberFormModal key={open} mode={open === "create" ? "add" : "edit"}
      member={open === "create" ? null : member} onClose={close} onSubmit={() => {}} />}
    {open === "reset" && <ResetPasswordModal member={member} onClose={close} onSubmit={() => {}} />}
    {open === "loan" && <LoanDetailsModal applicationId={loanApplicationId} onClose={close} />}
    {open === "reject-loan" && <LoanRejectionDialog application={rejectionApplication} onClose={close} onRejected={rejected} />}
    {open === "loan-table" && <LoanApplicationsTable applications={[rejectionApplication]} hasActiveFilters={false} readOnly={role !== "super_admin"} onApplicationUpdated={rejected} />}
    {open === "documents" && <LoanDocumentsModal applicationId="APP-TEST" onClose={close} />}
    {open === "release" && <LoanReleaseDialog applicationId="APP-TEST" onClose={close} onReleased={() => {}} />}
    {open === "payment" && <CounterPaymentDialog loanId="loan-test" onClose={close} onSaved={() => {}} />}
    {open === "repayments" && <RepaymentDetailsDialog loanId="loan-test" onClose={close} />}
    {open === "announcement" && <AnnouncementEditor userId="synthetic-user" categories={[{ id: "general", name: "General" }]}
      schedulingEnabled notificationsEnabled onClose={close} onSaved={close} />}
    {(open === "warning" || open === "danger") && <ConfirmActionDialog
      title={open === "warning" ? "Save portal settings?" : "Delete cooperative document"}
      tone={open === "warning" ? "warning" : "destructive"}
      question={open === "warning" ? "Save these general portal settings?" : "Permanently delete this cooperative document? This cannot be undone."}
      details={open === "warning" ? [{ label: "Cooperative", value: "CSUCC Cooperative" }, { label: "Upload limit", value: "10 MB" }]
        : [{ label: "Document", value: "Synthetic Cooperative Document.pdf" }]}
      confirmLabel={open === "warning" ? "Save settings" : "Delete document"} onClose={close} onConfirm={close} />}
    {open === "error" && <ActionResultDialog success={false} title="Action Failed" onClose={close}
      message="Synthetic service error: the action could not be completed. Your changes have not been saved. Return to the form to correct the details." />}
    <div className="pointer-events-none fixed bottom-4 right-4 flex items-center gap-2 rounded-lg bg-white p-3 text-caption text-portal-muted shadow-sm">
      <Wallet className="h-4 w-4" aria-hidden="true" />Synthetic preview environment
    </div>
  </main>;
}
