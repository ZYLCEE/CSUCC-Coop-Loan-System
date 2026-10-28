import {
  MembershipType,
  normalizeMembershipType,
} from "@/lib/membership";
import { getSupabaseClient } from "@/lib/supabase";

export interface LoanApplication {
  id: string;
  memberId: string;
  member: string;
  type: string;
  membershipType?: MembershipType;
  amount: string;
  status: "Pending" | "Under Review" | "Approved" | "Rejected" | "Released" | "Completed" | "Overdue";
  date: string;
}

interface SupabaseMemberLink {
  id?: string;
  member_id: string;
  first_name: string;
  last_name: string;
  membership_type: string | null;
}

interface SupabaseLoanRecord {
  application_id: string;
  member_name: string;
  loan_type: string;
  amount: number | string;
  status: string;
  date_submitted: string;
  members: SupabaseMemberLink | SupabaseMemberLink[] | null;
}

const loanApplicationSelect =
  "application_id, member_name, loan_type, amount, status, date_submitted, members(id, member_id, first_name, last_name, membership_type)";

function parseSupabaseLoanRecord(value: unknown): SupabaseLoanRecord {
  if (typeof value !== "object" || value === null) {
    throw new Error("Loan application data has an invalid format.");
  }
  const row = value as Record<string, unknown>;
  const memberValue = row.members;
  const isMemberLink = (candidate: unknown): candidate is SupabaseMemberLink =>
    typeof candidate === "object" &&
    candidate !== null &&
    "member_id" in candidate &&
    typeof candidate.member_id === "string" &&
    "first_name" in candidate &&
    typeof candidate.first_name === "string" &&
    "last_name" in candidate &&
    typeof candidate.last_name === "string" &&
    "membership_type" in candidate &&
    (typeof candidate.membership_type === "string" ||
      candidate.membership_type === null);
  const members =
    memberValue === null
      ? null
      : Array.isArray(memberValue)
        ? memberValue.filter(isMemberLink)
        : isMemberLink(memberValue)
          ? memberValue
          : null;

  if (
    typeof row.application_id !== "string" ||
    typeof row.member_name !== "string" ||
    typeof row.loan_type !== "string" ||
    (typeof row.amount !== "number" && typeof row.amount !== "string") ||
    typeof row.status !== "string" ||
    typeof row.date_submitted !== "string"
  ) {
    throw new Error("Loan application data has an invalid format.");
  }

  return {
    application_id: row.application_id,
    member_name: row.member_name,
    loan_type: row.loan_type,
    amount: row.amount,
    status: row.status,
    date_submitted: row.date_submitted,
    members,
  };
}

function isLoanStatus(value: string): value is LoanApplication["status"] {
  return [
    "Pending",
    "Under Review",
    "Approved",
    "Rejected",
    "Released",
    "Completed",
    "Overdue",
  ].includes(value);
}

function toLoanApplication(value: unknown): LoanApplication {
  const row = parseSupabaseLoanRecord(value);
  const statusLabel = row.status
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
  if (!isLoanStatus(statusLabel)) {
    throw new Error("The database returned an unsupported loan status.");
  }

  const relatedMember = Array.isArray(row.members)
    ? row.members[0]
    : row.members;
  const memberId = relatedMember?.member_id ?? "";
  const memberName = relatedMember
    ? [relatedMember.first_name, relatedMember.last_name]
        .filter(Boolean)
        .join(" ") || row.member_name
    : row.member_name;
  const membershipType = normalizeMembershipType(
    relatedMember?.membership_type,
  );

  return {
    id: row.application_id,
    memberId,
    member: memberName,
    type: row.loan_type,
    membershipType,
    amount: `₱${Number(row.amount).toLocaleString("en-PH", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`,
    status: statusLabel,
    date: new Date(row.date_submitted).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }),
  };
}

function toDatabaseStatus(status: string) {
  return status.trim().toLowerCase();
}

function parseCurrencyAmount(amount: string) {
  const parsedAmount = Number(amount.replace(/[^\d.-]/g, ""));

  if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
    throw new Error("Loan amount is invalid.");
  }

  return parsedAmount;
}

export async function fetchLoanApplications(): Promise<LoanApplication[]> {
  const { data, error } = await getSupabaseClient()
    .from("loan_applications")
    .select(loanApplicationSelect)
    .order("date_submitted", { ascending: false });
  if (error) {
    throw error;
  }

  const rows: unknown = data;
  if (!Array.isArray(rows)) {
    throw new Error("Loan application data has an invalid format.");
  }

  return rows.map(toLoanApplication);
}

export async function fetchLoanApplicationById(id: string): Promise<LoanApplication> {
  const { data, error } = await getSupabaseClient()
    .from("loan_applications")
    .select(loanApplicationSelect)
    .eq("application_id", id)
    .single();

  if (error) throw error;
  return toLoanApplication(data);
}

export async function createLoanApplication(application: Omit<LoanApplication, 'id' | 'date'>): Promise<LoanApplication> {
  const client = getSupabaseClient();
  const { data: member, error: memberError } = await client
    .from("members")
    .select("id, member_id, first_name, last_name, membership_type")
    .eq("member_id", application.memberId)
    .single();

  if (memberError || !member) {
    throw new Error("Selected member was not found in Supabase.");
  }

  const applicationId = `LA-${new Date().getFullYear()}-${Date.now().toString().slice(-6)}`;
  const { data, error } = await client
    .from("loan_applications")
    .insert({
      application_id: applicationId,
      member_id: member.id,
      member_name: application.member,
      loan_type: application.type,
      amount: parseCurrencyAmount(application.amount),
      purpose: application.type,
      status: toDatabaseStatus(application.status),
      date_submitted: new Date().toISOString().split("T")[0],
    })
    .select(loanApplicationSelect)
    .single();

  if (error) throw error;
  return toLoanApplication(data);
}

export async function updateLoanApplicationStatus(
  id: string,
  status: string,
  grantToken: string,
): Promise<LoanApplication> {
  void grantToken;
  const { data, error } = await getSupabaseClient()
    .from("loan_applications")
    .update({ status: toDatabaseStatus(status) })
    .eq("application_id", id)
    .select(loanApplicationSelect)
    .single();

  if (error) throw error;
  return toLoanApplication(data);
}
