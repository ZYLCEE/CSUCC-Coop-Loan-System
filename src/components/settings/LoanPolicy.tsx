"use client";

import { ActionFeedback } from "@/components/ui/Feedback";

import { Input } from "@/components/ui/Fields";

import { actionButtonStyles } from "@/components/shared/actionButtonStyles";
import { useCallback, useEffect, useState } from "react";
import { fetchLoanPolicy, LoanPolicy as LoanPolicyData } from "@/lib/loanPolicy";
import { useAdminAuth } from "@/components/auth/AdminAuthProvider";
import { useSecureAdminAction } from "@/components/auth/SecureAdminActionProvider";

type FieldKey = keyof Pick<LoanPolicyData,
  "base_interest_rate" | "processing_fee_percent" | "max_loan_multiplier" |
  "min_member_tenure_months" | "penalty_rate_percent" | "service_fee_percent" |
  "co_maker_required_above" | "collateral_required_above" | "min_loan_amount" | "max_loan_amount">;

const fields: Array<{ key: FieldKey; label: string; step: string; min: number }> = [
  { key: "base_interest_rate", label: "Base Interest Rate (%/Month)", step: "0.01", min: 0 },
  { key: "processing_fee_percent", label: "Processing Fee (%)", step: "0.01", min: 0 },
  { key: "max_loan_multiplier", label: "Max Loan Multiplier (× Share Capital)", step: "0.1", min: 0.01 },
  { key: "min_member_tenure_months", label: "Min Member Tenure (Months)", step: "1", min: 0 },
  { key: "penalty_rate_percent", label: "Penalty Rate (%/Month)", step: "0.01", min: 0 },
  { key: "service_fee_percent", label: "Service Fee (%)", step: "0.01", min: 0 },
  { key: "co_maker_required_above", label: "Co-Maker Required Above (₱)", step: "1000", min: 0 },
  { key: "collateral_required_above", label: "Collateral Document Required Above (₱)", step: "1000", min: 0 },
  { key: "min_loan_amount", label: "Minimum Loan Amount (₱)", step: "100", min: 0.01 },
  { key: "max_loan_amount", label: "Maximum Loan Amount (₱)", step: "1000", min: 0.01 },
];

export default function LoanPolicy() {
  const { role } = useAdminAuth();
  const { beginSecureAction } = useSecureAdminAction();
  const isSuperAdmin = role === "super_admin";
  const [policy, setPolicy] = useState<LoanPolicyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadPolicy = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    setError("");
    try { setPolicy(await fetchLoanPolicy()); }
    catch { setError("Unable to load loan policy from Supabase. Check database setup and retry."); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    const request = window.setTimeout(() => void loadPolicy(false), 0);
    return () => window.clearTimeout(request);
  }, [loadPolicy]);

  const updateNumber = (key: FieldKey, value: string) => {
    if (!policy) return;
    setNotice("");
    setPolicy({ ...policy, [key]: value === "" ? 0 : Number(value) });
  };

  const handleSave = async () => {
    if (!policy || !isSuperAdmin || saving) return;
    if (policy.min_loan_amount <= 0 || policy.max_loan_amount < policy.min_loan_amount ||
      policy.base_interest_rate < 0 || policy.processing_fee_percent < 0 ||
      policy.max_loan_multiplier <= 0 || policy.min_member_tenure_months < 0 ||
      policy.penalty_rate_percent < 0 || policy.service_fee_percent < 0 ||
      policy.co_maker_required_above < 0 || policy.collateral_required_above < 0 ||
      policy.loan_processing_time.trim().length === 0) {
      setError("Check the policy values. Fees and rates cannot be negative; maximum loan must be at least the minimum.");
      return;
    }
    setError("");
    setNotice("");
    setSaving(true);
    beginSecureAction({
      action: "update-loan-policy",
      target: "loan-policy",
      title: "Verify to save loan policy",
      question: "Save these loan policy changes? New applications will use the updated values.",
      confirmLabel: "Save Policy",
      successMessage: "Loan policy saved successfully.",
      details: [...fields.map(field => ({ label: field.label, value: field.label.includes("₱")
        ? new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(policy[field.key])
        : String(policy[field.key]) })), { label: "Processing time (working days)", value: policy.loan_processing_time }],
      payload: {
        base_interest_rate: policy.base_interest_rate,
        processing_fee_percent: policy.processing_fee_percent,
        max_loan_multiplier: policy.max_loan_multiplier,
        min_member_tenure_months: policy.min_member_tenure_months,
        penalty_rate_percent: policy.penalty_rate_percent,
        service_fee_percent: policy.service_fee_percent,
        co_maker_required_above: policy.co_maker_required_above,
        collateral_required_above: policy.collateral_required_above,
        loan_processing_time: policy.loan_processing_time.trim(),
        min_loan_amount: policy.min_loan_amount,
        max_loan_amount: policy.max_loan_amount,
      },
      onSuccess: () => {
        setSaving(false);
        setNotice("Loan policy saved to Supabase.");
        void fetchLoanPolicy().then(setPolicy).catch(() => setError("Saved, but failed to reload policy values. Use Reload to refresh."));
      },
      onCancel: () => setSaving(false),
      onFailure: () => setSaving(false),
    });
  };

  return (
    <div className="ui-card ui-card-padding">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div><h2 className="text-card-title">Loan Policy Settings</h2><p className="mt-1 text-xs text-[#64748B]">Stored in Supabase. Saving requires your Super Admin password and confirmation.</p></div>
        <button type="button" onClick={() => void loadPolicy()} disabled={loading || saving} className={actionButtonStyles()}>Reload</button>
      </div>
      {error && <ActionFeedback error>{error}</ActionFeedback>}
      {notice && <ActionFeedback>{notice}</ActionFeedback>}
      {loading || !policy ? <p role="status" className="py-8 text-center text-sm text-[#64748B]">Loading policy from database...</p> : <>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          {fields.map(({ key, label, step, min }) => <label key={key} className="block text-label text-portal-primary">
            {label}
            <Input type="number" min={min} step={step} value={policy[key]} disabled={!isSuperAdmin || saving}
              onChange={(event) => updateNumber(key, event.target.value)}
              className="mt-1 block w-full" />
            {key === 'base_interest_rate' && <span className="mt-1 block text-xs font-normal normal-case tracking-normal text-slate-500">
              New loans snapshot this rate at release. Repayments accrue monthly interest on the declining principal balance.
            </span>}
            {(key === 'processing_fee_percent' || key === 'service_fee_percent') && <span className="mt-1 block text-xs font-normal normal-case tracking-normal text-slate-500">
              Charged once at release and deducted from the proceeds, not added to each payment.
            </span>}
            {key === 'penalty_rate_percent' && <span className="mt-1 block text-xs font-normal normal-case tracking-normal text-slate-500">
              Applied to overdue installments using recorded effective dates. Unknown historical periods are not back-charged.
            </span>}
          </label>)}
          <label className="block text-label text-portal-primary">Loan Processing Time (Working Days)
            <Input type="text" maxLength={100} value={policy.loan_processing_time} disabled={!isSuperAdmin || saving}
              onChange={(event) => { if (policy) setPolicy({ ...policy, loan_processing_time: event.target.value }); setNotice(""); }}
              className="mt-1 block w-full" />
          </label>
        </div>
        {policy.updated_at && <p className="mt-4 text-xs text-[#64748B]">Last saved: {new Date(policy.updated_at).toLocaleString()}</p>}
        {isSuperAdmin && <button type="button" onClick={() => void handleSave()} disabled={saving || !policy}
          className="ui-button ui-button--primary mt-6">{saving ? "Saving..." : "Save Policy"}</button>}
      </>}
    </div>
  );
}
