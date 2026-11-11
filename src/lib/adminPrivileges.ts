export const adminPrivileges = [
  { key: "committee.accounts.manage", label: "Manage committee accounts", description: "Create and manage CRECOM and BOD reviewer accounts after confirming your own password. This does not grant loan approval or privilege assignment." },
  { key: "applications.finalize", label: "Record final loan decisions", description: "Confirm final approval after all required CRECOM and BOD approvals using your own account password." },
  { key: "loans.release", label: "Record loan releases", description: "Record an approved loan's actual disbursement after confirming your own account password." },
  { key: "applications.forward", label: "Manage committee reviews", description: "Forward verified applications, assign eligible reviewers, resolve clarifications and manage reassignment. This does not grant final approval." },
  { key: "applications.verify", label: "Verify applications", description: "Start application verification, save checks and mark a complete application verified. This does not grant loan approval." },
  { key: "applications.return", label: "Return application requirements", description: "Request application or file corrections with recorded instructions in the member inbox." },
  { key: "workflow.policy.manage", label: "Prepare approval policy drafts", description: "Save versioned workflow policy drafts. Activating a production approval policy is not included." },
  { key: "documents.review", label: "Review member documents", description: "Verify uploaded files or request a replacement with a recorded reason." },
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
