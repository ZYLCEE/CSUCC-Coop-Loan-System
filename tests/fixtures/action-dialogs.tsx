import { useState } from "react";
import { ConfirmActionDialog } from "../../src/components/ui/ConfirmActionDialog";
import { FormDialog } from "../../src/components/ui/FormDialog";
import { Input } from "../../src/components/ui/Fields";
import { SecureAdminActionProvider, useSecureAdminAction } from "../../src/components/auth/SecureAdminActionProvider";
import LoanReleaseDialog from "../../src/components/loan-applications/LoanReleaseDialog";
import CounterPaymentDialog from "../../src/components/active-loans/CounterPaymentDialog";
import DocumentManager from "../../src/components/documents/DocumentManager";
import NotificationPopover from "../../src/components/shared/notifications/NotificationPopover";
import PasswordSection from "../../src/components/profile/PasswordSection";
import ModalPreviews from "./modal-previews";
import MembersPage from "../../src/app/(admin)/members/page";
import ActiveLoansPage from "../../src/app/(admin)/active-loans/page";
import LoanApplicationsPage from "../../src/app/(admin)/loan-applications/page";
import PortalSettings from "../../src/components/settings/PortalSettings";

function Actions() {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(false);
  const [draft, setDraft] = useState("");
  const [count, setCount] = useState(0);
  const [financial, setFinancial] = useState<"release" | "payment" | null>(null);
  const [documents, setDocuments] = useState(false);
  const [passwordForm, setPasswordForm] = useState(false);
  const { beginSecureAction } = useSecureAdminAction();
  return <main><button onClick={() => setOpen(true)}>Open confirmation</button>
    <button onClick={() => setFinancial("release")}>Release loan</button><button onClick={() => setFinancial("payment")}>Counter payment</button>
    <button onClick={() => setDocuments(true)}>Documents</button><NotificationPopover userId="test-user" routePrefix="/super-admin" />
    <button onClick={() => setPasswordForm(true)}>Password settings</button>
    {passwordForm && <PasswordSection onChanged={() => setCount(value => value + 1)} onBusyChange={() => {}} />}
    {documents && <DocumentManager />}
    <button onClick={() => setForm(true)}>Open form</button>
    <button onClick={() => beginSecureAction({ action: "approve-loan", target: "APP-TEST", title: "Approve application",
      question: "Approve this application?", confirmLabel: "Approve", successMessage: "Backend confirmed approval.", payload: {},
      details: [{ label: "Application", value: "APP-TEST" }, { label: "Member", value: "Test member" }],
      onSuccess: () => setCount(value => value + 1) })}>Secure action</button>
    <output aria-label="Completed actions">{count}</output>
    {financial === "release" && <LoanReleaseDialog applicationId="APP-TEST" onClose={() => setFinancial(null)} onReleased={() => setCount(value => value + 1)} />}
    {financial === "payment" && <CounterPaymentDialog loanId="loan-test" onClose={() => setFinancial(null)} onSaved={() => setCount(value => value + 1)} />}
    {open && <ConfirmActionDialog title="Delete document" question="Permanently delete this document?" confirmLabel="Delete"
      tone="destructive" onClose={() => setOpen(false)} onConfirm={async () => { await new Promise(resolve => setTimeout(resolve, 150)); setCount(value => value + 1); setOpen(false); }} />}
    {form && <FormDialog title="Test form" dirty={!!draft} onClose={() => setForm(false)}
      footer={<button type="submit" form="fixture-form">Save</button>}>
      <form id="fixture-form" onSubmit={event => { event.preventDefault(); setCount(value => value + 1); setDraft(""); setForm(false); }}>
        <label>Required value<Input required value={draft} onChange={event => setDraft(event.target.value)} /></label>
        <div style={{ height: 1300 }}>Long content</div>
      </form>
    </FormDialog>}
  </main>;
}
export default function Fixture() {
  const params = new URLSearchParams(window.location.search);
  if(params.has("workflow"))return <SecureAdminActionProvider><main className="min-w-0 p-4">{params.get("workflow")==="policy"?<PortalSettings/>:<LoanApplicationsPage/>}</main></SecureAdminActionProvider>;
  return <SecureAdminActionProvider>{params.has("active-loans") ? <ActiveLoansPage /> : params.has("accounts") ? <MembersPage /> : params.has("preview") ? <ModalPreviews /> : <Actions />}</SecureAdminActionProvider>;
}
