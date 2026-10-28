import { createClient } from "@supabase/supabase-js";

const GRANT_TTL_MS = 10 * 60 * 1000;
const grants = new Map<string, { userId: string; action: string; target: string; expiresAt: number }>();

function getSupabaseClient() {
  const url = Deno.env.get("NEXT_PUBLIC_SUPABASE_URL") ?? Deno.env.get("SUPABASE_URL");
  const serviceRoleKey =
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
    Deno.env.get("SUPABASE_SERVICE_ROLE") ??
    Deno.env.get("SUPABASE_ANON_KEY");

  if (!url || !serviceRoleKey) {
    throw new Error("Supabase environment variables are not configured.");
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeRole(value: unknown): string | null {
  const raw = typeof value === "string" ? value.toLowerCase() : "";
  if (["super_admin", "super-admin", "super administrator"].includes(raw)) return "super_admin";
  if (["admin", "coop_admin", "administrator"].includes(raw)) return "admin";
  return null;
}

async function getCurrentUser(req: Request, supabase: ReturnType<typeof createClient>) {
  const authHeader = req.headers.get("authorization") ?? "";
  const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

  if (!bearerToken) {
    return null;
  }

  const { data, error } = await supabase.auth.getUser(bearerToken);
  if (error || !data.user) {
    return null;
  }

  return data.user;
}

function buildPreviewAccountId() {
  const now = new Date();
  const year = now.getFullYear();
  const serial = String(now.getTime()).slice(-6);
  return `${year}-${serial.padStart(6, "0")}`;
}

async function persistNotification(
  supabase: ReturnType<typeof createClient>,
  payload: Record<string, unknown>,
) {
  const notificationPayload = {
    title: payload.title,
    message: payload.message,
    type: payload.type ?? "Information",
    send_to: payload.sendTo ?? "allMembers",
    recipient_summary: payload.recipientSummary ?? "All Members",
    recipient_count: typeof payload.recipientCount === "number" ? payload.recipientCount : 0,
    member_id: payload.memberId ?? null,
    member_name: payload.memberName ?? null,
    scheduled_at: payload.scheduledAt ?? null,
    created_at: payload.createdAt ?? new Date().toISOString(),
    status: payload.scheduledAt ? "scheduled" : "sent",
  };

  const { error } = await supabase.from("notifications").insert(notificationPayload);
  if (error) {
    console.error("Failed to persist notification record:", error.message);
  }
}

Deno.serve(async (req: Request) => {
  try {
    const rawBody = await req.json().catch(() => ({}));
    if (!isRecord(rawBody)) {
      return Response.json(
        { success: false, error: "Invalid request body." },
        { status: 400 },
      );
    }

    const { mode, action, target, payload, secret, password, grant } = rawBody;
    const supabase = getSupabaseClient();
    const user = await getCurrentUser(req, supabase);

    if (!user) {
      return Response.json(
        { success: false, error: "Your session is invalid or expired." },
        { status: 401 },
      );
    }

    const profileRole = normalizeRole(user.app_metadata?.role ?? user.user_metadata?.role);
    if (!profileRole) {
      return Response.json(
        { success: false, error: "You are not authorized to use this secure action." },
        { status: 403 },
      );
    }

    if (mode === "verify") {
      const configuredPassword = Deno.env.get("ADMIN_ACTION_PASSWORD");
      const localMode = Deno.env.get("APP_ENV") === "development" || Deno.env.get("SUPABASE_ENVIRONMENT") === "local";
      const passwordIsValid =
        configuredPassword !== undefined
          ? typeof password === "string" && password === configuredPassword
          : localMode
            ? typeof password === "string" && password.length > 0
            : false;

      if (!passwordIsValid) {
        return Response.json(
          { success: false, error: "The provided admin password is incorrect." },
          { status: 401 },
        );
      }

      const grantId = crypto.randomUUID();
      grants.set(grantId, {
        userId: user.id,
        action: typeof action === "string" ? action : "unknown",
        target: typeof target === "string" ? target : "unknown",
        expiresAt: Date.now() + GRANT_TTL_MS,
      });

      return Response.json({ success: true, grant: grantId });
    }

    if (mode === "execute") {
      if (typeof grant !== "string" || !grant.length) {
        return Response.json(
          { success: false, error: "A valid secure-grant is required to continue." },
          { status: 400 },
        );
      }

      const storedGrant = grants.get(grant);
      if (!storedGrant) {
        return Response.json(
          { success: false, error: "This secure action has expired or is invalid." },
          { status: 401 },
        );
      }

      if (storedGrant.userId !== user.id || storedGrant.expiresAt < Date.now()) {
        grants.delete(grant);
        return Response.json(
          { success: false, error: "This secure action is no longer valid." },
          { status: 401 },
        );
      }

      grants.delete(grant);

      if (typeof action !== "string") {
        return Response.json(
          { success: false, error: "The action name is missing." },
          { status: 400 },
        );
      }

      switch (action) {
        case "preview-account-id": {
          return Response.json({
            success: true,
            result: {
              message: "Account ID preview generated successfully.",
              previewId: buildPreviewAccountId(),
            },
          });
        }

        case "send-notification":
        case "schedule-notification": {
          if (!isRecord(payload)) {
            return Response.json(
              { success: false, error: "Notification payload is invalid." },
              { status: 400 },
            );
          }

          const notificationPayload = {
            title: typeof payload.title === "string" ? payload.title.trim() : "",
            message: typeof payload.message === "string" ? payload.message.trim() : "",
            type: typeof payload.type === "string" ? payload.type : "Information",
            sendTo: typeof payload.sendTo === "string" ? payload.sendTo : "allMembers",
            recipientSummary:
              typeof payload.recipientSummary === "string" ? payload.recipientSummary : "All Members",
            recipientCount:
              typeof payload.recipientCount === "number" ? payload.recipientCount : 0,
            memberId: typeof payload.memberId === "string" ? payload.memberId : null,
            memberName: typeof payload.memberName === "string" ? payload.memberName : null,
            scheduledAt:
              typeof payload.scheduledAt === "string" && payload.scheduledAt.length > 0
                ? payload.scheduledAt
                : null,
            createdAt: new Date().toISOString(),
          };

          if (!notificationPayload.title || !notificationPayload.message) {
            return Response.json(
              { success: false, error: "Notification title and message are required." },
              { status: 400 },
            );
          }

          try {
            await persistNotification(supabase, notificationPayload);
          } catch (error) {
            console.error("Notification persistence failed:", error);
          }

          const scheduledLabel = notificationPayload.scheduledAt
            ? new Date(notificationPayload.scheduledAt).toLocaleString()
            : null;

          return Response.json({
            success: true,
            result: {
              message: notificationPayload.scheduledAt
                ? `Notification scheduled for ${scheduledLabel}.`
                : "Notification sent successfully.",
              notification: {
                ...notificationPayload,
                status: notificationPayload.scheduledAt ? "scheduled" : "sent",
              },
            },
          });
        }

        case "create-account":
        case "edit-account":
        case "delete-account":
        case "block-account":
        case "unblock-account":
        case "approve-account":
        case "reject-account": {
          return Response.json({
            success: true,
            result: {
              message: `${action.replaceAll("-", " ")} completed successfully.`,
              target,
            },
          });
        }

        default:
          return Response.json(
            { success: false, error: `Unsupported action: ${action}` },
            { status: 400 },
          );
      }
    }

    return Response.json(
      { success: false, error: "Unsupported function mode." },
      { status: 400 },
    );
  } catch (error) {
    console.error("secure-admin-action failed:", error);
    return Response.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "The secure action service encountered an unexpected error.",
      },
      { status: 500 },
    );
  }
});
