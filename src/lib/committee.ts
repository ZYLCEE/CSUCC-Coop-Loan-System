import type {User} from "@supabase/supabase-js";
import {getAdminRole,type AdminRole} from "./auth/roles";

export type CommitteeRole="crecom_member"|"bod_member";
export type CommitteeSeat="member"|"chairperson";
export type SignatoryRole="crecom_member"|"crecom_chairperson"|"bod_chairperson";
export const signatoryRoleLabels:Record<SignatoryRole,string>={crecom_member:"CRECOM Member",crecom_chairperson:"CRECOM Chairperson",bod_chairperson:"BOD Chairperson"};
export function committeePositionLabel(role:CommitteeRole,seat:CommitteeSeat="member",number?:number|null){return role==="bod_member"?(seat==="chairperson"?"BOD Chairperson":"BOD Member"):seat==="chairperson"?"CRECOM Chairperson":number===1||number===2?`CRECOM Member ${number}`:"CRECOM Member";}
export function signatoryPositionLabel(role:SignatoryRole|null|undefined,number?:number|null){return role==="crecom_member"?committeePositionLabel("crecom_member","member",number):role?signatoryRoleLabels[role]:"Position not recorded";}
export type PortalRole=AdminRole|CommitteeRole;
export const committeeRoleLabels:Record<CommitteeRole,string>={crecom_member:"CRECOM Member",bod_member:"BOD Member"};
export function getCommitteeRole(user:Pick<User,"app_metadata">|null):CommitteeRole|null{
  const role=user?.app_metadata.role;
  return role==="crecom_member" || role==="bod_member"?role:null;
}
export function getPortalRole(user:User|null):PortalRole|null{return getAdminRole(user)??getCommitteeRole(user);}
export function getPortalPrefix(role:PortalRole){return role==="crecom_member"?"/crecom":role==="bod_member"?"/bod":role==="super_admin"?"/super-admin":"/admin";}
export function getPortalDashboardPath(role:PortalRole){return getPortalPrefix(role)+"/dashboard";}
export type PortalAccess={allowed:boolean;role:PortalRole|null;setupRequired:boolean;reviewEnabled?:boolean;reason:string|null;membershipId:string|null;name:string;email:string;committeeSeat?:CommitteeSeat;committeeMemberNumber?:1|2|null;startsAt?:string;endsAt?:string|null};
export type CommitteeAccount={
  creationMode?:"invite"|"password";
  committeeMemberNumber?:1|2|null;
  id:string;requestId:string;userId:string|null;name:string;email:string;role:CommitteeRole;committeeSeat:CommitteeSeat;title:string;
  startsAt:string;endsAt:string|null;active:boolean;revision:number;setupCompletedAt:string|null;status:"invited"|"active"|"scheduled"|"expired"|"inactive"|"provisioning"|"failed"|"policy_disabled"|"blocked"|"recovery_pending";
  lastSignInAt:string|null;assignedCount:number;lastInviteAt:string|null;error:string|null;
};
export type CommitteeAccountsData={accounts:CommitteeAccount[];bodEnabled:boolean;accountActionsVersion?:number};
export type CommitteeInvite={name:string;email:string;role:CommitteeRole;committeeSeat:CommitteeSeat;committeeMemberNumber:1|2|null;title:string;startsAt:string;endsAt:string|null};
export function validateCommitteeInvite(value:unknown):CommitteeInvite{
  if(!value || typeof value!=="object" || Array.isArray(value))throw new Error("Complete the committee account details.");
  const row=value as Record<string,unknown>;
  const name=typeof row.name==="string"?row.name.trim():"",email=typeof row.email==="string"?row.email.trim().toLowerCase():"",title=typeof row.title==="string"?row.title.trim():"";
  if(!name || name.length>160 || /[\u0000-\u001f\u007f]/.test(name))throw new Error("Enter a full name of up to 160 characters.");
  if(email.length>254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new Error("Enter a valid institutional email address.");
  if(row.role!=="crecom_member" && row.role!=="bod_member")throw new Error("Choose CRECOM or BOD membership.");
  if(row.committeeSeat!=="member"&&row.committeeSeat!=="chairperson"||row.role==="bod_member"&&row.committeeSeat!=="chairperson")throw new Error("Choose a CRECOM member, CRECOM chairperson or BOD chairperson position.");
  const committeeMemberNumber=row.role==="crecom_member"&&row.committeeSeat==="member"?row.committeeMemberNumber:null;
  if(row.role==="crecom_member"&&row.committeeSeat==="member"&&committeeMemberNumber!==1&&committeeMemberNumber!==2)throw new Error("Choose CRECOM Member 1 or CRECOM Member 2.");
  if(title.length>100 || /[\u0000-\u001f\u007f]/.test(title))throw new Error("Enter a title of up to 100 characters.");
  const startsAt=typeof row.startsAt==="string"?row.startsAt:"",endsAt=row.endsAt===null?null:typeof row.endsAt==="string"?row.endsAt:"";
  if(!Number.isFinite(Date.parse(startsAt)) || endsAt!==null && (!Number.isFinite(Date.parse(endsAt)) || Date.parse(endsAt)<=Date.parse(startsAt)))throw new Error("Choose a valid membership start and end date.");
  return {name,email,role:row.role,committeeSeat:row.committeeSeat,committeeMemberNumber:committeeMemberNumber as 1|2|null,title,startsAt:new Date(startsAt).toISOString(),endsAt:endsAt?new Date(endsAt).toISOString():null};
}
export function validateCommitteeCredentials(value:unknown):{password:string;confirm:string}{
 if(!value||typeof value!=="object")throw new Error("Enter the temporary password and confirmation.");
 const row=value as Record<string,unknown>;
 if(typeof row.password!=="string"||!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,128}$/.test(row.password))throw new Error("Enter a temporary password of 8–128 characters with uppercase, lowercase, a number and a symbol.");
 if(row.confirm!==row.password)throw new Error("Enter matching temporary passwords.");
 return {password:row.password,confirm:row.password};
}
export function membershipDates(start:string,end:string){
  return {startsAt:start+"T00:00:00+08:00",endsAt:end?new Date(Date.parse(end+"T00:00:00+08:00")+86400000).toISOString():null};
}
export function membershipDateInput(value:string|null,inclusiveEnd=false){
  if(!value)return "";
  return new Date(Date.parse(value)+28800000-(inclusiveEnd?86400000:0)).toISOString().slice(0,10);
}
export type CommitteeApproval={id:string;position:SignatoryRole|null;memberNumber:1|2|null;reviewer:string|null;state:string;decision:"approve"|"reject"|null;decidedAt:string|null};
export type CommitteeApprovalProgress={approved:number;rejected:number;total:number;reviewers:CommitteeApproval[]};
export type CommitteeConfirmation={reviewer:string;signatoryRole:SignatoryRole;committeeMemberNumber?:1|2|null;decision:string;createdAt:string;reference?:string};
export type CommitteeAssignment={id:string;applicationId:string;applicant:string;memberNumber:string;loanType:string;amount:number;stage:"CRECOM"|"BOD";signatoryRole?:SignatoryRole|null;committeeMemberNumber?:1|2|null;cycle:number;packetVersion:number;assignedAt:string;dueAt:string|null;state:string;responded:number;assigned:number;approvalProgress?:CommitteeApprovalProgress;myDecision?:"approve"|"reject"|null;crecomConfirmations?:CommitteeConfirmation[]};
export type CommitteeDecision={id:string;assignmentId:string;applicationId:string;cycle:number;packetVersion:number;decision:string;signatoryRole?:SignatoryRole|null;reason:string|null;createdAt:string;accessAvailable?:boolean};
export type CommitteeWorkspace={assignments:CommitteeAssignment[];history:CommitteeDecision[];counts:{assigned:number;pending:number;waiting:number;clarification:number;completed:number};};
export type CommitteePacket={assignment:CommitteeAssignment;summary:Record<string,unknown>;findings:string;consentSummary:string;documents:{documentId:string;versionId:string|null;kind:string;name:string}[]};
export type CommitteeNotification={id:string;title:string;message:string;read:boolean;createdAt:string;assignmentId:string|null;accessAvailable:boolean};
