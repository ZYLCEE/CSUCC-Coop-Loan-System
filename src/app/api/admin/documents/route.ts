import {verifiedAdministratorAction,CommitteeError} from "@/lib/committeeServer";
import {portalActivityHeaders} from "@/lib/portalActivityServer";
import { createClient } from "@supabase/supabase-js";
import { hasAdminPrivilege, isActiveAdministrator } from "@/lib/adminPrivileges";
import { checkDocumentError, DocumentServiceError, findDocumentRecipients, getDocumentLink, loadDocumentWorkspace, saveDocumentReview, sharingFromBody } from "@/lib/documentWorkspaceData";
import { uploadSharedDocument } from "@/lib/sharedDocumentUpload";

const uuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
export async function GET(request: Request) { return handle(request); }
export async function POST(request: Request) { return handle(request); }
export async function DELETE(request: Request) { return handle(request); }

async function handle(request: Request) {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL, secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const publicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !secret || !publicKey) return reply({error:"The server document service is unavailable."},503);
    const token = request.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
    if (!token) return reply({error:"Sign in to continue."},401);
    const options = {auth:{persistSession:false,autoRefreshToken:false},global:{headers:portalActivityHeaders(request)}};
    const service = createClient(url,secret,options);
    const {data:{user},error} = await service.auth.getUser(token);
    if (error || !user) return reply({error:"Your session expired. Sign in again."},401);
    if (!isActiveAdministrator(user)) return reply({error:"Active administrator access is required."},403);
    const session = createClient(url,publicKey,{...options,global:{headers:{Authorization:"Bearer "+token}}});
    const params = new URL(request.url).searchParams;
    if (request.method === "GET") {
      const operation = params.get("operation") ?? "workspace";
      if (operation === "workspace") return reply(await loadDocumentWorkspace(service,session));
      if (operation === "recipients") return reply(await findDocumentRecipients(session,params.get("search") ?? ""));
      if (operation === "file") {
        const access=await session.rpc("document_workspace_capabilities");
        checkDocumentError(access.error);
        const kind = params.get("kind") ?? "", id = params.get("id") ?? "", versionId = params.get("versionId");
        if ((kind !== "legacy" && !uuid(id)) || versionId && !uuid(versionId)) throw new DocumentServiceError("Choose a valid document and version.");
        return reply(await getDocumentLink(service,kind,id,versionId));
      }
      throw new DocumentServiceError("Unknown document request.");
    }
    if (request.method === "POST" && request.headers.get("content-type")?.startsWith("multipart/form-data")) {
      if (!hasAdminPrivilege(user,"documents.upload")) return reply({error:"Document upload permission is required."},403);
      if (Number(request.headers.get("content-length") ?? 0) > 11 * 1024 * 1024) throw new DocumentServiceError("Choose a file of up to 10 MB.");
      return reply(await uploadSharedDocument(service,session,user.id,await request.formData()));
    }
    const raw = await request.text();
    if (raw.length > 16000) throw new DocumentServiceError("The document request is too large.");
    let body: Record<string,unknown>;
    try { body = JSON.parse(raw); } catch { throw new DocumentServiceError("The document request is invalid."); }
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new DocumentServiceError("The document request is invalid.");
    if (request.method === "POST" && body.operation === "review") {
      if (!hasAdminPrivilege(user,"documents.review")) return reply({error:"Document review permission is required."},403);
      if (!uuid(body.documentId) || body.versionId != null && !uuid(body.versionId) || body.expectedReviewId != null && !uuid(body.expectedReviewId)) throw new DocumentServiceError("Choose a valid document review.");
      const confirmed=await verifiedAdministratorAction(request,body.password,"documents.review");
      if(confirmed.user.id!==user.id)return reply({error:"Your session changed. Sign in again."},401);
      return reply(await saveDocumentReview(session,body));
    }
    if (request.method === "POST" && body.operation === "publish") {
      if (!hasAdminPrivilege(user,"documents.upload")) return reply({error:"Document upload permission is required."},403);
      if (!uuid(body.id) || typeof body.updatedAt !== "string" || !Number.isFinite(Date.parse(body.updatedAt))) throw new DocumentServiceError("Refresh the draft before publishing.");
      const sharing = sharingFromBody(body,true);
      const result = await session.rpc("publish_shared_document",{p_id:body.id,p_expected_updated_at:body.updatedAt,p_audience:sharing.audience,p_recipient_ids:sharing.recipientIds});
      checkDocumentError(result.error);return reply(result.data);
    }
    if (request.method === "DELETE") {
      if (!hasAdminPrivilege(user,"documents.delete")) return reply({error:"Document deletion permission is required."},403);
      if (typeof body.id === "string" && /^legacy:documents\/[a-zA-Z0-9_.-]+$/.test(body.id)) {
        const result = await service.storage.from("coop-admin-resources").remove([body.id.slice("legacy:".length)]);
        if (result.error) throw new DocumentServiceError("The staff document could not be deleted. Refresh and retry.",503);
        const audit = await service.from("admin_activity_logs").insert({actor_id:user.id,action_name:"delete-staff-document",target_id:body.id,result:"success",details:{}});
        return reply({success:true,warning:audit.error ? "The file was deleted, but its audit event could not be saved." : null});
      }
      if (!uuid(body.id) || typeof body.updatedAt !== "string" || !Number.isFinite(Date.parse(body.updatedAt))) throw new DocumentServiceError("Refresh the shared document before deleting.");
      const result = await session.rpc("delete_shared_document",{p_id:body.id,p_expected_updated_at:body.updatedAt});
      checkDocumentError(result.error);
      // Soft deletion immediately removes member access while retaining the file for audit.
      return reply({success:true});
    }
    return reply({error:"Unsupported document operation."},405);
  } catch (error) {
    if(error instanceof CommitteeError)return reply({error:error.message},error.status);
    if (error instanceof DocumentServiceError) return reply({error:error.message},error.status);
    if (error instanceof Error && /^(Choose|Select|Enter|The (replacement reason|description))/.test(error.message)) return reply({error:error.message},400);
    return reply({error:"The document service is temporarily unavailable. Refresh and retry."},503);
  }
}
