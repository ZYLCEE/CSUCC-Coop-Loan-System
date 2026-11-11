import type {PortalAccess} from "../../src/lib/committee";
type FixtureWindow=Window&{setupRole?:"crecom_member"|"bod_member";setupAccessError?:boolean;setupCalls?:Record<string,unknown>[];setupComplete?:boolean};
const state=window as FixtureWindow;
export async function acceptCommitteeEmailLink(){}
export async function resolvePortalAccess():Promise<PortalAccess>{
 if(state.setupAccessError)throw new Error("Your committee access could not be checked. Please retry.");
 return {role:state.setupRole??"crecom_member",allowed:!!state.setupComplete,setupRequired:!state.setupComplete,reason:null,membershipId:"synthetic-reviewer",name:"Synthetic Reviewer",email:"reviewer@example.invalid"};
}
export function getSupabaseClient(){return {auth:{getUser:async()=>({data:{user:{id:"synthetic-reviewer",app_metadata:{role:state.setupRole??"crecom_member"}}},error:null}),signOut:async()=>({error:null})}};}
export async function committeeRequest(_query:string,init:RequestInit){
 const body=JSON.parse(String(init.body));(state.setupCalls??=[]).push(body);await new Promise(resolve=>setTimeout(resolve,150));
 if(body.password==="Synthetic-Temporary1!")throw new Error("Choose a new password different from your temporary or current password.");
 state.setupComplete=true;return resolvePortalAccess();
}
