"use client";

import { ActionFeedback } from "@/components/ui/Feedback";

import { Input } from "@/components/ui/Fields";
import PasswordInput from "@/components/ui/PasswordInput";

import { useRef, useState, type FormEvent } from "react";
import { Mail } from "lucide-react";
import { profileRequest } from "@/lib/profileRequest";
import { validateEmailChange } from "@/lib/profileModel";
import { actionButtonStyles } from "@/components/shared/actionButtonStyles";

export interface EmailChangeResult { email: string; pendingEmail: string | null; confirmationRequired: boolean; warning: string | null }

export default function EmailChangeSection({ email, pendingEmail, canChange, disabled, onChanged, onBusyChange }: {
  email: string; pendingEmail: string | null; canChange: boolean; disabled: boolean;
  onChanged: (result: EmailChangeResult) => void; onBusyChange: (busy: boolean) => void;
}) {
  const [nextEmail, setNextEmail] = useState(email);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const submitting = useRef(false);
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || disabled || !canChange || submitting.current) return;
    setError(""); setNotice("");
    let payload: { email: string; current: string };
    try {
      payload = validateEmailChange({ email: nextEmail, current: password });
      if (payload.email === email.toLowerCase()) throw new Error("Enter a different email address.");
    } catch (error) { setError(error instanceof Error ? error.message : "Check your email address."); return; }
    submitting.current = true; setBusy(true); onBusyChange(true);
    try {
      const result: EmailChangeResult = await profileRequest({ method: "PATCH", body: JSON.stringify(payload) });
      setNextEmail(result.email); setNotice(result.warning ?? (result.confirmationRequired ? "Check your current and new inboxes to confirm the change. Your sign-in email updates after confirmation." : "Sign-in email updated successfully."));
      onChanged(result);
    } catch (error) { setError(error instanceof Error ? error.message : "Email change failed."); }
    finally { submitting.current = false; setPassword(""); setBusy(false); onBusyChange(false); }
  };

  const dirty = nextEmail.trim().toLowerCase() !== email.toLowerCase();
  return <section aria-labelledby="sign-in-email-heading" className="ui-card ui-card-padding">
    <h2 id="sign-in-email-heading" className="flex items-center gap-2 text-card-title"><Mail className="h-5 w-5 text-[#155D3B]" aria-hidden="true" />Email address</h2>
    {error && <ActionFeedback error>{error}</ActionFeedback>}
    {notice && <ActionFeedback>{notice}</ActionFeedback>}
    {pendingEmail && <p role="status" className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">Awaiting email confirmation: <strong className="break-all">{pendingEmail}</strong>. Your current sign-in email is {email}.</p>}
    <form onSubmit={save} className="mt-5"><fieldset disabled={disabled || busy} className="grid gap-4 sm:grid-cols-2">
      <label className="block text-label text-portal-primary">{canChange ? "Email address" : "Sign-in email"}<Input type="email" autoComplete="email" required maxLength={254} readOnly={!canChange} value={canChange ? nextEmail : email} onChange={event => { setNextEmail(event.target.value); setError(""); setNotice(""); }} className="mt-1 block w-full" /></label>
      {canChange && <div><label htmlFor="profile-email-password" className="mb-1 block text-label text-portal-primary">Current password</label><PasswordInput id="profile-email-password" label="Current password" required maxLength={1024} autoComplete="current-password" value={password} onChange={event => { setPassword(event.target.value); setError(""); }} className="block w-full" /></div>}
      <p className="text-xs leading-5 text-slate-500 sm:col-span-2">{canChange ? "Use your current password to update your email. Confirm the change from your inbox." : "Contact your Super Admin to change your sign-in email."}</p>
      {canChange && <div className="flex flex-wrap gap-3 border-t border-slate-100 pt-5 sm:col-span-2"><button type="submit" disabled={!dirty} className={actionButtonStyles("primary")}>{busy ? "Updating email…" : "Update email"}</button><button type="button" disabled={!dirty && !password} onClick={() => { setPassword(""); setNextEmail(email); setError(""); setNotice(""); }} className={actionButtonStyles()}>Reset</button></div>}
    </fieldset></form>
  </section>;
}
