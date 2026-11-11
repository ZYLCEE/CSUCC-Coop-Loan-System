import type { Member } from "./MembersData";

// Presentation only. Account mutations remain authorized by the existing server.
export function accountActions(member: Member, actorId: string | undefined, actorRole: string | null, readOnly: boolean) {
  const superAccount = ["Super Admin", "Super Administrator"].includes(member.role);
  const administrator = ["Admin", "Administrator"].includes(member.role);
  const self = !!actorId && member.authUserId === actorId;
  const ownSuper = superAccount && self && actorRole === "super_admin";
  const manager = actorRole === "super_admin" && !readOnly;
  const linked = !!member.profileLinked && !!member.authUserId && !!member.idNumber && !member.integrityIssue;
  const ordinary = member.role === "Member" || administrator;
  return {
    ownSuper,
    protectedSuper: manager && superAccount && !self,
    edit: manager && linked && ordinary,
    reset: manager && linked && ordinary,
    privileges: manager && linked && (administrator || superAccount && !self),
    block: manager && linked && ordinary && !self,
    delete: manager && linked && ordinary && !self,
  };
}
