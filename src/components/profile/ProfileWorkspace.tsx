"use client";

import { ActionFeedback } from "@/components/ui/Feedback";

import { Input } from "@/components/ui/Fields";
import { LoadingState } from "@/components/ui/Feedback";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Building2, CheckCircle2, Clock, Mail, Save, ShieldCheck, UserRound } from "lucide-react";
import { useAdminAuth } from "@/components/auth/AdminAuthProvider";
import { profileRequest } from "@/lib/profileRequest";
import { validateProfile, type EditableProfile, type ProfileResponse } from "@/lib/profileModel";
import { actionButtonStyles } from "@/components/shared/actionButtonStyles";
import PasswordSection from "./PasswordSection";
import EmailChangeSection, { type EmailChangeResult } from "./EmailChangeSection";

const fields: Array<{ key: keyof EditableProfile; label: string; placeholder: string }> = [
  { key: "first_name", label: "First name", placeholder: "Enter first name" },
  { key: "last_name", label: "Last name", placeholder: "Enter last name" },
  { key: "phone", label: "Contact number", placeholder: "e.g. +63 912 345 6789" },
  { key: "department", label: "Department", placeholder: "Enter department" },
  { key: "position", label: "Position / job title", placeholder: "Enter position" },
];
const formatDate = (date: string | null) => date && Number.isFinite(Date.parse(date)) ? new Date(date).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Manila" }) : "Not recorded";

export default function ProfileWorkspace() {
  const { user, role, refreshUser } = useAdminAuth();
  const [data, setData] = useState<ProfileResponse | null>(null);
  const [draft, setDraft] = useState<EditableProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [emailBusy, setEmailBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const submitting = useRef(false);

  useEffect(() => {
    let active = true;
    void profileRequest().then((result: ProfileResponse) => {
      if (active) { setData(result); setDraft(result.profile); setError(""); }
    }).catch(error => { if (active) setError(error instanceof Error ? error.message : "Unable to load your profile."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [user?.id, attempt]);

  const reload = () => {
    setLoading(true); setError(""); setNotice(""); setAttempt(current => current + 1);
  };
  const dirty = !!data && !!draft && JSON.stringify(data.profile) !== JSON.stringify(draft);
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!draft || saving || passwordBusy || emailBusy || submitting.current) return;
    setError(""); setNotice("");
    let profile: EditableProfile;
    try { profile = validateProfile(draft); }
    catch (error) { setError(error instanceof Error ? error.message : "Check your profile details."); return; }
    submitting.current = true; setSaving(true);
    try {
      const result = await profileRequest({ method: "PUT", body: JSON.stringify(profile) });
      setDraft(result.profile); setData(current => current ? { ...current, profile: result.profile } : current);
      setNotice(result.warning ?? "Profile changes saved successfully.");
      try { await refreshUser(); } catch { setNotice("Profile saved. Reload if the header still shows your previous name."); }
    } catch (error) { setError(error instanceof Error ? error.message : "Profile could not be saved."); }
    finally { submitting.current = false; setSaving(false); }
  };

  const name = data ? [data.profile.first_name, data.profile.last_name].filter(Boolean).join(" ") || data.account.email : user?.email ?? "My account";
  const initials = name.split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map(part => part[0].toUpperCase()).join("");
  const busy = saving || passwordBusy || emailBusy;
  const emailChanged = (result: EmailChangeResult) => {
    setData(current => current ? { ...current, account: { ...current.account, email: result.email, pendingEmail: result.pendingEmail } } : current);
    if (!result.confirmationRequired) void refreshUser().catch(() => {});
  };

  return <div className="mx-auto max-w-6xl space-y-5">
    {error && <ActionFeedback error>{error}</ActionFeedback>}
    {notice && <ActionFeedback>{notice}</ActionFeedback>}
    {loading ? <div className="ui-card"><LoadingState label="Loading your profile…" /></div> : !data || !draft ? <div className="ui-card ui-card-padding"><p className="mb-4 text-sm text-slate-600">Your profile could not be loaded.</p><button type="button" onClick={reload} className={actionButtonStyles()}>Retry</button></div> : <>
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(240px,1fr)_minmax(0,2fr)]">
        <aside className="ui-card ui-card-padding">
          <div className="flex flex-col items-center border-b border-slate-100 pb-5 text-center"><div className="mb-3 flex h-20 w-20 items-center justify-center rounded-full bg-[#155D3B] text-2xl font-bold text-white">{initials}</div><h3 className="break-words text-lg font-semibold text-slate-900">{name}</h3><span className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-green-200 bg-green-50 px-3 py-1 text-xs font-semibold text-[#155D3B]"><ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />{data.account.role}</span></div>
          <dl className="mt-5 space-y-4 text-sm"><div><dt className="flex items-center gap-2 text-xs text-slate-500"><Mail className="h-4 w-4" aria-hidden="true" />Sign-in email</dt><dd className="mt-1 break-all text-slate-800">{data.account.email}</dd></div><div><dt className="text-xs text-slate-500">Contact number</dt><dd className="mt-1 text-slate-800">{data.profile.phone || "Not recorded"}</dd></div><div><dt className="flex items-center gap-2 text-xs text-slate-500"><Building2 className="h-4 w-4" aria-hidden="true" />Department</dt><dd className="mt-1 break-words text-slate-800">{data.profile.department || "Not recorded"}</dd></div><div><dt className="text-xs text-slate-500">Account status</dt><dd className="mt-1 flex items-center gap-1.5 text-[#155D3B]"><CheckCircle2 className="h-4 w-4" aria-hidden="true" />{data.account.status}</dd></div><div><dt className="text-xs text-slate-500">Created</dt><dd className="mt-1 text-slate-800">{formatDate(data.account.createdAt)}</dd></div><div><dt className="flex items-center gap-2 text-xs text-slate-500"><Clock className="h-4 w-4" aria-hidden="true" />Last sign-in</dt><dd className="mt-1 text-slate-800">{formatDate(data.account.lastSignInAt)}</dd></div></dl>
        </aside>
        <div className="min-w-0 space-y-5">
        <section className="ui-card ui-card-padding" aria-labelledby="edit-profile-heading"><h2 id="edit-profile-heading" className="flex items-center gap-2 text-card-title"><UserRound className="h-5 w-5 text-[#155D3B]" aria-hidden="true" />Personal information</h2>
          <form onSubmit={save} className="mt-5"><fieldset disabled={busy} className="grid gap-4 sm:grid-cols-2">
            {fields.map(field => <label key={field.key} className="block text-label text-portal-primary">{field.label}{field.key.endsWith("name") && <span className="ml-1 text-red-600">*</span>}<Input required={field.key.endsWith("name")} maxLength={field.key === "phone" ? 30 : 100} type={field.key === "phone" ? "tel" : "text"} autoComplete={field.key === "first_name" ? "given-name" : field.key === "last_name" ? "family-name" : field.key === "phone" ? "tel" : field.key === "position" ? "organization-title" : "organization"} value={draft[field.key]} placeholder={field.placeholder} onChange={event => { setDraft(current => current ? { ...current, [field.key]: event.target.value } : current); setNotice(""); }} className="mt-1 block w-full" /></label>)}
          </fieldset><div className="mt-5 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-5"><button type="submit" disabled={busy || !dirty} className={actionButtonStyles("primary")}><Save className="h-4 w-4" aria-hidden="true" />{saving ? "Saving…" : "Save Changes"}</button><button type="button" disabled={busy || !dirty} onClick={() => { setDraft({ ...data.profile }); setError(""); setNotice(""); }} className={actionButtonStyles()}>Reset</button>{dirty && <span className="text-xs text-amber-700">Unsaved changes</span>}</div></form>
        </section>
        <EmailChangeSection email={data.account.email} pendingEmail={data.account.pendingEmail} canChange={role === "super_admin"} disabled={saving || passwordBusy} onChanged={emailChanged} onBusyChange={setEmailBusy} />
        <PasswordSection disabled={saving || loading || emailBusy} onBusyChange={setPasswordBusy} />
        </div>
      </div>
    </>}
  </div>;
}
