import { MembershipType } from "@/lib/membership";

export type MemberRole = "Member" | "Admin" | "Super Admin" | "Unknown" | "Administrator" | "Super Administrator";
export type MemberStatus = "Active" | "Pending" | "Suspended" | "Inactive" | "Blocked" | "Unknown";
export type MemberRoleFilter = "All Roles" | "Member" | "Admin" | "Super Admin" | "Unknown";
export type MemberStatusFilter = "All Status" | MemberStatus;
export type MemberSortOption = "Name A-Z" | "Name Z-A" | "Newest" | "Oldest";

export interface Member {
  accountKey?: string;
  authUserId?: string | null;
  profileLinked?: boolean;
  integrityIssue?: string | null;
  idNumber: string;
  fullName: string;
  email: string;
  department: string;
  role: MemberRole;
  status: MemberStatus;
  membershipType?: MembershipType;
  createdAt: string;
}

export const roleFilterOptions: MemberRoleFilter[] = ["All Roles", "Member", "Admin", "Super Admin", "Unknown"];
export const normalizedMemberRoles = new Set<MemberRole>(["Member", "Admin", "Super Admin", "Unknown", "Administrator", "Super Administrator"]);
export const statusFilterOptions: MemberStatusFilter[] = ["All Status", "Active", "Inactive", "Blocked", "Suspended", "Unknown"];
export const memberSortOptions: MemberSortOption[] = ["Name A-Z", "Name Z-A", "Newest", "Oldest"];
export const memberRoles: MemberRole[] = ["Member", "Admin"];
export const memberStatuses: MemberStatus[] = ["Active", "Inactive", "Blocked", "Suspended"];
