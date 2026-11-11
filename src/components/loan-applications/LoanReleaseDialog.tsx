"use client";
import PasswordInput from "@/components/ui/PasswordInput";

import { Button } from "@/components/ui/Button";
import { FormDialog } from "@/components/ui/FormDialog";
import { ConfirmActionDialog, ActionSummary } from "@/components/ui/ConfirmActionDialog";
import { ActionResultDialog } from "@/components/ui/ActionResultDialog";
import { LoadingState } from "@/components/ui/Feedback";
import { Input, Textarea } from "@/components/ui/Fields";
import { HandCoins } from "lucide-react";

import { FormEvent, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {getAdminPortalPrefix} from '@/lib/auth/roles';
import ProcessingStepper from './ProcessingStepper';
import type {ApplicationVerification} from '@/lib/applicationWorkflow';
import type {AdminReviewState} from '@/lib/committeeReview';
import { useAdminAuth } from '@/components/auth/AdminAuthProvider';
import { loadLoanRelease, releaseApprovedLoan, releaseChargePreview, type ReleaseDetails, type ReleaseDraft, type ReleasedLoan } from '@/lib/loanRelease';

const control = 'mt-1 block w-full';
const currency = (value: string | number) => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(Number(value));

export default function LoanReleaseDialog({ applicationId, onClose, onReleased, onRecorded, processing=false, processingState }: { applicationId: string; onClose: () => void; onReleased: () => void; onRecorded?:(loan:ReleasedLoan)=>void; processing?:boolean; processingState?:{application:ApplicationVerification;review:AdminReviewState|null} }) {
  const { can,role } = useAdminAuth();
  const canRelease=can("loans.release");
  const [password,setPassword]=useState("");
  const [details, setDetails] = useState<ReleaseDetails | null>(null);
  const [initialDate] = useState(() => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date()));
  const [draft, setDraft] = useState<ReleaseDraft>({ date: initialDate, reference: '', notes: '' });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState<ReleasedLoan | null>(null);
  const releaseCharges = details ? releaseChargePreview(details) : null;
  const submitting = useRef(false);
  const request = useRef<{ payload: string; id: string } | null>(null);
  const referenceField = useRef<HTMLInputElement>(null);
  const editingReview = useRef(false);
  useEffect(() => {
    if (!review && editingReview.current) {
      referenceField.current?.focus();
      editingReview.current = false;
    }
  }, [review, saved]);
  const close = () => {
    if (submitting.current) return;
    if (saved) onReleased();
    onClose();
  };
  useEffect(() => {
    let active = true;
    if (!canRelease) return;
    void loadLoanRelease(applicationId).then(data => { if (active) setDetails(data); })
      .catch(error => { if (active) setError(error.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [applicationId, canRelease]);
  const submit = (event: FormEvent) => { event.preventDefault(); if (confirmed && details) { setError(''); setReview(true); } };
  const save = async () => {
    if (!details || !confirmed || submitting.current || saved || !canRelease) return;
    submitting.current = true; setBusy(true); setError('');
    try {
      const payload = JSON.stringify(draft);
      if (request.current?.payload !== payload) request.current = { payload, id: crypto.randomUUID() };
      const result=await releaseApprovedLoan(details, draft, request.current.id,password);
      setSaved(result);onRecorded?.(result);
    } catch (error) { setError(error instanceof Error ? error.message : 'Release could not be recorded. Refresh the loan before retrying.'); }
    finally { submitting.current = false; setBusy(false); setPassword(""); }
  };
  const eligible = details?.status === 'approved' && details.date_approved && !details.date_released;
  const stepperApplication=processingState?{...processingState.application,loanStatus:saved?"released":processingState.application.loanStatus}:undefined;
  return <FormDialog icon={HandCoins} dirty={!saved && (draft.date !== initialDate || !!draft.reference || !!draft.notes || confirmed || review)} title="Mark loan as released" titleId="release-loan-title"
    className="max-w-[900px]" overlayClassName={processing?"z-[160]":""} busy={busy} onClose={close}
    footer={!saved && eligible ? <><Button data-dialog-close disabled={busy}>Cancel</Button><Button type="submit" form="loan-release-form" variant="primary" disabled={!confirmed || busy || review}>Review release</Button></> : undefined}>
      {processing&&<ProcessingStepper application={stepperApplication} review={processingState?.review} currentStep={5} released={!!saved} />}
      {!canRelease ? <p role="alert">Your account needs permission to record loan releases.</p> : <>
        {error && <p role="alert" className="mb-4 rounded-lg bg-status-danger-surface p-3 text-sm text-status-danger">{error}</p>}
        {loading ? <LoadingState label="Loading approved loan…" /> : saved ? <ActionResultDialog title="Loan release recorded" overlayClassName={processing?"z-[180]":""} success message={`${saved.application_id} is marked as released.`} onClose={close}
          footer={<><Button onClick={close}>Done</Button><Link href={getAdminPortalPrefix(role??"admin")+"/active-loans"} onClick={onReleased} className="ui-button ui-button--primary">Open Active Loans</Link></>}>
          {processing&&<ProcessingStepper application={stepperApplication} review={processingState?.review} currentStep={5} released />}
          <ActionSummary details={[
            { label: "Member", value: details?.member_name ?? "Not recorded" },
            { label: "Approved principal", value: currency(saved.amount) }, { label: "Processing fee", value: currency(saved.processing_fee_amount_at_release) },
            { label: "Service fee", value: currency(saved.service_fee_amount_at_release) }, { label: "Net proceeds", value: currency(saved.net_proceeds) },
            { label: "Monthly interest rate", value: `${saved.interest_rate_at_release}%` }, { label: "Release date", value: saved.date_released },
            { label: "Reference", value: saved.release_reference },
          ]} />
          <p className="mt-4 text-support text-portal-muted">You can now record counter payments for this loan under Active Loans.</p>
        </ActionResultDialog> : details && releaseCharges && <>
          <dl className="mb-4 grid grid-cols-2 gap-3 rounded-lg bg-surface-muted p-4 text-sm"><div><dt className="text-portal-secondary">Application</dt><dd className="font-semibold">{details.application_id}</dd></div><div><dt className="text-portal-secondary">Member</dt><dd className="font-semibold">{details.member_name}</dd></div><div><dt className="text-portal-secondary">Approved principal</dt><dd className="font-semibold">{currency(details.amount)}</dd></div><div><dt className="text-portal-secondary">Approval date</dt><dd>{details.date_approved ?? 'Not recorded'}</dd></div></dl>
          {!eligible ? <p role="alert" className="text-sm text-status-warning">This loan must be Approved, have an approval date, and have no previous release. Refresh Loan Applications to see its current status.</p> : <form id="loan-release-form" onSubmit={submit}>
            <p className="mb-4 text-sm text-portal-muted">Confirm the actual disbursement using the net proceeds below. Monthly interest: {details.base_interest_rate}% on the declining principal balance.</p>
            <dl className="mb-4 grid grid-cols-2 gap-3 rounded-portal-control bg-status-warning-surface p-4 text-body">
              <div><dt>Processing fee ({details.processing_fee_percent}%)</dt><dd className="font-semibold">{currency(releaseCharges.processingFee)}</dd></div>
              <div><dt>Service fee ({details.service_fee_percent}%)</dt><dd className="font-semibold">{currency(releaseCharges.serviceFee)}</dd></div>
              <div><dt>Net proceeds to member</dt><dd className="font-semibold">{currency(releaseCharges.netProceeds)}</dd></div>
              <div><dt>Monthly interest rate</dt><dd className="font-semibold">{details.base_interest_rate}%</dd></div>
            </dl>
            <fieldset disabled={busy || review} className="space-y-4">
              <label className="block text-label">Release date<Input required type="date" min={details.date_approved && details.date_approved > details.date_submitted ? details.date_approved : details.date_submitted} max={new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date())} value={draft.date} onChange={event => setDraft({ ...draft, date: event.target.value })} className={control} /></label>
              <label className="block text-label">Disbursement reference / voucher number<Input ref={referenceField} required maxLength={80} value={draft.reference} onChange={event => setDraft({ ...draft, reference: event.target.value })} className={control} /></label>
              <label className="block text-label">Notes (optional)<Textarea maxLength={2000} value={draft.notes} onChange={event => setDraft({ ...draft, notes: event.target.value })} className={control} /></label>
              <label className="flex items-start gap-2 text-sm"><input required type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} className="mt-1" /><span>I confirm that the net proceeds shown above have been disbursed to this member and these details match the disbursement record.</span></label>
            </fieldset>
            {review && <ConfirmActionDialog icon={HandCoins} overlayClassName={processing?"z-[170]":""} title="Review release details" confirmLabel="Confirm release" cancelLabel="Edit details"
              question="Record this disbursement? The status, release date, policy snapshot, and staff audit record will be saved together. This action does not transfer money."
              details={[
                { label: "Application", value: details.application_id }, { label: "Member", value: details.member_name },
                { label: "Approved principal", value: currency(details.amount) }, { label: "Processing fee", value: currency(releaseCharges.processingFee) },
                { label: "Service fee", value: currency(releaseCharges.serviceFee) }, { label: "Net proceeds", value: currency(releaseCharges.netProceeds) },
                { label: "Monthly interest rate", value: `${details.base_interest_rate}%` }, { label: "Release date (Philippine time)", value: draft.date },
                { label: "Reference", value: draft.reference },
              ]} busy={busy} error={error} onConfirm={save}
              onClose={() => { editingReview.current = true; setReview(false); setError(''); setPassword(""); }}><label className="mt-4 block space-y-1.5 text-label">Your account password<PasswordInput label="Your account password"  autoComplete="current-password" disabled={busy} value={password} onChange={event=>setPassword(event.target.value)} className="w-full" /></label></ConfirmActionDialog>}
          </form>}
        </>}
      </>}
  </FormDialog>;
}
