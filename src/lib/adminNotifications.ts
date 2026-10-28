import { getSupabaseClient } from "@/lib/supabase";
import { getAdminRole } from "@/lib/auth/roles";

export interface AdminNotification {
  id: string;
  userId: string;
  title: string;
  message: string;
  type: string;
  read: boolean;
  createdAt: string;
}

export type NotificationFilter = "all" | "unread" | "read";
export type NotificationCategory = "all" | "loans" | "payments";
export interface NotificationQuery {
  filter: NotificationFilter;
  search: string;
  category: NotificationCategory;
}
export const recentNotificationQuery: NotificationQuery = { filter: "all", search: "", category: "all" };
export const notificationCategoryOptions = [
  { value: "all", label: "All categories" },
  { value: "loans", label: "Loan Applications" },
  { value: "payments", label: "Payments" },
] as const;
export const notificationPageSize = 20;

async function recipientClient(userId: string) {
  const client = getSupabaseClient();
  const { data, error } = await client.auth.getSession();
  const status = data.session?.user.app_metadata.account_status;
  if (error || !data.session || data.session.user.id !== userId || !getAdminRole(data.session.user) || (status && status !== "active")) {
    throw new Error("Your administrator session is unavailable. Sign in again to view notifications.");
  }
  return client;
}

function validCount(value: number | null): value is number {
  return value !== null && Number.isSafeInteger(value) && value >= 0;
}

function parseNotification(value: unknown, userId: string): AdminNotification {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The notification service returned an unsupported record.");
  }
  const row = value as Record<string, unknown>;
  if (row.user_id !== userId || typeof row.id !== "string" || !row.id ||
    typeof row.title !== "string" || typeof row.message !== "string" ||
    typeof row.type !== "string" || typeof row.read !== "boolean" ||
    typeof row.created_at !== "string" || !Number.isFinite(Date.parse(row.created_at))) {
    throw new Error("The notification service returned an unsupported record.");
  }
  return { id: row.id, userId, title: row.title, message: row.message,
    type: row.type, read: row.read, createdAt: row.created_at };
}

export async function fetchUnreadNotificationCount(userId: string): Promise<number> {
  const client = await recipientClient(userId);
  const { count, error } = await client.from("notifications")
    .select("id", { count: "exact", head: true }).eq("user_id", userId).eq("read", false);
  if (error || !validCount(count)) throw new Error("Unable to load your unread notification count. Please retry.");
  return count;
}

export async function fetchAdminNotifications(userId: string, filter: NotificationFilter, offset = 0, limit = notificationPageSize,
  options: { search?: string; category?: NotificationCategory } = {}) {
  const client = await recipientClient(userId);
  let query = client.from("notifications")
    .select("id,user_id,title,message,type,read,created_at", { count: "exact" })
    .eq("user_id", userId);
  if (filter === "unread") query = query.eq("read", false);
  if (filter === "read") query = query.eq("read", true);
  if (options.category === "loans") query = query.in("type", ["loan_approval", "loan_rejection"]);
  if (options.category === "payments") query = query.eq("type", "payment_reminder");
  const search = options.search?.trim().slice(0, 160);
  if (search) {
    // Quote raw PostgREST values as well as escaping SQL LIKE wildcards.
    const literal = search.replace(/[\\%_]/g, (character) => `\\${character}`);
    const pattern = `%${literal}%`.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    query = query.or(`title.ilike."${pattern}",message.ilike."${pattern}"`);
  }
  const { data, count, error } = await query.order("created_at", { ascending: false })
    .order("id", { ascending: false }).range(offset, offset + limit - 1);
  if (error || !validCount(count) || !Array.isArray(data)) {
    throw new Error("Unable to load your notifications. Check your connection and retry.");
  }
  return { items: (data as unknown[]).map((row) => parseNotification(row, userId)), total: count };
}

export async function markAdminNotificationRead(userId: string, id: string): Promise<void> {
  const client = await recipientClient(userId);
  const { data, error } = await client.from("notifications").update({ read: true })
    .eq("user_id", userId).eq("id", id).eq("read", false).select("id,user_id,read");
  if (error) throw new Error("Unable to mark this notification as read. Please retry.");
  if (Array.isArray(data) && data.some((row) => row.id === id && row.user_id === userId && row.read === true)) return;
  // A second device may already have read it. Verify that instead of assuming an update succeeded.
  const result = await client.from("notifications").select("id,user_id,read")
    .eq("user_id", userId).eq("id", id).maybeSingle();
  if (result.error || result.data?.id !== id || result.data?.user_id !== userId || result.data?.read !== true) {
    throw new Error("This notification could not be marked as read. Refresh the list and retry.");
  }
}

export async function markAllAdminNotificationsRead(userId: string): Promise<void> {
  const client = await recipientClient(userId);
  const { count, error } = await client.from("notifications").update({ read: true }, { count: "exact" })
    .eq("user_id", userId).eq("read", false);
  if (error || !validCount(count)) throw new Error("Unable to mark all notifications as read. Please retry.");
  if (count === 0 && await fetchUnreadNotificationCount(userId) > 0) {
    throw new Error("Your notifications could not be updated. Refresh the list and retry.");
  }
}

export function notificationHref(type: string, prefix: string): string | null {
  if (type === "loan_approval" || type === "loan_rejection") return `${prefix}/loan-applications`;
  if (type === "payment_reminder") return `${prefix}/active-loans`;
  return null;
}

export function notificationRelativeTime(createdAt: string, now = Date.now()): string {
  const seconds = (Date.parse(createdAt) - now) / 1000;
  if (!Number.isFinite(seconds)) return "Time unavailable";
  if (Math.abs(seconds) < 60) return "Just now";
  const units = [[31536000, "year"], [2592000, "month"], [86400, "day"], [3600, "hour"], [60, "minute"]] as const;
  const [size, unit] = units.find(([size]) => Math.abs(seconds) >= size) ?? units[units.length - 1];
  return new Intl.RelativeTimeFormat("en", { numeric: "auto" }).format(Math.trunc(seconds / size), unit);
}
