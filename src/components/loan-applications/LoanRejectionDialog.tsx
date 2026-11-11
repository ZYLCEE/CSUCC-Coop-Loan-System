"use client";

import { useRef, useState, type FormEvent } from "react";
import { XCircle } from "lucide-react";
import type { LoanApplication } from "@/lib/api";
import { loanRejectionAvailable, rejectionEligible, rejectionReasonMaxLength, rejectionWarning, validateRejectionReason } from "@/lib/loanRejection";
import { useAdminAuth } from "@/components/auth/AdminAuthProvider";
import { useSecureAdminAction } from "@/components/auth/SecureAdminActionProvider";
import { ActionSummary } from "@/components/ui/ConfirmActionDialog";
import { FormDialog } from "@/components/ui/FormDialog";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Fields";
import { StatusBadge } from "@/components/ui/StatusBadge";

export default function LoanRejectionDialog({ application, onClose, onRejected }: {
  application: LoanApplication; onClose: () => void; onRejected: () => void;
}) {
  const { role } = useAdminAuth();
  const { beginSecureAction } = useSecureAdminAction();
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const request = useRef<{ reason: string; id: string } | null>(null);
  const unlock = () => { pending.current = false; setBusy(false); };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (pending.current) return;
    setError("");
    let trimmed: string;
    try {
      if (role !== "super_admin") throw new Error("You do not have permission to reject this loan application.");
      if (!rejectionEligible(application.status)) throw new Error("This application has already been updated. Refresh the application details and try again.");
      trimmed = validateRejectionReason(reason);
    } catch (error) { setError((error as Error).message); return; }
    pending.current = true; setBusy(true);
    if (!await loanRejectionAvailable()) { setError("Secure rejection is unavailable. Contact the system administrator."); unlock(); return; }
    if (request.current?.reason !== trimmed) request.current = { reason: trimmed, id: crypto.randomUUID() };
    beginSecureAction({
      action: "reject-loan", target: application.id, title: "Reject Loan Application", confirmLabel: "Reject Application",
      question: rejectionWarning, successTitle: "Loan Application Rejected",
      successMessage: "The loan application has been rejected successfully.",
      payload: { reason: trimmed, request_id: request.current.id, expected_status: application.status.toLowerCase() },
      details: [
        { label: "Application ID", value: application.id }, { label: "Applicant", value: application.member },
        { label: "Loan Type", value: application.type }, { label: "Requested Amount", value: application.amount },
        { label: "Current Status", value: application.status }, { label: "Reason for Rejection", value: trimmed },
      ],
      onCancel: unlock,
      onFailure: message => { setError(message); unlock(); },
      onSuccess: () => { onRejected(); onClose(); },
    });
  };
  return <FormDialog title="Reject Loan Application" subtitle={application.id} icon={XCircle} tone="destructive"
    className="max-w-[540px]" dirty={reason.length > 0} busy={busy} onClose={onClose}
    footer={<><Button data-dialog-close disabled={busy}>Cancel</Button><Button variant="destructive" type="submit" form="loan-rejection-form" loading={busy}>Reject Application</Button></>}>
    <ActionSummary details={[
      { label: "Application ID", value: application.id }, { label: "Applicant", value: application.member },
      { label: "Loan Type", value: application.type }, { label: "Requested Amount", value: application.amount },
      { label: "Current Status", value: <StatusBadge status={application.status} /> },
    ]} />
    <form id="loan-rejection-form" onSubmit={submit} className="mt-4 space-y-3">
      <label className="block space-y-2" htmlFor="loan-rejection-reason"><span className="text-label">Reason for Rejection <span className="text-status-danger">*</span></span>
        <Textarea id="loan-rejection-reason" className="block w-full resize-y" required rows={4} maxLength={rejectionReasonMaxLength} disabled={busy}
          value={reason} onChange={event => setReason(event.target.value)} placeholder="Enter the reason this loan application is being rejected..."
          aria-invalid={!!error} aria-describedby={`loan-rejection-privacy${error ? " loan-rejection-error" : ""}`} />
      </label>
      <p id="loan-rejection-privacy" className="text-xs leading-5 text-portal-muted">This reason is for authorized administrative records. The member notification contains only the decision.</p>
      {error && <p id="loan-rejection-error" role="alert" className="ui-action-feedback ui-action-feedback--error">{error}</p>}
      <p className="rounded-lg bg-status-warning-surface p-3 text-sm leading-6 text-status-warning">{rejectionWarning}</p>
    </form>
  </FormDialog>;
}
