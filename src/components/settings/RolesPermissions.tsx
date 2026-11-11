"use client";
import PasswordInput from "@/components/ui/PasswordInput";

import { ActionFeedback } from "@/components/ui/Feedback";

import { useCallback, useEffect, useRef, useState } from "react";
import { ConfirmActionDialog } from "@/components/ui/ConfirmActionDialog";
import { LockKeyhole, RefreshCw, Save, Search, ShieldCheck } from "lucide-react";
import { adminPrivileges, type AdminPrivilege } from "@/lib/adminPrivileges";
import { adminPrivilegeRequest } from "@/lib/adminPrivilegeRequest";
import { useAdminAuth } from "@/components/auth/AdminAuthProvider";
import { actionButtonStyles } from "@/components/shared/actionButtonStyles";

interface AdminAccount {
  id: string; email: string; name: string; active: boolean;
  privileges: AdminPrivilege[]; version: string | null;
}

export default function RolesPermissions() {
  const { role } = useAdminAuth();
  const [accounts, setAccounts] = useState<AdminAccount[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [draft, setDraft] = useState<AdminPrivilege[]>([]);
  const [password, setPassword] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState<{ kind: "choose"; account: AdminAccount } | { kind: "reload" | "save" } | null>(null);
  const submitting = useRef(false);
  const selected = accounts.find(account => account.id === selectedId);
  const dirty = !!selected && JSON.stringify([...draft].sort()) !== JSON.stringify([...selected.privileges].sort());
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const result = await adminPrivilegeRequest();
      setAccounts(result.accounts); setSelectedId(""); setDraft([]); setPassword("");
    } catch (error) { setError(error instanceof Error ? error.message : "Unable to load admins."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => {
    if (role !== "super_admin") return;
    let active = true;
    void adminPrivilegeRequest().then(result => {
      if (active) setAccounts(result.accounts);
    }).catch(error => {
      if (active) setError(error instanceof Error ? error.message : "Unable to load admins.");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [role]);

  const selectAccount = (account: AdminAccount) => {
    setSelectedId(account.id); setDraft([...account.privileges]); setPassword(""); setError(""); setNotice("");
  };
  const choose = (account: AdminAccount) => {
    if (dirty) setPending({ kind: "choose", account }); else selectAccount(account);
  };
  const save = async () => {
    if (!selected || !selected.active || !dirty || busy || submitting.current) return;
    submitting.current = true;
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await adminPrivilegeRequest({ method: "PUT", body: JSON.stringify({ userId: selected.id, privileges: draft, version: selected.version, password }) });
      setAccounts(current => current.map(account => account.id === selected.id ? { ...account, privileges: [...draft], version: result.version } : account));
      setNotice(result.warning ?? `Privileges saved for ${selected.name}. Their access updates on the next request; the portal refreshes permissions within 30 seconds.`);
      setPending(null);
    } catch (error) { setError(error instanceof Error ? error.message : "Unable to save privileges."); }
    finally { submitting.current = false; setBusy(false); setPassword(""); }
  };

  if (role !== "super_admin") return <p className="flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600"><LockKeyhole className="h-5 w-5 shrink-0" />Only Super Admin can assign privileges. Contact your Super Admin to change your access.</p>;

  return <section aria-labelledby="admin-privileges-heading" className="space-y-5">
    {pending && <ConfirmActionDialog title={pending.kind === "save" ? "Save admin privileges?" : "Discard privilege changes?"}
      tone={pending.kind === "save" ? "warning" : "destructive"} busy={busy}
      question={pending.kind === "save" ? "Save these privileges? Your password and the current version will be checked by the existing account service." : "Your privilege changes have not been saved. Discard them to continue?"}
      details={pending.kind === "save" && selected ? [{ label: "Admin", value: selected.name }, { label: "Enabled privileges", value: draft.map(key => adminPrivileges.find(item => item.key === key)?.label ?? key).join(", ") || "None" }] : undefined}
      error={pending.kind === "save" ? error : undefined} disabled={pending.kind === "save" && !password}
      confirmLabel={pending.kind === "save" ? "Save privileges" : "Discard changes"} cancelLabel={pending.kind === "save" ? "Back to editing" : "Keep editing"}
      onClose={() => { if (!submitting.current) setPending(null); }} onConfirm={async () => {
        if (pending.kind === "save") await save();
        else { if (pending.kind === "choose") selectAccount(pending.account); else await load(); setPending(null); }
      }} />}
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 id="admin-privileges-heading" className="flex items-center gap-2 text-lg font-semibold text-slate-900"><ShieldCheck className="h-5 w-5 text-[#155D3B]" />Roles &amp; Permissions</h2><p className="mt-1 text-sm text-slate-500">Select an admin and choose the extra tasks they can perform.</p></div>
      <button type="button" disabled={loading || busy} className={actionButtonStyles()} onClick={() => { if (dirty) setPending({ kind: "reload" }); else void load(); }}><RefreshCw className="h-4 w-4" />Reload admins</button>
    </div>
    {error && <ActionFeedback error>{error}</ActionFeedback>}
    {notice && <ActionFeedback>{notice}</ActionFeedback>}
    <div className="grid gap-5 lg:grid-cols-[minmax(220px,1fr)_minmax(0,2fr)]">
      <div className="overflow-hidden rounded-xl border border-slate-200">
        <div className="border-b border-slate-200 bg-slate-50 p-3"><label className="relative block"><Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" aria-hidden="true" /><input aria-label="Search admins" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search admins" className="ui-field w-full pl-9" /></label></div>
        <div className="max-h-[460px] overflow-y-auto p-2">
          {loading ? <p role="status" className="p-4 text-sm text-slate-500">Loading admins…</p> : !accounts.length ? <p className="p-4 text-sm text-slate-500">No Admin accounts found. Create an Admin account in All Accounts first.</p> : <>
            {accounts.filter(account => `${account.name} ${account.email}`.toLowerCase().includes(search.toLowerCase())).map(account => <button type="button" key={account.id} disabled={busy} onClick={() => choose(account)} aria-pressed={selectedId === account.id}
              className={`mb-1 w-full rounded-lg border p-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-[#155D3B] disabled:opacity-50 ${selectedId === account.id ? "border-[#155D3B]/30 bg-[#F0F7F3]" : "border-transparent hover:bg-slate-50"}`}>
              <span className="block break-words text-sm font-semibold text-slate-900">{account.name}</span><span className="mt-1 block break-all text-xs text-slate-500">{account.email}</span><span className="mt-2 block text-xs text-slate-600">{account.active ? `${account.privileges.length} privileges enabled` : "Inactive · editing unavailable"}</span>
            </button>)}
            {!accounts.some(account => `${account.name} ${account.email}`.toLowerCase().includes(search.toLowerCase())) && <p className="p-4 text-sm text-slate-500">No admins match your search.</p>}
          </>}
        </div>
      </div>
      <div className="ui-card ui-card-padding">
        {!selected ? <div className="flex min-h-72 flex-col items-center justify-center gap-3 text-center text-slate-500"><ShieldCheck className="h-10 w-10 text-slate-300" /><p className="text-sm">Select an admin to manage their privileges.</p></div> : <>
          <h3 className="font-semibold text-slate-900">{selected.name}</h3><p className="mt-1 break-all text-sm text-slate-500">{selected.email}</p>
          <fieldset disabled={busy || !selected.active} className="mt-5 space-y-3"><legend className="sr-only">Privileges for {selected.name}</legend>
            {adminPrivileges.map(item => <label key={item.key} className={`flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition-colors ${draft.includes(item.key) ? "border-[#155D3B]/30 bg-[#F0F7F3]" : "border-slate-200 bg-white"}`}>
              <input type="checkbox" checked={draft.includes(item.key)} onChange={event => { setDraft(current => event.target.checked ? [...current, item.key] : current.filter(key => key !== item.key)); setNotice(""); }} className="mt-0.5 h-4 w-4 shrink-0 accent-[#155D3B] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#155D3B]" />
              <span><span className="block text-sm font-semibold text-slate-800">{item.label}</span><span className="mt-1 block text-xs leading-5 text-slate-500">{item.description}</span></span>
            </label>)}
          </fieldset>
          <p className="mt-4 text-xs leading-5 text-slate-500">Committee account management and the other listed actions require their assigned privilege. Creating member or administrator accounts and assigning privileges remain restricted to Super Admin.</p>
          <div className="mt-5 border-t border-slate-100 pt-5"><label className="block text-xs font-semibold text-slate-600">Your Super Admin password<PasswordInput label="Your Super Admin password" wrapperClassName="mt-2 max-w-sm" autoComplete="current-password" value={password} disabled={busy || !selected.active} onChange={event => setPassword(event.target.value)}  /></label>
            <div className="mt-4 flex flex-wrap items-center gap-3"><button type="button" disabled={busy || !selected.active || !dirty || !password} onClick={() => { setError(""); setPending({ kind: "save" }); }} className={actionButtonStyles("primary")}><Save className="h-4 w-4" />{busy ? "Saving…" : "Save privileges"}</button><button type="button" disabled={busy || !dirty} onClick={() => { setDraft([...selected.privileges]); setPassword(""); setError(""); }} className={actionButtonStyles()}>Discard changes</button>{dirty && <span className="text-xs text-amber-700">Unsaved changes</span>}</div>
          </div>
        </>}
      </div>
    </div>
  </section>;
}
