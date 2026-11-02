export const adminPrivileges = [
  { key: "documents.upload", label: "Upload documents", description: "Upload cooperative documents to the document library." },
  { key: "documents.delete", label: "Delete documents", description: "Delete cooperative uploads. Loan attachments stay protected." },
  { key: "notifications.send", label: "Send member notifications", description: "Send messages to members after account-password verification." },
  { key: "settings.manage", label: "Edit general settings", description: "Change the cooperative name, document size limit and allowed file types." },
] as const;

export type AdminPrivilege = typeof adminPrivileges[number]["key"];
type PrivilegeUser = { app_metadata?: Record<string, unknown>; banned_until?: string | null } | null;

export function isActiveAdministrator(user: PrivilegeUser): boolean {
  const metadata = user?.app_metadata;
  return !!metadata && ["admin", "coop_admin", "super_admin"].includes(String(metadata.role)) &&
    (!metadata.account_status || metadata.account_status === "active") &&
    (!user?.banned_until || Date.parse(user.banned_until) <= Date.now());
}

export function assignedPrivileges(user: PrivilegeUser): AdminPrivilege[] {
  if (!isActiveAdministrator(user) || !Array.isArray(user?.app_metadata?.admin_privileges)) return [];
  return adminPrivileges.filter(item => (user.app_metadata!.admin_privileges as unknown[]).includes(item.key)).map(item => item.key);
}

export function hasAdminPrivilege(user: PrivilegeUser, privilege: AdminPrivilege): boolean {
  return isActiveAdministrator(user) && (user?.app_metadata?.role === "super_admin" || assignedPrivileges(user).includes(privilege));
}

export function validatePrivileges(value: unknown): value is AdminPrivilege[] {
  return Array.isArray(value) && new Set(value).size === value.length &&
    value.every(key => adminPrivileges.some(item => item.key === key));
}
