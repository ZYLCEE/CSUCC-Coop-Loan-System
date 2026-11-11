import { normalizeMembershipType } from "./membership";

export const documentKinds = ["validId", "payslip", "collateral", "supporting"] as const;
export type DocumentKind = typeof documentKinds[number];
export const documentKindLabels: Record<DocumentKind, string> = {
  validId: "Valid ID", payslip: "Pay Slip", collateral: "Collateral Document", supporting: "Supporting Document",
};
export type FileReviewStatus = "to_review" | "verified" | "needs_replacement";
export type SubmissionReviewStatus = FileReviewStatus | "awaiting_files" | "requirements_unavailable";
export type ReviewEvent = { id: string; versionId: string | null; status: Exclude<FileReviewStatus, "to_review">; reason: string | null; reviewer: string; createdAt: string };
export type FileVersion = { id: string | null; version: number; name: string; contentType: string; size: number; uploadedAt: string; uploadedBy: string };
export type MemberDocument = {
  id: string; kind: DocumentKind; versions: FileVersion[]; reviews: ReviewEvent[];
};
export type DocumentApplication = {
  id: string; applicationId: string; loanType: string; loanStatus: string;
  memberId: string | null; memberNumber: string; memberName: string;
  membershipType: "regular" | "associate" | null;
  requiredKinds: DocumentKind[] | null; documents: MemberDocument[]; submittedAt: string;
};
export type DocumentRecipient = { id: string; memberNumber: string; name: string; membershipType: "regular" | "associate" | null; active: boolean };
export type SharedDocument = {
  id: string; source: "shared" | "legacy"; title: string; category: string; description: string;
  filename: string; contentType: string; size: number | null; createdAt: string; updatedAt: string;
  uploadedBy: string; audience: "all" | "selected" | "staff"; recipients: DocumentRecipient[];
  status: "published" | "draft" | "staff_only";
};
export type DocumentWorkspace = {
  applications: DocumentApplication[]; shared: SharedDocument[];
  capabilities: { reviews: boolean; sharing: boolean; canReview: boolean }; warnings: string[];
};
export const reviewLabels: Record<SubmissionReviewStatus, string> = {
  to_review: "To review", verified: "Verified", needs_replacement: "Needs replacement",
  awaiting_files: "Awaiting files", requirements_unavailable: "Requirements unavailable",
};

export function latestFileVersion(document: MemberDocument): FileVersion {
  return document.versions.reduce((latest, current) => current.version > latest.version ? current : latest);
}
export function latestFileReview(document: MemberDocument, versionId = latestFileVersion(document).id): ReviewEvent | null {
  return document.reviews.filter(review => review.versionId === versionId)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.id.localeCompare(a.id))[0] ?? null;
}
export function documentApplicationSummary(application: DocumentApplication) {
  const missing = application.requiredKinds?.filter(kind => !application.documents.some(document => document.kind === kind)) ?? [];
  const statuses = application.documents.map(document => latestFileReview(document)?.status ?? "to_review");
  const complete = application.requiredKinds === null ? null : missing.length === 0;
  const status: SubmissionReviewStatus = statuses.includes("needs_replacement") ? "needs_replacement"
    : complete === null ? "requirements_unavailable" : !complete ? "awaiting_files"
      : statuses.length > 0 && statuses.every(value => value === "verified") ? "verified" : "to_review";
  const times = application.documents.map(document => latestFileVersion(document).uploadedAt).filter(Boolean);
  const lastUpload = times.sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null;
  return { missing, complete, status, lastUpload, uploadedRequired: application.requiredKinds === null ? null : application.requiredKinds.length - missing.length,
    verified: statuses.filter(value => value === "verified").length };
}
export function filterDocumentApplications(applications: DocumentApplication[], filters: {
  search: string; review: string; completeness: string; membership: string;
}) {
  const search = filters.search.trim().toLowerCase();
  return applications.filter(application => {
    const summary = documentApplicationSummary(application);
    const searchable = [application.memberName, application.memberNumber, application.applicationId, application.loanType,
      ...application.documents.flatMap(document => [documentKindLabels[document.kind], ...document.versions.map(version => version.name)])].join(" ").toLowerCase();
    return searchable.includes(search) && (filters.review === "all" || summary.status === filters.review)
      && (filters.completeness === "all" || (filters.completeness === "complete" ? summary.complete === true : summary.complete === false))
      && (filters.membership === "all" || application.membershipType === filters.membership);
  });
}
export function memberDocumentRequirements(amount: unknown, collateralThreshold: unknown): DocumentKind[] | null {
  if (collateralThreshold == null || amount == null || !Number.isFinite(Number(amount)) || !Number.isFinite(Number(collateralThreshold))) return null;
  return Number(amount) > Number(collateralThreshold) ? ["validId", "payslip", "collateral"] : ["validId", "payslip"];
}
export function validateReview(status: unknown, reason: unknown) {
  if (status !== "verified" && status !== "needs_replacement") throw new Error("Choose Verified or Needs replacement.");
  const text = typeof reason === "string" ? reason.trim() : "";
  if (text.length > 2000) throw new Error("The replacement reason must be at most 2,000 characters.");
  if (status === "needs_replacement" && !text) throw new Error("Enter a reason the member can use to correct the document.");
  return { status, reason: status === "verified" ? null : text };
}
export function validateSharing(value: { title: string; category: string; description: string; audience: string; recipientIds: string[]; publish: boolean }) {
  const title = value.title.trim(), description = value.description.trim();
  if (!title || title.length > 160) throw new Error("Enter a document title of up to 160 characters.");
  if (!["Forms", "Guides", "Checklists", "Other"].includes(value.category)) throw new Error("Choose a document category.");
  if (description.length > 2000) throw new Error("The description must be at most 2,000 characters.");
  if (!["all", "selected"].includes(value.audience)) throw new Error("Choose All members or Selected members.");
  const recipientIds = [...new Set(value.recipientIds)];
  if (recipientIds.length > 100 || recipientIds.some(id => !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))) throw new Error("Choose valid member recipients (up to 100 per document).");
  if (value.publish && value.audience === "selected" && !recipientIds.length) throw new Error("Select at least one member before publishing.");
  return { ...value, title, description, recipientIds: value.audience === "all" ? [] : recipientIds };
}
export function recipientFromRow(row: Record<string, unknown>): DocumentRecipient {
  return { id: String(row.id), memberNumber: String(row.member_id ?? "Not recorded"),
    name: [row.first_name, row.last_name].filter(Boolean).join(" ").trim() || "Member not recorded",
    membershipType: normalizeMembershipType(row.membership_type), active: row.status === "active" };
}
