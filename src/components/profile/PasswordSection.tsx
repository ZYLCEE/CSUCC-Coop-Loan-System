"use client";

import { useState, type FormEvent } from "react";
import { Eye, EyeOff, LockKeyhole } from "lucide-react";
import { profileRequest } from "@/lib/profileRequest";
import { validatePasswordChange } from "@/lib/profileModel";
import { actionButtonStyles } from "@/components/shared/actionButtonStyles";

const blank = () => ({ current: "", next: "", confirm: "" });

export default function PasswordSection({ disabled = false, onChanged, onBusyChange }: {
  disabled?: boolean; onChanged: () => void; onBusyChange: (busy: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [passwords, setPasswords] = useState(blank);
  const [visible, setVisible] = useState({ current: false, next: false, confirm: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || disabled) return;
    setError(""); setNotice("");
    try { validatePasswordChange(passwords); }
    catch (error) { setError(error instanceof Error ? error.message : "Check the password fields."); return; }
    setBusy(true); onBusyChange(true);
    try {
      const result = await profileRequest({ method: "POST", body: JSON.stringify(passwords) });
      setPasswords(blank()); setVisible({ current: false, next: false, confirm: false }); setOpen(false);
      setNotice(result.warning ?? "Password updated successfully. Use your new password the next time you sign in.");
      onChanged();
    } catch (error) { setError(error instanceof Error ? error.message : "Password could not be changed."); setPasswords(current => ({ ...current, current: "" })); }
    finally { setBusy(false); onBusyChange(false); }
  };

  return <section className="rounded-xl border border-slate-200 bg-white p-5 sm:p-6" aria-labelledby="password-heading">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 id="password-heading" className="flex items-center gap-2 text-base font-semibold text-slate-900"><LockKeyhole className="h-5 w-5 text-[#155D3B]" aria-hidden="true" />Password &amp; Security</h2><p className="mt-1 text-sm text-slate-500">Verify your current password to choose a new one.</p></div>
      {!open && <button type="button" disabled={disabled} onClick={() => { setOpen(true); setError(""); setNotice(""); }} className={actionButtonStyles()}>Change Password</button>}
    </div>
    {error && <p role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {notice && <p role="status" className="mt-4 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">{notice}</p>}
    {open && <form onSubmit={save} className="mt-5 max-w-lg space-y-4"><fieldset disabled={busy || disabled} className="space-y-4">
      {(["current", "next", "confirm"] as const).map(key => {
        const label = key === "current" ? "Current password" : key === "next" ? "New password" : "Confirm new password";
        return <div key={key}><label htmlFor={`profile-password-${key}`} className="mb-1.5 block text-sm font-medium text-slate-700">{label}</label><div className="relative">
          <input id={`profile-password-${key}`} type={visible[key] ? "text" : "password"} required maxLength={key === "current" ? 1024 : 128} autoComplete={key === "current" ? "current-password" : "new-password"} value={passwords[key]}
            onChange={event => { setPasswords(current => ({ ...current, [key]: event.target.value })); setError(""); }} className="w-full rounded-lg border border-slate-300 py-2.5 pl-3 pr-12 text-sm focus:border-[#155D3B] focus:outline-none focus:ring-2 focus:ring-[#155D3B]/15" />
          <button type="button" aria-label={`${visible[key] ? "Hide" : "Show"} ${label.toLowerCase()}`} aria-pressed={visible[key]} onClick={() => setVisible(current => ({ ...current, [key]: !current[key] }))} className="absolute inset-y-1 right-1 flex w-9 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-[#155D3B]">
            {visible[key] ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
          </button>
        </div></div>;
      })}
      <p className="rounded-lg bg-slate-50 p-3 text-xs leading-5 text-slate-500">Use 8–128 characters with uppercase and lowercase letters, a number and a symbol.</p>
      <div className="flex flex-wrap gap-2"><button type="submit" className={actionButtonStyles("primary")}>{busy ? "Updating password…" : "Update Password"}</button><button type="button" onClick={() => { setPasswords(blank()); setVisible({ current: false, next: false, confirm: false }); setOpen(false); setError(""); }} className={actionButtonStyles()}>Cancel</button></div>
    </fieldset></form>}
  </section>;
}
