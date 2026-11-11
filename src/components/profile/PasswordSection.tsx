"use client";

import { ActionFeedback } from "@/components/ui/Feedback";

import { Input } from "@/components/ui/Fields";

import { useRef, useState, type FormEvent } from "react";
import { Eye, EyeOff, LockKeyhole } from "lucide-react";
import { profileRequest } from "@/lib/profileRequest";
import { validatePasswordChange } from "@/lib/profileModel";
import { actionButtonStyles } from "@/components/shared/actionButtonStyles";

const blank = () => ({ current: "", next: "", confirm: "" });

export default function PasswordSection({ disabled = false, onChanged, onBusyChange }: {
  disabled?: boolean; onChanged?: () => void; onBusyChange: (busy: boolean) => void;
}) {
  const [passwords, setPasswords] = useState(blank);
  const [visible, setVisible] = useState({ current: false, next: false, confirm: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const submitting = useRef(false);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || disabled || submitting.current) return;
    setError(""); setNotice("");
    try { validatePasswordChange(passwords); }
    catch (error) { setError(error instanceof Error ? error.message : "Check the password fields."); return; }
    submitting.current = true; setBusy(true); onBusyChange(true);
    try {
      const result = await profileRequest({ method: "POST", body: JSON.stringify(passwords) });
      setPasswords(blank()); setVisible({ current: false, next: false, confirm: false });
      setNotice(result.warning ?? "Password updated successfully. Use your new password the next time you sign in.");
      onChanged?.();
    } catch (error) { setError(error instanceof Error ? error.message : "Password could not be changed."); setPasswords(current => ({ ...current, current: "" })); }
    finally { submitting.current = false; setBusy(false); onBusyChange(false); }
  };

  return <section className="ui-card ui-card-padding" aria-labelledby="password-heading">
    <h2 id="password-heading" className="flex items-center gap-2 text-card-title"><LockKeyhole className="h-5 w-5 text-[#155D3B]" aria-hidden="true" />Change password</h2>
    <p className="mt-1 text-xs text-slate-500">Leave these fields blank to keep your current password.</p>
    {error && <ActionFeedback error>{error}</ActionFeedback>}
    {notice && <ActionFeedback>{notice}</ActionFeedback>}
    <form onSubmit={save} className="mt-5"><fieldset disabled={busy || disabled} className="grid gap-4 md:grid-cols-3">
      {(["current", "next", "confirm"] as const).map(key => {
        const label = key === "current" ? "Current password" : key === "next" ? "New password" : "Confirm new password";
        return <div key={key}><label htmlFor={`profile-password-${key}`} className="mb-1 block text-label text-portal-primary">{label}</label><div className="relative">
          <Input id={`profile-password-${key}`} type={visible[key] ? "text" : "password"} required maxLength={key === "current" ? 1024 : 128} autoComplete={key === "current" ? "current-password" : "new-password"} value={passwords[key]}
            onChange={event => { setPasswords(current => ({ ...current, [key]: event.target.value })); setError(""); }} className="w-full pr-12" />
          <button type="button" aria-label={`${visible[key] ? "Hide" : "Show"} ${label.toLowerCase()}`} aria-pressed={visible[key]} onClick={() => setVisible(current => ({ ...current, [key]: !current[key] }))} className="absolute inset-y-1 right-1 flex w-9 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-[#155D3B]">
            {visible[key] ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
          </button>
        </div></div>;
      })}
      <p className="text-xs leading-5 text-slate-500 md:col-span-3">Use 8–128 characters with uppercase and lowercase letters, a number and a symbol.</p>
      <div className="flex flex-wrap gap-3 border-t border-slate-100 pt-5 md:col-span-3"><button type="submit" disabled={!passwords.current && !passwords.next && !passwords.confirm} className={actionButtonStyles("primary")}>{busy ? "Updating password…" : "Update Password"}</button><button type="button" disabled={!passwords.current && !passwords.next && !passwords.confirm} onClick={() => { setPasswords(blank()); setVisible({ current: false, next: false, confirm: false }); setError(""); setNotice(""); }} className={actionButtonStyles()}>Reset</button></div>
    </fieldset></form>
  </section>;
}
