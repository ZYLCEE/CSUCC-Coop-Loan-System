import { createClient } from "@supabase/supabase-js";
import { isActiveAdministrator } from "@/lib/adminPrivileges";

const reply = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const token = request.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
    if (!url || !serviceKey) return reply({ error: "Server-side ID reservation is not configured." }, 503);
    if (!token) return reply({ error: "Sign in again to reserve an account ID." }, 401);

    const body = await request.json().catch(() => null) as { requestId?: unknown } | null;
    if (!body || typeof body.requestId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.requestId)) {
      return reply({ error: "Reopen the account form and retry the ID reservation." }, 400);
    }

    const service = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: { user }, error: authError } = await service.auth.getUser(token);
    if (authError || !user) return reply({ error: "Your session expired. Sign in again." }, 401);
    if (!isActiveAdministrator(user) || user.app_metadata.role !== "super_admin") {
      return reply({ error: "Super Admin access is required to create member accounts." }, 403);
    }

    const { data, error } = await service.rpc("reserve_member_account_number", {
      p_request_id: body.requestId,
      p_actor_id: user.id,
    });
    if (error) {
      console.error("Member account ID reservation failed:", error.message);
      const migrationMissing = error.code === "PGRST202" || error.code === "42883";
      return reply({ error: migrationMissing
        ? "The shared ID migration is not available in this Supabase project yet. Refresh the database schema and try again."
        : "The next permanent account ID could not be reserved. Refresh and retry." }, migrationMissing ? 503 : 500);
    }
    const accountNumber = (data as { accountNumber?: unknown } | null)?.accountNumber;
    if (typeof accountNumber !== "string" || !/^CSUCC-2026-\d{4,}$/.test(accountNumber)) {
      return reply({ error: "The ID service returned an invalid reservation. Refresh and retry." }, 502);
    }
    return reply({ accountNumber });
  } catch {
    return reply({ error: "The account ID could not be reserved. Refresh the page and retry." }, 500);
  }
}
