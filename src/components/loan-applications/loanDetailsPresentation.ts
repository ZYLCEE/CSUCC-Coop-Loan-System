import { pesos } from "@/lib/counterPayments";
import { getMembershipTypeLabel, normalizeMembershipType } from "@/lib/membership";
import type { LoanRejectionDetails } from "@/lib/loanRejection";

export type DetailField = { label: string; value: string; wide?: boolean; status?: boolean };
export type DetailSection = { title: string; fields: DetailField[]; message?: string };
type RecordData = Record<string, unknown>;
const text = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : undefined;
const numeric = (value: unknown) => (typeof value === "number" || typeof value === "string" && value.trim() !== "") && Number.isFinite(Number(value)) ? Number(value) : undefined;
const currency = (value: unknown) => { const amount = numeric(value); return amount === undefined ? undefined : pesos(amount); };

// Calendar dates stay calendar dates; timestamp instants are displayed in Manila.
export function loanDetailDate(value: unknown): string | undefined {
  const source = text(value);
  if (!source) return undefined;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(source);
  if (!dateOnly && !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(source)) return undefined;
  const date = new Date(dateOnly ? `${source}T00:00:00Z` : source);
  if (!Number.isFinite(date.getTime()) || dateOnly && date.toISOString().slice(0, 10) !== source) return undefined;
  return new Intl.DateTimeFormat("en-PH", { month: "long", day: "numeric", year: "numeric", timeZone: dateOnly ? "UTC" : "Asia/Manila" }).format(date);
}

export function loanDetailsPresentation(record: RecordData, applicationId: string, rejection?: LoanRejectionDetails | null) {
  const status = text(record.status)?.toLowerCase().trim().replaceAll("_", " ") ?? "";
  const labels: Record<string, string> = { pending: "Pending", "under review": "Pending", returned:"Returned", approved: "Approved", rejected: "Rejected", released: "Released", completed: "Completed", overdue: "Overdue" };
  const operational = ["released", "completed", "overdue"].includes(status);
  const memberValue = Array.isArray(record.members) ? record.members[0] : record.members;
  const member = memberValue && typeof memberValue === "object" ? memberValue as RecordData : {};
  const memberName = [text(member.first_name), text(member.last_name)].filter(Boolean).join(" ") || text(record.member_name);
  const membership = normalizeMembershipType(member.membership_type);
  const term = numeric(record.tenure_months);
  const sections: DetailSection[] = [];
  const application: DetailSection = { title: operational ? "Loan Summary" : "Loan Application Information", fields: [] };
  const add = (section: DetailSection, label: string, value: string | undefined, required = false, wide = false) => {
    if (value !== undefined || required) section.fields.push({ label, value: value ?? "Not available", wide });
  };
  add(application, "Application ID", text(record.application_id) ?? applicationId, true);
  add(application, "Loan Type", text(record.loan_type), true);
  add(application, operational ? "Original Principal" : "Requested Loan Amount", currency(record.amount), true);
  if (!operational) {
    add(application, "Repayment Term", term !== undefined && term > 0 ? `${term} months` : undefined, true);
    add(application, "Date Submitted", loanDetailDate(record.date_submitted), true);
  }
  application.fields.push({ label: "Current Application Status", value: labels[status] ?? text(record.status) ?? "Not available", status: true });
  if (!operational) add(application, "Loan Purpose", text(record.purpose), true, true);
  sections.push(application);
  const applicant: DetailSection = { title: "Applicant Information", fields: [] };
  add(applicant, "Member Full Name", memberName, true);
  add(applicant, "Membership Number", text(member.member_id));
  add(applicant, "Membership Type", membership ? getMembershipTypeLabel(membership) : undefined);
  if (!operational) add(applicant, "Monthly Income", currency(record.income));
  sections.push(applicant);
  for(const [label,keys] of [["Email",["email"]],["Contact Number",["contact_number","phone_number","phone"]],["Address",["address","residential_address"]],["Occupation",["occupation","position"]],["Employer",["employer","employer_name"]]] as const){
    add(applicant,label,keys.map(key=>text(record[key])??text(member[key])).find(Boolean));
  }
  const comaker:DetailSection={title:"Co-maker Information",fields:[]};
  for(const [label,keys] of [["Co-maker Name",["co_maker_name","comaker_name"]],["Member Reference",["co_maker_member_id","comaker_member_id"]],["Relationship",["co_maker_relationship","relationship_to_co_maker"]]] as const){add(comaker,label,keys.map(key=>text(record[key])).find(Boolean));}
  if(comaker.fields.length)sections.push(comaker);

  if (!operational) {
    const review: DetailSection = { title: "Application Review Information", fields: [] };
    if (status === "pending") review.message = "This loan application is awaiting administrative review.";
    else if (status === "under review") review.message = "This loan application is awaiting requirements and committee processing.";
    else if (status === "returned") review.message="This application was returned for correction. Review the recorded correction instructions and requirements below.";
    else if (status === "rejected") {
      review.title = "Rejection Information";
      if (rejection) {
        add(review, "Rejection Reason", rejection.reason, false, true);
        const instant = new Date(rejection.rejected_at);
        add(review, "Rejection Date", Number.isFinite(instant.getTime()) ? `${new Intl.DateTimeFormat("en-PH", { dateStyle: "long", timeStyle: "short", timeZone: "Asia/Manila" }).format(instant)} (Asia/Manila)` : undefined);
        add(review, "Rejected By", text(rejection.rejected_by));
      }
      review.message = rejection ? "This loan application was rejected." : "This loan application was rejected. Additional decision information is not available in this record.";
    }
    else if (status === "approved") {
      add(review, "Date Approved", loanDetailDate(record.date_approved));
      review.message = "This loan application is approved. Approval does not indicate that funds have been released.";
    } else review.message = "Review information is not available for this application status.";
    sections.push(review);
  } else {
    const release: DetailSection = { title: "Release Information", fields: [] };
    add(release, "Release Date", loanDetailDate(record.date_released));
    add(release, "Repayment Term", term !== undefined && term > 0 ? `${term} months` : undefined);
    add(release, "Release Reference", text(record.release_reference));
    if (release.fields.length) sections.push(release);
    const repayment: DetailSection = { title: "Repayment Information", fields: [], message: status === "completed" ? "Repayment is completed. Open payment history for transaction details." : status === "overdue" ? "This loan is overdue. Open payment history for available balances and repayment details." : "Open payment history for available balances and transaction details." };
    add(repayment, "Monthly Installment (Recorded)", currency(record.monthly_payment));
    if (status === "completed") add(repayment, "Date Completed", loanDetailDate(record.date_completed));
    sections.push(repayment);
  }
  return { status, operational, sections };
}
