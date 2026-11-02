"use client";

import { useState, type FormEvent } from "react";
import { Mail } from "lucide-react";
import { profileRequest } from "@/lib/profileRequest";
import { validateEmailChange } from "@/lib/profileModel";
import { actionButtonStyles } from "@/components/shared/actionButtonStyles";

export interface EmailChangeResult { email: string; pendingEmail: string | null; confirmationRequired: boolean; warning: string | null }

export default function EmailChangeSection({ email, pendingEmail, canChange, disabled, onChanged, onBusyChange }: {
  email: string; pendingEmail: string | null; canChange: boolean; disabled: boolean;
  onChanged: (result: EmailChangeResult) => void; onBusyChange: (busy: boolean) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [nextEmail, setNextEmail] = useState(email);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || disabled || !canChange) return;
    setError(""); setNotice("");
    let payload: { email: string; current: string };
    try {
      payload = validateEmailChange({ email: nextEmail, current: password });
      if (payload.email === email.toLowerCase()) throw new Error("Enter a different email address.");
    } catch (error) { setError(error instanceof Error ? error.message : "Check your email address."); return; }
    setBusy(true); onBusyChange(true);
    try {
      const result: EmailChangeResult = await profileRequest({ method: "PATCH", body: JSON.stringify(payload) });
      setEditing(false); setNotice(result.warning ?? (result.confirmationRequired ? "Email change requested. Check your current and new inboxes and complete the required confirmations. Your sign-in email updates after confirmation." : "Sign-in email updated. Use the new address the next time you sign in."));
      onChanged(result);
    } catch (error) { setError(error instanceof Error ? error.message : "Email change failed."); }
    finally { setPassword(""); setBusy(false); onBusyChange(false); }
  };

  return <section aria-labelledby="sign-in-email-heading" className="mt-5 border-t border-slate-100 pt-5">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h3 id="sign-in-email-heading" className="flex items-center gap-2 text-sm font-semibold text-slate-800"><Mail className="h-4 w-4 text-[#155D3B]" aria-hidden="true" />Sign-in email</h3>
      {canChange && !editing && <button type="button" disabled={disabled} onClick={() => { setNextEmail(pendingEmail || email); setEditing(true); setError(""); setNotice(""); }} className={actionButtonStyles()}>Change email</button>}
    </div>
    {error && <p role="alert" className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {notice && <p role="status" className="mb-3 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">{notice}</p>}
    {pendingEmail && <p role="status" className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">Awaiting email confirmation: <strong className="break-all">{pendingEmail}</strong>. Your current sign-in email is {email}.</p>}
    <form onSubmit={save}><fieldset disabled={disabled || busy} className="space-y-3">
      <label className="block text-sm font-medium text-slate-700">{editing ? "New sign-in email" : "Current sign-in email"}<input type="email" autoComplete="email" required maxLength={254} readOnly={!editing} value={editing ? nextEmail : email} onChange={event => setNextEmail(event.target.value)} className={`mt-1.5 block w-full rounded-lg border px-3 py-2.5 text-sm font-normal focus:border-[#155D3B] focus:outline-none focus:ring-2 focus:ring-[#155D3B]/15 ${editing ? "border-slate-300 bg-white text-slate-900" : "border-slate-200 bg-slate-50 text-slate-500"}`} /></label>
      {editing && <><p className="text-xs leading-5 text-slate-500">Enter your current password to request the change. Complete the email confirmations sent by the account service.</p><label className="block text-sm font-medium text-slate-700">Current password for email change<input type="password" required maxLength={1024} autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} className="mt-1.5 block w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:border-[#155D3B] focus:outline-none focus:ring-2 focus:ring-[#155D3B]/15" /></label><div className="flex flex-wrap gap-2"><button type="submit" className={actionButtonStyles("primary")}>{busy ? "Requesting change…" : "Save email change"}</button><button type="button" onClick={() => { setEditing(false); setPassword(""); setNextEmail(email); setError(""); }} className={actionButtonStyles()}>Cancel email change</button></div></>}
      {!canChange && <p className="text-xs text-slate-500">Contact your Super Admin to change your sign-in email.</p>}
    </fieldset></form>
  </section>;
}
