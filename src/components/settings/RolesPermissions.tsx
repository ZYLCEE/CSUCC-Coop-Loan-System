"use client";

import { useCallback, useEffect, useState } from "react";
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

  const choose = (account: AdminAccount) => {
    if (dirty && !window.confirm("Discard unsaved privilege changes?")) return;
    setSelectedId(account.id); setDraft([...account.privileges]); setPassword(""); setError(""); setNotice("");
  };
  const save = async () => {
    if (!selected || !selected.active || !dirty || busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await adminPrivilegeRequest({ method: "PUT", body: JSON.stringify({ userId: selected.id, privileges: draft, version: selected.version, password }) });
      setAccounts(current => current.map(account => account.id === selected.id ? { ...account, privileges: [...draft], version: result.version } : account));
      setNotice(result.warning ?? `Privileges saved for ${selected.name}. Their access updates on the next request; the portal refreshes permissions within 30 seconds.`);
    } catch (error) { setError(error instanceof Error ? error.message : "Unable to save privileges."); }
    finally { setBusy(false); setPassword(""); }
  };

  if (role !== "super_admin") return <p className="flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600"><LockKeyhole className="h-5 w-5 shrink-0" />Only Super Admin can assign privileges. Contact your Super Admin to change your access.</p>;

  return <section aria-labelledby="admin-privileges-heading" className="space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 id="admin-privileges-heading" className="flex items-center gap-2 text-lg font-semibold text-slate-900"><ShieldCheck className="h-5 w-5 text-[#155D3B]" />Roles &amp; Permissions</h2><p className="mt-1 text-sm text-slate-500">Select an admin and choose the extra tasks they can perform.</p></div>
      <button type="button" disabled={loading || busy} className={actionButtonStyles()} onClick={() => { if (!dirty || window.confirm("Discard unsaved changes and reload admins?")) void load(); }}><RefreshCw className="h-4 w-4" />Reload admins</button>
    </div>
    {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {notice && <p role="status" className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">{notice}</p>}
    <div className="grid gap-5 lg:grid-cols-[minmax(220px,1fr)_minmax(0,2fr)]">
      <div className="overflow-hidden rounded-xl border border-slate-200">
        <div className="border-b border-slate-200 bg-slate-50 p-3"><label className="relative block"><Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" aria-hidden="true" /><input aria-label="Search admins" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search admins" className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-[#155D3B] focus:ring-2 focus:ring-[#155D3B]/15" /></label></div>
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
      <div className="rounded-xl border border-slate-200 p-5">
        {!selected ? <div className="flex min-h-72 flex-col items-center justify-center gap-3 text-center text-slate-500"><ShieldCheck className="h-10 w-10 text-slate-300" /><p className="text-sm">Select an admin to manage their privileges.</p></div> : <>
          <h3 className="font-semibold text-slate-900">{selected.name}</h3><p className="mt-1 break-all text-sm text-slate-500">{selected.email}</p>
          <fieldset disabled={busy || !selected.active} className="mt-5 space-y-3"><legend className="sr-only">Privileges for {selected.name}</legend>
            {adminPrivileges.map(item => <label key={item.key} className={`flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition-colors ${draft.includes(item.key) ? "border-[#155D3B]/30 bg-[#F0F7F3]" : "border-slate-200 bg-white"}`}>
              <input type="checkbox" checked={draft.includes(item.key)} onChange={event => { setDraft(current => event.target.checked ? [...current, item.key] : current.filter(key => key !== item.key)); setNotice(""); }} className="mt-0.5 h-4 w-4 shrink-0 accent-[#155D3B] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#155D3B]" />
              <span><span className="block text-sm font-semibold text-slate-800">{item.label}</span><span className="mt-1 block text-xs leading-5 text-slate-500">{item.description}</span></span>
            </label>)}
          </fieldset>
          <p className="mt-4 text-xs leading-5 text-slate-500">Admins retain their existing view access. Account management, loan approvals, releases, payments, loan policy, announcements, scheduled notifications and privilege assignment require Super Admin.</p>
          <div className="mt-5 border-t border-slate-100 pt-5"><label className="block text-xs font-semibold text-slate-600">Your Super Admin password<input type="password" autoComplete="current-password" value={password} disabled={busy || !selected.active} onChange={event => setPassword(event.target.value)} className="mt-2 block w-full max-w-sm rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#155D3B] focus:outline-none focus:ring-2 focus:ring-[#155D3B]/15" /></label>
            <div className="mt-4 flex flex-wrap items-center gap-3"><button type="button" disabled={busy || !selected.active || !dirty || !password} onClick={() => void save()} className={actionButtonStyles("primary")}><Save className="h-4 w-4" />{busy ? "Saving…" : "Save privileges"}</button><button type="button" disabled={busy || !dirty} onClick={() => { setDraft([...selected.privileges]); setPassword(""); setError(""); }} className={actionButtonStyles()}>Discard changes</button>{dirty && <span className="text-xs text-amber-700">Unsaved changes</span>}</div>
          </div>
        </>}
      </div>
    </div>
  </section>;
}
