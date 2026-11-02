"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Building2, CheckCircle2, Clock, Mail, RefreshCw, Save, ShieldCheck, UserRound } from "lucide-react";
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
const activityLabels: Record<string, string> = { "update-own-profile": "Updated profile", "change-own-password": "Changed password", "update-admin-privileges": "Updated admin privileges", "approve-loan": "Approved loan", "review-loan": "Reviewed application", "record-counter-payment": "Recorded payment" };

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
  const [activityError, setActivityError] = useState("");

  useEffect(() => {
    let active = true;
    void profileRequest().then((result: ProfileResponse) => {
      if (active) { setData(result); setDraft(result.profile); setError(""); }
    }).catch(error => { if (active) setError(error instanceof Error ? error.message : "Unable to load your profile."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [user?.id, attempt]);

  const refreshActivity = () => {
    void profileRequest().then((result: ProfileResponse) => {
      setData(current => current ? { ...current, activity: result.activity, activityUnavailable: result.activityUnavailable } : current);
      setActivityError("");
    }).catch(() => setActivityError("Unable to refresh recent activity. Reload to retry."));
  };
  const reload = () => {
    if (data && draft && JSON.stringify(data.profile) !== JSON.stringify(draft) && !window.confirm("Discard unsaved profile changes and reload?")) return;
    setLoading(true); setError(""); setNotice(""); setAttempt(current => current + 1);
  };
  const dirty = !!data && !!draft && JSON.stringify(data.profile) !== JSON.stringify(draft);
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!draft || saving || passwordBusy || emailBusy) return;
    setError(""); setNotice("");
    let profile: EditableProfile;
    try { profile = validateProfile(draft); }
    catch (error) { setError(error instanceof Error ? error.message : "Check your profile details."); return; }
    setSaving(true);
    try {
      const result = await profileRequest({ method: "PUT", body: JSON.stringify(profile) });
      setDraft(result.profile); setData(current => current ? { ...current, profile: result.profile } : current);
      setNotice(result.warning ?? "Profile changes saved successfully.");
      try { await refreshUser(); } catch { setNotice("Profile saved. Reload if the header still shows your previous name."); }
      refreshActivity();
    } catch (error) { setError(error instanceof Error ? error.message : "Profile could not be saved."); }
    finally { setSaving(false); }
  };

  const name = data ? [data.profile.first_name, data.profile.last_name].filter(Boolean).join(" ") || data.account.email : user?.email ?? "My account";
  const initials = name.split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map(part => part[0].toUpperCase()).join("");
  const busy = saving || passwordBusy || emailBusy;
  const emailChanged = (result: EmailChangeResult) => {
    setData(current => current ? { ...current, account: { ...current.account, email: result.email, pendingEmail: result.pendingEmail } } : current);
    if (!result.confirmationRequired) void refreshUser().catch(() => {});
    refreshActivity();
  };

  return <div className="mx-auto max-w-6xl space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-semibold text-slate-900">My Profile</h2><p className="mt-1 text-sm text-slate-500">Manage your personal details and account security.</p></div><button type="button" onClick={reload} disabled={loading || busy} className={actionButtonStyles()}><RefreshCw className="h-4 w-4" aria-hidden="true" />Reload profile</button></div>
    {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {notice && <p role="status" className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">{notice}</p>}
    {loading ? <p role="status" className="rounded-xl border border-slate-200 bg-white p-8 text-sm text-slate-500">Loading your profile…</p> : !data || !draft ? <div className="rounded-xl border border-slate-200 bg-white p-6"><p className="mb-4 text-sm text-slate-600">Your profile could not be loaded.</p><button type="button" onClick={reload} className={actionButtonStyles()}>Retry</button></div> : <>
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(240px,1fr)_minmax(0,2fr)]">
        <aside className="rounded-xl border border-slate-200 bg-white p-6">
          <div className="flex flex-col items-center border-b border-slate-100 pb-5 text-center"><div className="mb-3 flex h-20 w-20 items-center justify-center rounded-full bg-[#155D3B] text-2xl font-bold text-white">{initials}</div><h3 className="break-words text-lg font-semibold text-slate-900">{name}</h3><span className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-green-200 bg-green-50 px-3 py-1 text-xs font-semibold text-[#155D3B]"><ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />{data.account.role}</span></div>
          <dl className="mt-5 space-y-4 text-sm"><div><dt className="flex items-center gap-2 text-xs text-slate-500"><Mail className="h-4 w-4" aria-hidden="true" />Sign-in email</dt><dd className="mt-1 break-all text-slate-800">{data.account.email}</dd></div><div><dt className="text-xs text-slate-500">Contact number</dt><dd className="mt-1 text-slate-800">{data.profile.phone || "Not recorded"}</dd></div><div><dt className="flex items-center gap-2 text-xs text-slate-500"><Building2 className="h-4 w-4" aria-hidden="true" />Department</dt><dd className="mt-1 break-words text-slate-800">{data.profile.department || "Not recorded"}</dd></div><div><dt className="text-xs text-slate-500">Account status</dt><dd className="mt-1 flex items-center gap-1.5 text-[#155D3B]"><CheckCircle2 className="h-4 w-4" aria-hidden="true" />{data.account.status}</dd></div><div><dt className="text-xs text-slate-500">Created</dt><dd className="mt-1 text-slate-800">{formatDate(data.account.createdAt)}</dd></div><div><dt className="flex items-center gap-2 text-xs text-slate-500"><Clock className="h-4 w-4" aria-hidden="true" />Last sign-in</dt><dd className="mt-1 text-slate-800">{formatDate(data.account.lastSignInAt)}</dd></div></dl>
        </aside>
        <section className="rounded-xl border border-slate-200 bg-white p-5 sm:p-6" aria-labelledby="edit-profile-heading"><h2 id="edit-profile-heading" className="flex items-center gap-2 text-base font-semibold text-slate-900"><UserRound className="h-5 w-5 text-[#155D3B]" aria-hidden="true" />Personal information</h2><p className="mt-1 text-sm text-slate-500">Your saved details appear throughout the admin portal.</p>
          <form onSubmit={save} className="mt-5"><fieldset disabled={busy} className="grid gap-4 sm:grid-cols-2">
            {fields.map(field => <label key={field.key} className="block text-sm font-medium text-slate-700">{field.label}{field.key.endsWith("name") && <span className="ml-1 text-red-600">*</span>}<input required={field.key.endsWith("name")} maxLength={field.key === "phone" ? 30 : 100} type={field.key === "phone" ? "tel" : "text"} autoComplete={field.key === "first_name" ? "given-name" : field.key === "last_name" ? "family-name" : field.key === "phone" ? "tel" : field.key === "position" ? "organization-title" : "organization"} value={draft[field.key]} placeholder={field.placeholder} onChange={event => { setDraft(current => current ? { ...current, [field.key]: event.target.value } : current); setNotice(""); }} className="mt-1.5 block w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm font-normal text-slate-900 placeholder:text-slate-400 focus:border-[#155D3B] focus:outline-none focus:ring-2 focus:ring-[#155D3B]/15 disabled:bg-slate-50" /></label>)}
          </fieldset><div className="mt-5 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-5"><button type="submit" disabled={busy || !dirty} className={actionButtonStyles("primary")}><Save className="h-4 w-4" aria-hidden="true" />{saving ? "Saving…" : "Save Changes"}</button><button type="button" disabled={busy || !dirty} onClick={() => { setDraft({ ...data.profile }); setError(""); setNotice(""); }} className={actionButtonStyles()}>Discard changes</button>{dirty && <span className="text-xs text-amber-700">Unsaved changes</span>}</div></form>
          <EmailChangeSection email={data.account.email} pendingEmail={data.account.pendingEmail} canChange={role === "super_admin"} disabled={saving || passwordBusy} onChanged={emailChanged} onBusyChange={setEmailBusy} />
        </section>
      </div>
      <PasswordSection disabled={saving || loading || emailBusy} onChanged={refreshActivity} onBusyChange={setPasswordBusy} />
      <section aria-labelledby="profile-activity-heading" className="rounded-xl border border-slate-200 bg-white p-5 sm:p-6"><h2 id="profile-activity-heading" className="text-base font-semibold text-slate-900">Recent account activity</h2><p className="mb-4 mt-1 text-sm text-slate-500">The latest recorded actions for your account.</p>{data.activityUnavailable || activityError ? <p className="text-sm text-slate-500">{activityError || "Activity history is currently unavailable."}</p> : !data.activity.length ? <p className="text-sm text-slate-500">No account activity has been recorded yet.</p> : <ul className="divide-y divide-slate-100">{data.activity.map(activity => <li key={activity.id} className="flex flex-wrap items-center justify-between gap-2 py-3"><div><p className="text-sm font-medium text-slate-800">{activityLabels[activity.action_name] ?? activity.action_name.replaceAll("-", " ").replaceAll("_", " ")}</p><p className="mt-1 text-xs capitalize text-slate-500">{activity.result}</p></div><time dateTime={activity.created_at} className="text-xs text-slate-500">{formatDate(activity.created_at)}</time></li>)}</ul>}</section>
    </>}
  </div>;
}
