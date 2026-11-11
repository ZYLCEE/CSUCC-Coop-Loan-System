import type {CommitteeRole,CommitteeSeat} from "./committee";
export type CommitteeDemoAccount={id:string;name:string;email:string;role:CommitteeRole;seat:CommitteeSeat};
export class CommitteeDemoError extends Error{}
export async function committeeDemoSession(){
 const response=await fetch("/api/committee-demo",{cache:"no-store",credentials:"same-origin"});
 const result=await response.json();
 if(!response.ok)throw new CommitteeDemoError(result.error??"Committee sign-in could not be checked.");
 return result as {account:CommitteeDemoAccount|null;expired?:boolean};
}
export async function committeeDemoAction(body:Record<string,unknown>){
 const response=await fetch("/api/committee-demo",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify(body),cache:"no-store"});
 const result=await response.json();
 if(!response.ok)throw new CommitteeDemoError(result.error??"Committee sign-in could not be completed.");
 return result as {account:CommitteeDemoAccount|null;verified?:boolean};
}
