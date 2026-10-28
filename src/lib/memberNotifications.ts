import { getSupabaseClient } from "@/lib/supabase";
import { getAdminRole } from "@/lib/auth/roles";

export type OutgoingStatus = "all" | "sent" | "scheduled" | "failed";
export interface OutgoingNotification {
  id: string;
  title: string;
  message: string;
  type: string;
  recipient: string;
  recipientCount: number;
  status: Exclude<OutgoingStatus, "all">;
  createdAt: string;
  scheduledAt: string | null;
}

export async function fetchOutgoingNotifications(userId: string, status: OutgoingStatus, search = "", offset = 0) {
  const client = getSupabaseClient();
  const { data: sessionData, error: sessionError } = await client.auth.getSession();
  const user = sessionData.session?.user;
  if (sessionError || !user || user.id !== userId || getAdminRole(user) !== "super_admin" ||
    (user.app_metadata.account_status && user.app_metadata.account_status !== "active")) {
    throw new Error("Outgoing notification history is available only to authorized Super Admin accounts.");
  }
  // These are the outgoing fields already used by the legacy protected sender.
  // Never substitute recipient inbox rows for a missing outgoing delivery ledger.
  let query = client.from("notifications")
    .select("id,user_id,title,message,type,send_to,recipient_summary,recipient_count,status,created_at,scheduled_at", { count: "exact" })
    .is("user_id", null).not("send_to", "is", null);
  if (status !== "all") query = query.eq("status", status);
  if (search.trim()) query = query.ilike("title", `%${search.trim().slice(0, 160).replace(/[\\%_]/g, (character) => `\\${character}`)}%`);
  const { data, count, error } = await query.order("created_at", { ascending: false })
    .order("id", { ascending: false }).range(offset, offset + 19);
  if (error || !Array.isArray(data) || count === null || !Number.isSafeInteger(count) || count < 0) {
    throw new Error("Outgoing delivery history is unavailable. The notification service must provide recorded recipient, schedule, and delivery statuses. Your incoming alerts remain separate in the top bell.");
  }
  const rows: OutgoingNotification[] = (data as unknown[]).map((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Outgoing history has an unsupported format.");
    const row = value as Record<string, unknown>;
    if (row.user_id !== null || typeof row.id !== "string" || typeof row.title !== "string" ||
      typeof row.message !== "string" || typeof row.type !== "string" || typeof row.send_to !== "string" || !row.send_to ||
      typeof row.recipient_summary !== "string" || typeof row.recipient_count !== "number" ||
      !Number.isSafeInteger(row.recipient_count) || row.recipient_count < 0 ||
      (row.status !== "sent" && row.status !== "scheduled" && row.status !== "failed") ||
      typeof row.created_at !== "string" || !Number.isFinite(Date.parse(row.created_at)) ||
      (row.scheduled_at !== null && (typeof row.scheduled_at !== "string" || !Number.isFinite(Date.parse(row.scheduled_at))))) {
      throw new Error("Outgoing history has an unsupported format. Delivery status cannot be confirmed.");
    }
    return { id: row.id, title: row.title, message: row.message, type: row.type,
      recipient: row.recipient_summary, recipientCount: row.recipient_count,
      status: row.status, createdAt: row.created_at, scheduledAt: row.scheduled_at };
  });
  return { items: rows, total: count };
}
