import { createClient } from "@supabase/supabase-js";
import { isActiveAdministrator } from "@/lib/adminPrivileges";

const reply = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const token = request.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
    if (!url || !serviceKey) return reply({ error: "Account ID preview is unavailable." }, 503);
    if (!token) return reply({ error: "Sign in again to view the next account ID." }, 401);

    const service = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: { user }, error: authError } = await service.auth.getUser(token);
    if (authError || !user) return reply({ error: "Your session expired. Sign in again." }, 401);
    if (!isActiveAdministrator(user) || user.app_metadata.role !== "super_admin") {
      return reply({ error: "Super Admin access is required to create member accounts." }, 403);
    }

    const { data, error } = await service.rpc("preview_shared_account_number", { p_actor_id: user.id });
    if (error) {
      console.error("Shared account ID preview failed:", error.message);
      const migrationMissing = error.code === "PGRST202" || error.code === "42883";
      return reply({ error: migrationMissing
        ? "The shared account ID service is not available yet. Refresh the database schema and try again."
        : "The next account ID could not be loaded. Retry." }, migrationMissing ? 503 : 500);
    }
    const accountNumber = (data as { accountNumber?: unknown } | null)?.accountNumber;
    if (typeof accountNumber !== "string" || !/^CSUCC-2026-\d{4,}$/.test(accountNumber)) {
      return reply({ error: "The account ID service returned an invalid preview. Retry." }, 502);
    }
    return reply({ accountNumber });
  } catch {
    return reply({ error: "The next account ID could not be loaded. Refresh and retry." }, 500);
  }
}
