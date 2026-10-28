import { getSupabaseClient } from "@/lib/supabase";
import { getAdminRole } from "@/lib/auth/roles";
import { contentLimit, titleLimit, type Announcement, type AnnouncementCategory, type AnnouncementFilter, type AnnouncementStatus } from "@/components/announcements/AnnouncementsData";

const columns = "id,title,content,category_id,status,created_at,updated_at,published_at,scheduled_at,author_name,notify_members,category:announcement_categories(id,name)";
export const announcementPageSize = 10;
export type AnnouncementAction = "save" | "archive" | "restore" | "cancel_schedule" | "delete";
export interface AnnouncementPayload {
  title: string; content: string; category_id: string;
  status: Exclude<AnnouncementStatus, "archived">; scheduled_at: string | null; notify_members: boolean;
}
async function announcementClient(userId: string, write = false) {
  const client = getSupabaseClient();
  const { data, error } = await client.auth.getSession();
  const user = data.session?.user;
  const role = getAdminRole(user ?? null);
  if (error || !user || user.id !== userId || !role || (write && role !== "super_admin") ||
    (user.app_metadata.account_status && user.app_metadata.account_status !== "active")) {
    throw new Error(write ? "An active Super Admin account is required to manage announcements." : "Sign in with an active administrator account to view announcements.");
  }
  return client;
}
const validDate = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value));
export function parseAnnouncement(value: unknown): Announcement {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("The announcement service returned an unsupported record.");
  const row = value as Record<string, unknown>;
  const category = row.category as Record<string, unknown> | null;
  if (typeof row.id !== "string" || !row.id || typeof row.title !== "string" || typeof row.content !== "string" ||
    typeof row.category_id !== "string" || !category || typeof category.name !== "string" || category.id !== row.category_id ||
    !["published", "scheduled", "draft", "archived"].includes(String(row.status)) || !validDate(row.created_at) || !validDate(row.updated_at) ||
    (row.published_at !== null && !validDate(row.published_at)) || (row.scheduled_at !== null && !validDate(row.scheduled_at)) ||
    (row.status === "published" && !validDate(row.published_at)) || (row.status === "scheduled" && !validDate(row.scheduled_at)) ||
    (row.author_name !== null && typeof row.author_name !== "string") || typeof row.notify_members !== "boolean") {
    throw new Error("The announcement service returned an unsupported record. Refresh and retry.");
  }
  return { id: row.id, title: row.title, content: row.content, categoryId: row.category_id,
    category: category.name, status: row.status as AnnouncementStatus, createdAt: row.created_at,
    updatedAt: row.updated_at, publishedAt: row.published_at as string | null,
    scheduledAt: row.scheduled_at as string | null, author: row.author_name as string | null, notifyMembers: row.notify_members };
}
export async function fetchAnnouncements(userId: string, filter: AnnouncementFilter, search = "", offset = 0) {
  const client = await announcementClient(userId);
  let query = client.from("announcements").select(columns, { count: "exact" });
  if (filter !== "all") query = query.eq("status", filter);
  const term = search.trim().slice(0, 160);
  if (term) {
    const literal = term.replace(/[\\%_]/g, (character) => `\\${character}`);
    const pattern = `%${literal}%`.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    query = query.or(`title.ilike."${pattern}",content.ilike."${pattern}"`);
  }
  const { data, count, error } = await query.order("created_at", { ascending: false }).order("id", { ascending: false }).range(offset, offset + announcementPageSize - 1);
  if (error || !Array.isArray(data) || count === null || !Number.isSafeInteger(count) || count < 0) {
    throw new Error("Announcements could not be loaded. Check your connection or ask your system administrator to enable the announcements service.");
  }
  return { items: data.map(parseAnnouncement), total: count };
}
export async function fetchAnnouncementCategories(userId: string): Promise<AnnouncementCategory[]> {
  const client = await announcementClient(userId);
  const { data, error } = await client.from("announcement_categories").select("id,name").order("sort_order");
  if (error || !Array.isArray(data) || data.length === 0 || data.some((row) => typeof row.id !== "string" || typeof row.name !== "string")) {
    throw new Error("Announcement categories are unavailable. Ask your system administrator to enable the announcements service.");
  }
  return data.map((row) => ({ id: row.id as string, name: row.name as string }));
}
export async function fetchAnnouncementSetup(userId: string) {
  const client = await announcementClient(userId);
  const [categories, result] = await Promise.all([fetchAnnouncementCategories(userId), client.rpc("announcement_service_status")]);
  if (result.error || typeof result.data?.scheduling_enabled !== "boolean" || typeof result.data?.notifications_enabled !== "boolean") {
    throw new Error("Announcement publishing options are unavailable. Refresh or ask your system administrator to enable the service.");
  }
  return { categories, schedulingEnabled: result.data.scheduling_enabled as boolean, notificationsEnabled: result.data.notifications_enabled as boolean };
}
export async function manageAnnouncement(userId: string, action: AnnouncementAction, id: string, expectedUpdatedAt: string | null, payload?: AnnouncementPayload) {
  const client = await announcementClient(userId, true);
  if (action === "save" && (!payload || !payload.title.trim() || payload.title.length > titleLimit || payload.content.length > contentLimit ||
    (payload.status !== "draft" && !payload.content.trim()) || (payload.status === "scheduled" && (!payload.scheduled_at || !Number.isFinite(Date.parse(payload.scheduled_at)) || Date.parse(payload.scheduled_at) <= Date.now())))) {
    throw new Error("Check the announcement title, content and future schedule before saving.");
  }
  const { data, error } = await client.rpc("manage_announcement", { p_action: action, p_id: id, p_expected_updated_at: expectedUpdatedAt, p_payload: payload ?? {} });
  if (error || !data || data.id !== id || data.success !== true) {
    if (error?.code === "40001") throw new Error("This announcement changed since you opened it. Close this panel, refresh the list and try again.");
    if (error?.code === "55000") throw new Error("Scheduled publication is not enabled. Ask your system administrator to configure the scheduler, or save this as a draft.");
    throw new Error("The announcement could not be saved. Your changes remain here. Check your connection and announcement service permissions, then retry.");
  }
  return data as { id: string; success: true };
}
