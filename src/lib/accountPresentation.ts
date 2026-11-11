export const accountRoles={super_admin:"Super Admin",admin:"Admin",member:"Member",crecom_member:"CRECOM",bod_member:"BOD"} as const;
export type AccountRole=keyof typeof accountRoles;
export const accountRoleTones={super_admin:"warning",admin:"info",member:"success",crecom_member:"reviewer",bod_member:"board"} as const;
export function formatAccountNumber(value:string|null|undefined){
 const id=value?.trim();
 if(!id)return "—";
 return /^(?:CSUCC-)?\d{4}-\d{4,}$/i.test(id)?"CSUCC-"+id.replace(/^CSUCC-/i,""):id;
}
export function activeLogIdentityRole(user:{app_metadata?:Record<string,unknown>}):AccountRole|null{
 const metadata=user.app_metadata??{},role=metadata.role==="coop_admin"?"admin":metadata.role;
 return (metadata.account_status??"active")==="active"&&typeof role==="string"&&Object.hasOwn(accountRoles,role)?role as AccountRole:null;
}
