import type { SupabaseClient } from "@supabase/supabase-js";
import {
  documentKinds, memberDocumentRequirements, recipientFromRow, validateReview, validateSharing,
  type DocumentApplication, type DocumentKind, type DocumentWorkspace, type MemberDocument, type SharedDocument,
} from "./documentWorkspace";

type Row = Record<string, unknown>;
export class DocumentServiceError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
const row = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const joined = (value: unknown) => row(Array.isArray(value) ? value[0] : value);
const text = (value: unknown, fallback = "") => typeof value === "string" ? value : fallback;
const nullableText = (value: unknown) => typeof value === "string" ? value : null;
export function checkDocumentError(error: { code?: string; message?: string } | null) {
  if (!error) return;
  if (error.code === "40001") throw new DocumentServiceError(error.message ?? "This document changed. Refresh before saving.", 409);
  if (error.code === "42501") throw new DocumentServiceError("Your account does not have permission to perform this document action.", 403);
  if (["42P01", "42883", "PGRST202"].includes(error.code ?? "")) throw new DocumentServiceError("Document review and sharing are unavailable. Contact the system administrator.", 503);
  if (error.code === "P0001") throw new DocumentServiceError(error.message ?? "The document request could not be completed.");
  throw new DocumentServiceError("The document service could not complete this request. Refresh and retry.", 503);
}
async function allRows(client: SupabaseClient, table: string, columns: string) {
  const rows: Row[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await client.from(table).select(columns).order("id").range(offset, offset + 499);
    checkDocumentError(error); rows.push(...(data ?? []).map(row));
    if (!data || data.length < 500) break;
  }
  return rows;
}
export async function loadDocumentWorkspace(service: SupabaseClient, session: SupabaseClient): Promise<DocumentWorkspace> {
  const warnings: string[] = [];
  const capability = await session.rpc("document_workspace_capabilities");
  const available = !capability.error && capability.data?.version === 1;
  if (capability.error && !["PGRST202", "42883", "42P01"].includes(capability.error.code ?? "")) checkDocumentError(capability.error);
  if (!available) warnings.push("Document review and sharing are unavailable. Existing files can still be viewed.");
  const [applications, files, policy, versions, reviews, sharedRows, assignments] = await Promise.all([
    allRows(service, "loan_applications", "id,application_id,member_id,member_name,loan_type,amount,status,date_submitted,members:members!loan_applications_member_id_fkey(id,user_id,member_id,first_name,last_name,membership_type)"),
    allRows(service, "loan_documents", "id,loan_application_id,user_id,kind,storage_path,original_name,content_type,size_bytes,created_at"),
    service.from("loan_policy_settings").select("collateral_required_above").eq("singleton", true).maybeSingle(),
    available ? allRows(service, "loan_document_versions", "*") : Promise.resolve([]),
    available ? allRows(service, "loan_document_reviews", "*") : Promise.resolve([]),
    available ? allRows(service, "shared_documents", "*") : Promise.resolve([]),
    available ? loadRecipientAssignments(service) : Promise.resolve([]),
  ]);
  const threshold = policy.error ? null : policy.data?.collateral_required_above ?? null;
  if (threshold === null) warnings.push("Loan document requirements could not be loaded. Refresh to load the current loan policy.");
  const memberIds = [...new Set(assignments.map(item => text(item.member_id)))].filter(Boolean);
  const members: Row[] = [];
  for (let start = 0; start < memberIds.length; start += 200) {
    const { data, error } = await service.from("members").select("id,member_id,first_name,last_name,membership_type,status").in("id", memberIds.slice(start, start + 200));
    checkDocumentError(error); members.push(...(data ?? []).map(row));
  }
  const recipientMap = new Map(members.map(item => [text(item.id), recipientFromRow(item)]));
  const normalizedApplications: DocumentApplication[] = applications.map(application => {
    const person = joined(application.members);
    const name = [person.first_name, person.last_name].filter(Boolean).join(" ").trim() || text(application.member_name, "Member not recorded");
    const documents: MemberDocument[] = files.filter(file => file.loan_application_id === application.id).map(file => {
      const kind = text(file.kind);
      if (!documentKinds.includes(kind as DocumentKind)) throw new DocumentServiceError("A document has an unsupported type. Contact the system administrator.", 503);
      return {
        id: text(file.id), kind: kind as DocumentKind,
        versions: [{ id: null, version: 1, name: text(file.original_name), contentType: text(file.content_type),
          size: Number(file.size_bytes), uploadedAt: text(file.created_at),
          uploadedBy: file.user_id === person.user_id ? name : "Uploader not recorded" },
          ...versions.filter(version => version.document_id === file.id).map(version => ({
            id: text(version.id), version: Number(version.version), name: text(version.original_name), contentType: text(version.content_type),
            size: Number(version.size_bytes), uploadedAt: text(version.created_at), uploadedBy: text(version.uploaded_by_name, "Member"),
          }))],
        reviews: reviews.filter(review => review.document_id === file.id).map(review => ({
          id: text(review.id), versionId: nullableText(review.version_id), status: review.status === "verified" ? "verified" : "needs_replacement",
          reason: nullableText(review.reason), reviewer: text(review.reviewer_name, "Administrator"), createdAt: text(review.created_at),
        })),
      };
    });
    const identity = recipientFromRow({ ...person, id: application.member_id, first_name: name, last_name: "" });
    return { id: text(application.id), applicationId: text(application.application_id), loanType: text(application.loan_type),
      loanStatus: text(application.status), memberId: nullableText(application.member_id), memberNumber: identity.memberNumber,
      memberName: name, membershipType: identity.membershipType, requiredKinds: memberDocumentRequirements(application.amount, threshold),
      documents, submittedAt: text(application.date_submitted) };
  });
  const shared: SharedDocument[] = sharedRows.filter(document => !document.deleted_at).map(document => ({
    id: text(document.id), source: "shared", title: text(document.title), category: text(document.category),
    description: text(document.description), filename: text(document.original_name), contentType: text(document.content_type),
    size: Number(document.size_bytes), createdAt: text(document.created_at), updatedAt: text(document.updated_at),
    uploadedBy: text(document.uploaded_by_name, "Administrator"), audience: document.audience === "selected" ? "selected" : "all",
    recipients: assignments.filter(assignment => assignment.document_id === document.id).flatMap(assignment => {
      const recipient = recipientMap.get(text(assignment.member_id)); return recipient ? [recipient] : [];
    }), status: document.status === "published" ? "published" : "draft",
  }));
  shared.push(...await legacyDocuments(service));
  return { applications: normalizedApplications, shared, capabilities: { reviews: available, sharing: available, canReview: available && capability.data?.canReview === true }, warnings };
}
async function loadRecipientAssignments(client: SupabaseClient) {
  const rows: Row[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await client.from("shared_document_recipients").select("document_id,member_id").order("document_id").order("member_id").range(offset, offset + 499);
    checkDocumentError(error); rows.push(...(data ?? []).map(row)); if (!data || data.length < 500) break;
  }
  return rows;
}
async function legacyDocuments(service: SupabaseClient): Promise<SharedDocument[]> {
  const { data: bucket, error } = await service.storage.getBucket("coop-admin-resources");
  if (!bucket) {
    if (error && !/not found|does not exist/i.test(error.message)) throw new DocumentServiceError("The staff document library could not be loaded.", 503);
    return [];
  }
  const documents: SharedDocument[] = [];
  for (let offset = 0; ; offset += 100) {
    const { data, error: listError } = await service.storage.from("coop-admin-resources").list("documents", { limit: 100, offset, sortBy: { column: "name", order: "asc" } });
    if (listError) throw new DocumentServiceError("The staff document library could not be loaded.", 503);
    for (const file of data.filter(file => file.id)) documents.push({
      id: "legacy:documents/" + file.name, source: "legacy", title: file.name.replace(/^[0-9a-f-]{36}-/i, ""), filename: file.name.replace(/^[0-9a-f-]{36}-/i, ""),
      category: "Staff library", description: "", contentType: file.metadata?.mimetype ?? "", size: file.metadata?.size ?? null,
      createdAt: file.created_at ?? "", updatedAt: file.updated_at ?? file.created_at ?? "", uploadedBy: "Not recorded",
      audience: "staff", recipients: [], status: "staff_only",
    });
    if (data.length < 100) break;
  }
  return documents;
}
export async function findDocumentRecipients(session: SupabaseClient, search: string) {
  const term = search.trim().slice(0, 100);
  if (term.length < 2) return [];
  const { data, error } = await session.rpc("search_document_recipients", {p_search:term});
  checkDocumentError(error); return ((data ?? []) as unknown[]).map(item => recipientFromRow(row(item)));
}
export async function getDocumentLink(service: SupabaseClient, kind: string, id: string, versionId: string | null) {
  let bucket = "loan-documents", path = "", contentType = "", name = "";
  if (kind === "member") {
    const root = await service.from("loan_documents").select("storage_path,content_type,original_name").eq("id", id).maybeSingle();
    checkDocumentError(root.error);
    if (!root.data) throw new DocumentServiceError("The document was not found.", 404);
    let file = root.data;
    if (versionId) {
      const version = await service.from("loan_document_versions").select("storage_path,content_type,original_name").eq("id", versionId).eq("document_id", id).maybeSingle();
      checkDocumentError(version.error);
      if (!version.data) throw new DocumentServiceError("The file version was not found.", 404);
      file = version.data;
    }
    path = file.storage_path; contentType = file.content_type; name = file.original_name;
  } else if (kind === "shared") {
    const result = await service.from("shared_documents").select("storage_path,content_type,original_name").eq("id", id).is("deleted_at", null).maybeSingle();
    checkDocumentError(result.error);
    if (!result.data) throw new DocumentServiceError("The shared document is unavailable.", 404);
    bucket = "coop-shared-documents"; path = result.data.storage_path; contentType = result.data.content_type; name = result.data.original_name;
  } else if (kind === "legacy" && /^legacy:documents\/[a-zA-Z0-9_.-]+$/.test(id)) {
    bucket = "coop-admin-resources"; path = id.slice("legacy:".length); name = path.split("/").at(-1) ?? "Document";
    contentType = /\.pdf$/i.test(name) ? "application/pdf" : /\.(png|jpe?g)$/i.test(name) ? "image/" + (/png$/i.test(name) ? "png" : "jpeg") : "";
  } else throw new DocumentServiceError("Select a valid document.");
  const { data, error } = await service.storage.from(bucket).createSignedUrl(path, 300);
  if (error || !data?.signedUrl) throw new DocumentServiceError("The file could not be opened. Refresh the document link and retry.", 503);
  return { url: data.signedUrl, contentType, name, expiresAt: new Date(Date.now() + 300000).toISOString() };
}
export async function saveDocumentReview(session: SupabaseClient, body: Row) {
  const review = validateReview(body.status, body.reason);
  const result = await session.rpc("record_document_review", { p_document_id: body.documentId, p_version_id: body.versionId ?? null,
    p_expected_review_id: body.expectedReviewId ?? null, p_status: review.status, p_reason: review.reason });
  checkDocumentError(result.error); return result.data;
}
export function sharingFromBody(body: Row, publish: boolean) {
  if (!Array.isArray(body.recipientIds) || body.recipientIds.some(value => typeof value !== "string")) throw new DocumentServiceError("Select valid member recipients.");
  return validateSharing({ title: text(body.title), category: text(body.category), description: text(body.description),
    audience: text(body.audience), recipientIds: body.recipientIds as string[], publish });
}
