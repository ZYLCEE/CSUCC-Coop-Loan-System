"use client";

import { useEffect, useState } from "react";
import { Ban, Trash2 } from "lucide-react";
import { FormDialog } from "@/components/ui/FormDialog";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Fields";
import { ActionSummary } from "@/components/ui/ConfirmActionDialog";
import { accountActionReasonMaxLength, accountActionReasonsAvailable, validateAccountActionReason, type ReasonedAccountAction } from "@/lib/accountActionReasons";
import type { Member } from "./MembersData";

export default function AccountActionReasonDialog({ member, action, busy, onClose, onContinue }: {
  member: Member; action: ReasonedAccountAction; busy: boolean; onClose: () => void; onContinue: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [available, setAvailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const deleting = action === "delete-account";
  useEffect(() => {
    let active = true;
    void accountActionReasonsAvailable().then(value => { if (active) { setAvailable(value); setLoading(false); } });
    return () => { active = false; };
  }, [attempt]);
  return <FormDialog title={deleting ? "Delete Account" : "Block Account"} subtitle={`${member.idNumber} · ${member.fullName}`}
    icon={deleting ? Trash2 : Ban} tone="destructive" className="max-w-[540px]" dirty={!!reason} busy={busy} onClose={onClose}
    footer={<><Button data-dialog-close disabled={busy}>Cancel</Button><Button type="submit" form="account-action-reason-form" variant="destructive" disabled={loading || !available} loading={busy}>Continue to Verify</Button></>}>
    <form id="account-action-reason-form" className="space-y-4" onSubmit={event => {
      event.preventDefault(); if (busy || loading || !available) return;
      try { const valid = validateAccountActionReason(reason); setError(""); onContinue(valid); }
      catch (error) { setError(error instanceof Error ? error.message : "Please enter a valid reason."); }
    }}>
      <p className="text-sm leading-6 text-portal-secondary">{deleting ? "Deleting this account permanently removes its sign-in access. Review the account holder carefully before continuing." : "Blocking this account prevents the account holder from accessing the system. This does not delete the account."}</p>
      <ActionSummary details={[{ label: "Account", value: member.fullName }, { label: "ID Number", value: member.idNumber }, { label: "Current Status", value: member.status }]} />
      {loading ? <p role="status" className="text-sm text-portal-secondary">Checking protected action availability…</p> : !available ? <div className="space-y-3"><p role="alert" className="ui-action-feedback ui-action-feedback--error">This protected action is currently unavailable. Please retry or contact the system administrator.</p><Button onClick={() => { setLoading(true); setAttempt(current => current + 1); }}>Retry</Button></div> : null}
      <label htmlFor="account-action-reason" className="block space-y-2"><span className="text-label">Reason <span aria-hidden="true" className="text-status-danger">*</span></span>
        <Textarea id="account-action-reason" required rows={3} maxLength={accountActionReasonMaxLength} disabled={busy || !available} value={reason}
          placeholder={deleting ? "Enter the reason for deleting this account…" : "Enter the reason for blocking this account…"}
          onChange={event => setReason(event.target.value)} aria-invalid={!!error} aria-describedby={`account-action-reason-help${error ? " account-action-reason-error" : ""}`} className="block min-h-28 w-full resize-y" />
      </label>
      <p id="account-action-reason-help" className="text-caption leading-5 text-portal-secondary">The reason and acting Super Admin will be recorded in the administrative audit log. Do not enter passwords here.</p>
      {error && <p id="account-action-reason-error" role="alert" className="ui-action-feedback ui-action-feedback--error">{error}</p>}
      <p className="rounded-lg bg-surface-muted p-3 text-sm leading-6 text-portal-secondary">Your Super Admin password and final confirmation are required. Continuing does not {deleting ? "delete" : "block"} the account.</p>
    </form>
  </FormDialog>;
}
