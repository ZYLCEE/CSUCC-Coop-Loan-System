"use client";
import PasswordInput from "@/components/ui/PasswordInput";
import { useEffect, useRef, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { FormDialog } from "@/components/ui/FormDialog";
import { DetailDialog } from "@/components/ui/DetailDialog";
import { Button } from "@/components/ui/Button";
import { ConfirmActionDialog } from "@/components/ui/ConfirmActionDialog";
import { ActionResultDialog } from "@/components/ui/ActionResultDialog";
import { adminPrivileges, type AdminPrivilege } from "@/lib/adminPrivileges";
import { adminPrivilegeRequest } from "@/lib/adminPrivilegeRequest";
import { useAdminAuth } from "@/components/auth/AdminAuthProvider";
import type { Member } from "./MembersData";

type Target = { id: string; active: boolean; privileges: AdminPrivilege[]; version: string | null };
export default function AccountPrivilegesDialog({ member, onClose }: { member: Member; onClose: () => void }) {
  const { role } = useAdminAuth();
  const protectedSuper = ["Super Admin", "Super Administrator"].includes(member.role);
  const [target, setTarget] = useState<Target | null>(null);
  const [draft, setDraft] = useState<AdminPrivilege[]>([]);
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const pending = useRef(false);
  const dirty = !!target && JSON.stringify([...target.privileges].sort()) !== JSON.stringify([...draft].sort());
  useEffect(() => {
    if (protectedSuper || role !== "super_admin") return;
    let active = true;
    void adminPrivilegeRequest().then(data => {
      const account = data.accounts.find((account: Target) => account.id === member.authUserId) as Target | undefined;
      if (!account) throw new Error("This account is not available for Admin privilege management.");
      if (active) { setTarget(account); setDraft([...account.privileges]); }
    }).catch(error => { if (active) setError(error instanceof Error ? error.message : "Unable to load privileges."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [member.authUserId, protectedSuper, role, attempt]);
  const save = async () => {
    if (!target || !target.active || !dirty || !password || pending.current || role !== "super_admin") return;
    pending.current = true; setBusy(true); setError("");
    try {
      const response = await adminPrivilegeRequest({ method: "PUT", body: JSON.stringify({ userId: target.id, privileges: draft, version: target.version, password }) });
      if (response.success !== true) throw new Error("The server did not confirm the privilege update.");
      setTarget({ ...target, privileges: [...draft], version: response.version });
      setPassword(""); setConfirm(false);
      setResult(response.warning ?? `Privileges saved for ${member.fullName}.`);
    } catch (error) { setError(error instanceof Error ? error.message : "Privileges could not be saved. Please retry."); }
    finally { pending.current = false; setBusy(false); }
  };
  if (role !== "super_admin") return <DetailDialog title="Role & Privileges" onClose={onClose} footer={<Button onClick={onClose}>Close</Button>}><p role="alert">Only Super Admin can manage account privileges.</p></DetailDialog>;
  if (protectedSuper) return <DetailDialog title="Role & Privileges" subtitle={`${member.idNumber} · ${member.fullName}`} icon={ShieldCheck} onClose={onClose} className="max-w-[540px]" footer={<Button onClick={onClose}>Close</Button>}>
    <p className="text-sm font-semibold text-coop-primary">Super Admin</p>
    <p className="mt-3 text-sm leading-6 text-portal-secondary">Access is inherited from the Super Admin role. COOP currently protects this account from role changes and per-account privilege editing.</p>
    <p className="mt-3 text-sm leading-6 text-portal-secondary">Super Admin permissions cannot be edited from All Accounts.</p>
  </DetailDialog>;
  return <>
    <FormDialog title="Role & Privileges" subtitle={`${member.idNumber} · ${member.fullName}`} icon={ShieldCheck} onClose={onClose} busy={busy} dirty={dirty || !!password} className="max-w-[620px]"
      footer={<><Button data-dialog-close disabled={busy}>Cancel</Button><Button variant="primary" type="submit" form="account-privileges-form" disabled={loading || !target?.active || !dirty || !password} loading={busy}>Save Changes</Button></>}>
      {loading ? <p role="status" className="text-sm text-portal-secondary">Loading current privileges…</p> : !target ? <div className="space-y-3"><p role="alert" className="ui-action-feedback ui-action-feedback--error">{error}</p><Button onClick={() => { setLoading(true); setError(""); setAttempt(value => value + 1); }}>Retry</Button></div> : <form id="account-privileges-form" className="space-y-4" onSubmit={event => { event.preventDefault(); if (dirty && password && target.active && !pending.current) { setError(""); setConfirm(true); } }}>
        <div className="rounded-lg bg-surface-muted p-3 text-sm"><span className="font-semibold">Role: Administrator</span><p className="mt-1 leading-6 text-portal-secondary">Choose additional COOP permissions. Your password will be verified before saving. To change this account’s role, use Edit from All Accounts.</p></div>
        {!target.active && <p role="status" className="text-sm text-status-warning">This Admin account is inactive. Privilege editing is unavailable.</p>}
        <fieldset disabled={busy || !target.active} className="space-y-2"><legend className="mb-2 text-sm font-semibold text-coop-primary">Additional Privileges</legend>
          {adminPrivileges.map(item => <label key={item.key} className="flex items-start gap-3 rounded-lg border border-portal-border p-3 text-sm">
            <input type="checkbox" className="mt-1 h-4 w-4 shrink-0 accent-coop-primary" checked={draft.includes(item.key)} onChange={event => setDraft(current => event.target.checked ? [...current, item.key] : current.filter(key => key !== item.key))} />
            <span><span className="block font-semibold">{item.label}</span><span className="mt-1 block text-xs leading-5 text-portal-secondary">{item.description}</span></span>
          </label>)}
        </fieldset>
        <label className="block space-y-2"><span className="text-label">Your Super Admin Password <span className="text-status-danger">*</span></span><PasswordInput label="Your Super Admin Password"  autoComplete="current-password" required maxLength={1024} value={password} disabled={busy || !target.active} onChange={event => setPassword(event.target.value)} className="block w-full" /></label>
        {error && !confirm && <p role="alert" className="ui-action-feedback ui-action-feedback--error">{error}</p>}
      </form>}
    </FormDialog>
    {confirm && <ConfirmActionDialog title="Save Account Privileges?" question="Save these COOP permissions for this Administrator?" details={[{ label: "Administrator", value: member.fullName }, { label: "ID Number", value: member.idNumber }, { label: "Enabled Privileges", value: draft.map(key => adminPrivileges.find(item => item.key === key)?.label).join(", ") || "None" }]} confirmLabel="Save Changes" cancelLabel="Back to Editing" busy={busy} error={error} onConfirm={save} onClose={() => { if (!pending.current) setConfirm(false); }} />}
    {result && <ActionResultDialog title="Privileges Updated" success message={result} onClose={onClose} />}
  </>;
}
