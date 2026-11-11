import {portalActivityHeaders} from "@/lib/portalActivityServer";
import { createClient } from "@supabase/supabase-js";
import { assignedPrivileges, isActiveAdministrator, validatePrivileges } from "@/lib/adminPrivileges";

const reply = (body: object, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const fail = (error: string, status = 400) => reply({ error }, status);

export async function GET(request: Request) { return handle(request); }
export async function PUT(request: Request) { return handle(request); }

async function handle(request: Request) {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return fail("Server-side account configuration is missing.", 503);
    const client = createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false},global:{headers:portalActivityHeaders(request)}});
    const token = request.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
    if (!token) return fail("Sign in to continue.", 401);
    const { data: { user }, error } = await client.auth.getUser(token);
    if (error || !user) return fail("Your session expired. Sign in again.", 401);
    if (!isActiveAdministrator(user) || user.app_metadata.role !== "super_admin") return fail("Only Super Admin can assign admin privileges.", 403);

    if (request.method === "GET") {
      const accounts = [];
      for (let page = 1; ; page++) {
        const { data, error } = await client.auth.admin.listUsers({ page, perPage: 1000 });
        if (error) return fail("Unable to load admin accounts. Retry.", 503);
        accounts.push(...data.users.filter(account => ["admin", "coop_admin"].includes(account.app_metadata.role)).map(account => ({
          id: account.id, email: account.email ?? "", name: typeof account.user_metadata.full_name === "string" ? account.user_metadata.full_name : account.email ?? "Admin",
          active: isActiveAdministrator(account), privileges: assignedPrivileges(account), version: account.app_metadata.admin_privileges_version ?? null,
        })));
        if (data.users.length < 1000) break;
      }
      return reply({ accounts: accounts.sort((a, b) => a.name.localeCompare(b.name)) });
    }

    const raw = await request.text();
    if (raw.length > 8000) return fail("Permission request is too large.");
    const body = JSON.parse(raw);
    if (!body || typeof body !== "object" || typeof body.userId !== "string" || !/^[0-9a-f-]{36}$/i.test(body.userId) ||
      !validatePrivileges(body.privileges) || typeof body.password !== "string" || !body.password || body.password.length > 1024 ||
      !(body.version === null || typeof body.version === "string")) return fail("Select an admin, valid privileges and enter your account password.");

    const { data: targetData, error: targetError } = await client.auth.admin.getUserById(body.userId);
    const target = targetData.user;
    if (targetError || !target) return fail("Admin account was not found.", 404);
    if (!["admin", "coop_admin"].includes(target.app_metadata.role) || !isActiveAdministrator(target)) return fail("Privileges can only be assigned to active Admin accounts.", 403);
    if ((target.app_metadata.admin_privileges_version ?? null) !== body.version) return fail("This admin's privileges changed. Reload and review them before saving.", 409);
    if (!user.email) return fail("Account password verification is unavailable.", 403);
    const verifier = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? key, { auth: { persistSession: false, autoRefreshToken: false } });
    const verified = await verifier.auth.signInWithPassword({ email: user.email, password: body.password });
    if (verified.error || verified.data.user?.id !== user.id) return fail(verified.error?.status === 429 ? "Too many attempts. Wait and retry." : "Your account password could not be verified.", verified.error?.status === 429 ? 429 : 401);
    await verifier.auth.signOut({ scope: "local" });
    // Re-read after verification so role/status changes during the password prompt are respected.
    const latest = await client.auth.admin.getUserById(target.id);
    if (latest.error || !latest.data.user) return fail("Admin account is unavailable.", 404);
    if (!["admin", "coop_admin"].includes(latest.data.user.app_metadata.role) || !isActiveAdministrator(latest.data.user)) return fail("This account is no longer an active Admin.", 403);
    if ((latest.data.user.app_metadata.admin_privileges_version ?? null) !== body.version) return fail("Privileges changed. Reload and review before saving.", 409);
    const actor = await client.auth.getUser(token);
    if (actor.error || !isActiveAdministrator(actor.data.user) || actor.data.user?.app_metadata.role !== "super_admin") return fail("Super Admin access is no longer available.", 403);
    const version = crypto.randomUUID();
    const updated = await client.auth.admin.updateUserById(target.id, { app_metadata: {
      ...latest.data.user.app_metadata, admin_privileges: body.privileges, admin_privileges_version: version,
      admin_privileges_updated_by: user.id, admin_privileges_updated_at: new Date().toISOString(),
    } });
    if (updated.error) return fail("Privileges could not be saved. Reload and retry.", 503);
    const audit = await client.from("admin_activity_logs").insert({ actor_id: user.id, action_name: "update-admin-privileges", target_id: target.id, result: "success",
      details: { before: assignedPrivileges(latest.data.user), after: body.privileges, version } });
    return reply({ success: true, version, warning: audit.error ? "Privileges were saved, but the audit log could not be written." : null });
  } catch { return fail("Unable to process this permission request. Reload and retry."); }
}
