"use client";

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
    <div className="rounded-[16px] border border-[#E5E7EB] bg-white p-6 shadow-[0_2px_10px_rgba(0,0,0,0.05)]">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div><h2 className="text-[16px] font-bold text-[#111827]">Loan Policy Settings</h2><p className="mt-1 text-xs text-[#64748B]">Stored in Supabase. Saving requires your Super Admin password and confirmation.</p></div>
        <button type="button" onClick={() => void loadPolicy()} disabled={loading || saving} className="text-sm font-semibold text-[#155D3B] underline disabled:opacity-50">Reload</button>
      </div>
      {error && <p role="alert" className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {notice && <p role="status" className="mb-4 rounded-lg bg-green-50 p-3 text-sm text-green-700">{notice}</p>}
      {loading || !policy ? <p role="status" className="py-8 text-center text-sm text-[#64748B]">Loading policy from database...</p> : <>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          {fields.map(({ key, label, step, min }) => <label key={key} className="block text-[11px] font-medium uppercase tracking-wider text-[#6B7280]">
            {label}
            <input type="number" min={min} step={step} value={policy[key]} disabled={!isSuperAdmin || saving}
              onChange={(event) => updateNumber(key, event.target.value)}
              className="mt-1.5 h-[42px] w-full rounded-[12px] border border-[#E5E7EB] bg-white pl-4 text-[16px] text-[#1F2937] focus:border-[#1F6B3A] focus:outline-none focus:ring-2 focus:ring-[#1F6B3A]/20 disabled:bg-slate-100 disabled:text-slate-500" />
          </label>)}
          <label className="block text-[11px] font-medium uppercase tracking-wider text-[#6B7280]">Loan Processing Time (Working Days)
            <input type="text" maxLength={100} value={policy.loan_processing_time} disabled={!isSuperAdmin || saving}
              onChange={(event) => { if (policy) setPolicy({ ...policy, loan_processing_time: event.target.value }); setNotice(""); }}
              className="mt-1.5 h-[42px] w-full rounded-[12px] border border-[#E5E7EB] bg-white pl-4 text-[16px] text-[#1F2937] focus:border-[#1F6B3A] focus:outline-none focus:ring-2 focus:ring-[#1F6B3A]/20 disabled:bg-slate-100 disabled:text-slate-500" />
          </label>
        </div>
        {policy.updated_at && <p className="mt-4 text-xs text-[#64748B]">Last saved: {new Date(policy.updated_at).toLocaleString()}</p>}
        {isSuperAdmin && <button type="button" onClick={() => void handleSave()} disabled={saving || !policy}
          className="mt-6 h-[42px] rounded-[12px] bg-[#1F6B3A] px-6 text-[14px] font-semibold text-white hover:bg-[#14532D] disabled:cursor-wait disabled:opacity-60">{saving ? "Saving..." : "Save Policy"}</button>}
      </>}
    </div>
  );
}
