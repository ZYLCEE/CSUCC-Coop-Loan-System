import { createClient, type User } from "@supabase/supabase-js";
import { isActiveAdministrator } from "@/lib/adminPrivileges";
import { emailChangeFailure, validateEmailChange, validatePasswordChange, validateProfile } from "@/lib/profileModel";

const reply = (body: object, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const fail = (error: string, status = 400) => reply({ error }, status);
const text = (value: unknown) => typeof value === "string" ? value : "";

export async function GET(request: Request) { return handle(request); }
export async function PUT(request: Request) { return handle(request); }
export async function POST(request: Request) { return handle(request); }
export async function PATCH(request: Request) { return handle(request); }

async function handle(request: Request) {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return fail("Server-side profile configuration is missing.", 503);
    const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const token = request.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
    if (!token) return fail("Sign in to manage your profile.", 401);
    const { data: { user }, error } = await client.auth.getUser(token);
    if (error || !user) return fail("Your session expired. Sign in again.", 401);
    if (!isActiveAdministrator(user)) return fail("An active administrator account is required.", 403);
    const audit = async (action: string, details: object) => {
      try {
        const result = await client.from("admin_activity_logs").insert({ actor_id: user.id, action_name: action, target_id: user.id, result: "success", details });
        return result.error ? "Your changes were saved, but the activity log is unavailable." : null;
      } catch { return "Your changes were saved, but the activity log is unavailable."; }
    };

    if (request.method === "POST" || request.method === "PATCH") {
      const changingEmail = request.method === "PATCH";
      if (changingEmail && user.app_metadata.role !== "super_admin") return fail("Only Super Admin can change their sign-in email here.", 403);
      const raw = await request.text();
      if (raw.length > 6000) return fail("Account update request is too large.");
      const body = JSON.parse(raw);
      const emailChange = changingEmail ? validateEmailChange(body) : null;
      const passwords = changingEmail ? null : validatePasswordChange(body);
      if (emailChange && emailChange.email === user.email?.toLowerCase()) return fail("Enter an email address different from your current sign-in email.");
      if (!user.email) return fail("Password verification is unavailable for this account.", 403);
      const publicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (!publicKey) return fail("Password verification is not configured.", 503);
      // Isolated, short-lived Auth session: never replace the browser's active session.
      const verifier = createClient(url, publicKey, { auth: { persistSession: false, autoRefreshToken: false } });
      const verified = await verifier.auth.signInWithPassword({ email: user.email, password: emailChange?.current ?? passwords!.current });
      if (verified.error || verified.data.user?.id !== user.id) {
        if (verified.data.session) await verifier.auth.signOut({ scope: "local" });
        return fail(verified.error?.status === 429 ? "Too many attempts. Wait before retrying." : "Current password could not be verified.", verified.error?.status === 429 ? 429 : 401);
      }
      try {
        const latest = await client.auth.getUser(token);
        if (latest.error || !isActiveAdministrator(latest.data.user)) return fail("Your account is no longer authorized.", 403);
        if (emailChange) {
          if (latest.data.user?.app_metadata.role !== "super_admin") return fail("Super Admin access is no longer available.", 403);
          if (latest.data.user.email !== user.email) return fail("Your sign-in email changed. Reload your profile and try again.", 409);
          // Use the normal Auth email-change flow so configured email confirmation remains enforced.
          const changed = await verifier.auth.updateUser({ email: emailChange.email });
          if (changed.error || !changed.data.user) {
            const failure = emailChangeFailure(changed.error);
            return reply({ error: failure.error, code: failure.code }, failure.status);
          }
          const applied = changed.data.user.email?.toLowerCase() === emailChange.email;
          return reply({ success: true, email: changed.data.user.email ?? user.email,
            pendingEmail: applied ? null : emailChange.email, confirmationRequired: !applied,
            warning: await audit(applied ? "change-own-email" : "request-own-email-change", {}) });
        }
        const updated = await verifier.auth.updateUser({ password: passwords!.next, current_password: passwords!.current });
        if (updated.error) return fail(updated.error.code === "same_password" ? "Choose a password different from the current password." : "Password could not be updated. Check the password requirements and retry.");
      } finally { await verifier.auth.signOut({ scope: "local" }).catch(() => {}); }
      return reply({ success: true, warning: await audit("change-own-password", {}) });
    }

    const linked = await client.from("members").select("id,first_name,last_name,phone,department").eq("user_id", user.id).maybeSingle();
    if (linked.error) return fail("Unable to load your linked profile. Retry or contact your system administrator.", 503);
    if (request.method === "GET") {
      const member = linked.data;
      const metadata = user.user_metadata;
      const activity = await client.from("admin_activity_logs").select("id,action_name,result,created_at").eq("actor_id", user.id).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(10);
      return reply({ profile: {
        first_name: text(member?.first_name ?? metadata.first_name), last_name: text(member?.last_name ?? metadata.last_name),
        phone: text(member?.phone ?? metadata.phone), department: text(member?.department ?? metadata.department), position: text(metadata.position),
      }, account: accountInfo(user), memberLinked: !!member, activity: activity.error ? [] : activity.data, activityUnavailable: !!activity.error });
    }

    const raw = await request.text();
    if (raw.length > 6000) return fail("Profile request is too large.");
    const profile = validateProfile(JSON.parse(raw));
    if (linked.data) {
      const memberFields = { first_name: profile.first_name, last_name: profile.last_name, phone: profile.phone, department: profile.department };
      const result = await client.from("members").update(memberFields).eq("id", linked.data.id).eq("user_id", user.id).select("id").single();
      if (result.error || !result.data) return fail("Your profile could not be saved. Retry.", 503);
    }
    const updated = await client.auth.admin.updateUserById(user.id, { user_metadata: {
      ...user.user_metadata, ...profile, full_name: `${profile.first_name} ${profile.last_name}`,
    } });
    if (updated.error) return fail(linked.data ? "Your linked profile was saved, but account details could not be synchronized. Retry Save Changes to finish." : "Your profile could not be saved. Retry.", 503);
    return reply({ success: true, profile, warning: await audit("update-own-profile", { fields: Object.keys(profile) }) });
  } catch (error) {
    if (error instanceof SyntaxError) return fail("Invalid request. Reload the page and retry.");
    return fail(error instanceof Error ? error.message : "Unable to process this profile request.");
  }
}

function accountInfo(user: User) {
  return { id: user.id, email: user.email ?? "", role: user.app_metadata.role === "super_admin" ? "Super Administrator" : "Administrator",
    pendingEmail: user.new_email || null, status: "Active", createdAt: user.created_at, lastSignInAt: user.last_sign_in_at ?? null, emailConfirmed: !!user.email_confirmed_at };
}
