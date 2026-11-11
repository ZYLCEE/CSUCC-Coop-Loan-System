import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { checkDocumentError, DocumentServiceError, sharingFromBody } from "./documentWorkspaceData";

const mimeTypes: Record<string, string> = {
  pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};
export function validateSharedFile(file: { name: string; size: number }, bytes: Uint8Array, maxBytes = 10485760, allowed = Object.keys(mimeTypes)) {
  const extension = file.name.split(".").at(-1)?.toLowerCase() ?? "";
  const permitted=allowed.includes(extension) || extension==="jpeg" && allowed.includes("jpg") || extension==="jpg" && allowed.includes("jpeg");
  if (!file.name || file.name.length > 255 || !mimeTypes[extension] || !permitted) throw new DocumentServiceError("Choose a supported PDF, DOCX, PNG or JPG file.");
  if (!file.size || file.size !== bytes.length || file.size > maxBytes) throw new DocumentServiceError("Choose a non-empty file within the configured upload size limit.");
  const buffer = Buffer.from(bytes);
  const valid = extension === "pdf" ? buffer.subarray(0, 5).equals(Buffer.from("%PDF-"))
    : extension === "png" ? buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
      : ["jpg", "jpeg"].includes(extension) ? buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255
        : buffer.subarray(0, 4).equals(Buffer.from([80,75,3,4])) && buffer.includes(Buffer.from("word/document.xml")) && buffer.includes(Buffer.from("[Content_Types].xml"));
  if (!valid) throw new DocumentServiceError("The file content does not match its extension. Choose the original PDF, document or image.");
  return { extension, contentType: mimeTypes[extension] };
}
async function uploadSettings(service: SupabaseClient) {
  const result = await service.storage.from("coop-admin-resources").download("configuration/general.json");
  if (result.error) {
    if (/not found|does not exist|bucket.*not/i.test(result.error.message)) return { maxBytes: 10485760, allowed: Object.keys(mimeTypes) };
    throw new DocumentServiceError("Document upload settings could not be loaded. Refresh and retry.", 503);
  }
  let value: { maxUploadSize: number; allowedFileTypes: string };
  try { value = JSON.parse(await result.data.text()); } catch { throw new DocumentServiceError("Document upload settings could not be loaded.", 503); }
  if (!Number.isInteger(value.maxUploadSize) || value.maxUploadSize < 1 || value.maxUploadSize > 10 || typeof value.allowedFileTypes !== "string") throw new DocumentServiceError("Document upload settings are unavailable.", 503);
  return { maxBytes: value.maxUploadSize * 1024 * 1024, allowed: value.allowedFileTypes.toLowerCase().split(",").map(type => type.trim().replace(/^\./, "")) };
}
export async function uploadSharedDocument(service: SupabaseClient, session: SupabaseClient, userId: string, form: FormData) {
  const file = form.get("file"), raw = form.get("metadata");
  if (!(file instanceof File) || typeof raw !== "string" || raw.length > 12000) throw new DocumentServiceError("Choose a file and complete its sharing details.");
  let body: Record<string, unknown>;
  try { body = JSON.parse(raw); } catch { throw new DocumentServiceError("The document details are invalid."); }
  const id = typeof body.id === "string" ? body.id : "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) || typeof body.publish !== "boolean") throw new DocumentServiceError("The upload reference is invalid. Reopen the upload form.");
  const sharing = sharingFromBody(body, body.publish);
  if (!file.size || file.size > 10485760) throw new DocumentServiceError("Choose a non-empty file of up to 10 MB.");
  const settings = await uploadSettings(service), bytes = new Uint8Array(await file.arrayBuffer());
  const { contentType, extension } = validateSharedFile(file, bytes, settings.maxBytes, settings.allowed);
  const fingerprint = createHash("sha256").update(bytes).update(JSON.stringify({ ...sharing, recipientIds: [...sharing.recipientIds].sort() })).digest("hex");
  const path = userId + "/" + id + "." + extension;
  const existing = await service.from("shared_documents").select("id,created_by,request_fingerprint,deleted_at").eq("id", id).maybeSingle();
  checkDocumentError(existing.error);
  if (existing.data) {
    if (existing.data.created_by === userId && existing.data.request_fingerprint === fingerprint && !existing.data.deleted_at) return { id };
    throw new DocumentServiceError("This upload reference was already used. Refresh before uploading again.", 409);
  }
  const uploaded = await service.storage.from("coop-shared-documents").upload(path, bytes, { contentType, upsert: false });
  if (uploaded.error && !/already exists|duplicate/i.test(uploaded.error.message)) throw new DocumentServiceError("The file could not be uploaded. Check your connection and retry.", 503);
  const result = await session.rpc("save_shared_document", { p_payload: {
    id, title: sharing.title, category: sharing.category, description: sharing.description, audience: sharing.audience,
    recipient_ids: sharing.recipientIds, publish: sharing.publish, storage_path: path, original_name: file.name,
    content_type: contentType, size_bytes: file.size, fingerprint,
  } });
  if (result.error) {
    // A lost response must never erase an already committed document.
    const committed = await service.from("shared_documents").select("id,created_by,request_fingerprint").eq("id", id).maybeSingle();
    if (committed.data?.created_by === userId && committed.data.request_fingerprint === fingerprint) return { id };
    if (!committed.error && !committed.data && !uploaded.error) await service.storage.from("coop-shared-documents").remove([path]);
    checkDocumentError(result.error);
  }
  return { id };
}
